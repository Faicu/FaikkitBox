import { createServerFn } from "@tanstack/react-start";
import type { Systeminformation } from "systeminformation";
import { errMsg, type ServiceStatus } from "./shared";

export interface HostData {
  status: ServiceStatus;
  error?: string;
  configured: boolean;
  hostname?: string;
  os?: string;
  uptimeSec?: number;
  cpuPercent?: number;
  cpuCores?: number;
  loadAvg?: [number, number, number];
  memPercent?: number;
  memUsedBytes?: number;
  memTotalBytes?: number;
  swapPercent?: number;
  disks?: Array<{
    mount: string;
    percent: number;
    usedBytes: number;
    totalBytes: number;
    readBps?: number;
    writeBps?: number;
  }>;
  net?: Array<{ name: string; rxSec: number; txSec: number }>;
  sensors?: Array<{ label: string; value: number; unit: string }>;
  topProcesses?: Array<{ name: string; cpu: number; mem: number }>;
  apps?: Array<{
    name: string;
    cpu: number;
    mem: number;
    netRx?: number;
    netTx?: number;
    source: "process" | "container";
  }>;
  diskIO?: Array<{ name: string; ioRead: number; ioWrite: number }>;
}

// Cache pentru date statice care nu se schimbă
let staticHostCache: {
  osInfo: Systeminformation.OsData;
  cpu: Systeminformation.CpuData;
} | null = null;

// Cache pentru calculul vitezei disk I/O per disc din /proc/diskstats
interface DiskSnapshot {
  rSec: number;
  wSec: number;
  ts: number;
}
const prevDiskStats: Record<string, DiskSnapshot> = {};

async function readProcDiskstats(
  devices: string[],
): Promise<Record<string, { rSec: number; wSec: number }>> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile("/proc/diskstats", "utf8");
    const result: Record<string, { rSec: number; wSec: number }> = {};
    for (const line of raw.trim().split("\n")) {
      const parts = line.trim().split(/\s+/);
      const name = parts[2];
      if (!devices.includes(name)) continue;
      result[name] = {
        rSec: Number(parts[5]), // sectoare citite cumulative (1 sector = 512 bytes)
        wSec: Number(parts[9]), // sectoare scrise cumulative
      };
    }
    return result;
  } catch {
    return {};
  }
}

export const getHost = createServerFn({ method: "GET" }).handler(async (): Promise<HostData> => {
  try {
    const si = await import("systeminformation");
    const os = await import("node:os");

    // Date statice — preluate o singură dată și cachate în memorie
    if (!staticHostCache) {
      const [osInfo, cpu] = await Promise.all([si.osInfo(), si.cpu()]);
      staticHostCache = { osInfo, cpu };
    }
    const { osInfo, cpu } = staticHostCache;

    // Date dinamice — preluate la fiecare refresh
    const [currentLoad, mem, fsSize, netStats, cpuTemp, processes, dockerContainers, diskStatsRaw] =
      await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.networkStats(),
        si.cpuTemperature().catch(() => null),
        si.processes(),
        si.dockerContainers().catch(() => [] as Awaited<ReturnType<typeof si.dockerContainers>>),
        readProcDiskstats(["nvme0n1", "nvme1n1", "sda"]),
      ]);

    const loadAvg = os.loadavg() as [number, number, number];

    // Mapping mount → device pentru serverul faikkitbox
    const MOUNT_TO_DEV: Record<string, string> = {
      "/": "nvme1n1",
      "/media/ssd2tb": "nvme0n1",
      "/media/hddextern": "sda",
    };

    // Calculez viteze per disc din /proc/diskstats cumulative
    const now = Date.now();
    const diskSpeeds: Record<string, { readBps: number; writeBps: number }> = {};
    for (const [dev, cur] of Object.entries(diskStatsRaw)) {
      const prev = prevDiskStats[dev];
      if (prev && now - prev.ts > 100) {
        const dt = (now - prev.ts) / 1000;
        diskSpeeds[dev] = {
          readBps: Math.max(0, ((cur.rSec - prev.rSec) * 512) / dt),
          writeBps: Math.max(0, ((cur.wSec - prev.wSec) * 512) / dt),
        };
      }
      prevDiskStats[dev] = { rSec: cur.rSec, wSec: cur.wSec, ts: now };
    }

    const disks = fsSize
      .filter((f) => f.size > 0)
      .map((f) => {
        const dev = MOUNT_TO_DEV[f.mount];
        const io = dev ? diskSpeeds[dev] : undefined;
        return {
          mount: f.mount,
          percent: Number(f.use ?? 0),
          usedBytes: Number(f.used ?? 0),
          totalBytes: Number(f.size ?? 0),
          readBps: io?.readBps,
          writeBps: io?.writeBps,
        };
      });

    const net = netStats
      .filter((n) => n.iface && !n.iface.startsWith("lo"))
      .map((n) => ({
        name: n.iface,
        rxSec: Number(n.rx_sec ?? 0),
        txSec: Number(n.tx_sec ?? 0),
      }));

    const sensors =
      cpuTemp && typeof cpuTemp.main === "number" && cpuTemp.main > 0
        ? [{ label: "CPU", value: cpuTemp.main, unit: "°C" }]
        : [];

    const topProcesses = (processes.list ?? [])
      .slice()
      .sort((a, b) => Number(b.cpu ?? 0) - Number(a.cpu ?? 0))
      .slice(0, 6)
      .map((p) => ({ name: p.name || "?", cpu: Number(p.cpu ?? 0), mem: Number(p.mem ?? 0) }));

    // Docker containers (Plex, Immich) — recunoscute dupa nume/imagine.
    // qBittorrent ruleaza ca proces systemd nativ, il gasim in lista de procese.
    const APP_MAP: Array<{ name: string; match: RegExp }> = [
      { name: "Plex", match: /plex/i },
      { name: "Immich", match: /immich/i },
      { name: "qBittorrent", match: /qbittorrent|qbit/i },
    ];

    const containerStats = await Promise.all(
      dockerContainers.map(async (c) => {
        try {
          const stats = await si.dockerContainerStats(c.id);
          return { container: c, stats: Array.isArray(stats) ? stats[0] : stats };
        } catch {
          return { container: c, stats: null };
        }
      }),
    );

    const apps: HostData["apps"] = APP_MAP.map(({ name, match }) => {
      const matchedContainers = containerStats.filter(
        ({ container }) => match.test(container.name ?? "") || match.test(container.image ?? ""),
      );
      if (matchedContainers.length > 0) {
        let cpuSum = 0;
        let memSum = 0;
        let rxSum = 0;
        let txSum = 0;
        for (const { stats } of matchedContainers) {
          if (!stats) continue;
          cpuSum += Number(stats.cpuPercent ?? 0);
          memSum += Number(stats.memPercent ?? 0);
          rxSum += Number(stats.netIO?.rx ?? 0);
          txSum += Number(stats.netIO?.wx ?? 0);
        }
        return {
          name,
          cpu: cpuSum,
          mem: memSum,
          netRx: rxSum,
          netTx: txSum,
          source: "container" as const,
        };
      }
      const matchedProcs = (processes.list ?? []).filter((p) =>
        match.test(p.name ?? p.command ?? ""),
      );
      if (matchedProcs.length === 0) return null;
      const cpuSum = matchedProcs.reduce((s, p) => s + Number(p.cpu ?? 0), 0);
      const memSum = matchedProcs.reduce((s, p) => s + Number(p.mem ?? 0), 0);
      return { name, cpu: cpuSum, mem: memSum, source: "process" as const };
    }).filter((x): x is NonNullable<typeof x> => x !== null);

    return {
      status: "ok",
      configured: true,
      hostname: osInfo.hostname,
      os: `${osInfo.distro ?? ""} ${osInfo.release ?? ""}`.trim() || undefined,
      uptimeSec: os.uptime(),
      cpuPercent: Number(currentLoad.currentLoad ?? 0),
      cpuCores: cpu.cores,
      loadAvg,
      memPercent: mem.total ? (mem.active / mem.total) * 100 : 0,
      memUsedBytes: mem.active,
      memTotalBytes: mem.total,
      swapPercent: mem.swaptotal ? (mem.swapused / mem.swaptotal) * 100 : 0,
      disks,
      net,
      sensors,
      topProcesses,
      apps,
      // systeminformation nu expune usor I/O per-proces cross-platform ca Glances;
      // lasam lista goala mai degraba decat sa afisam date incorecte.
      diskIO: [],
    };
  } catch (e) {
    return { status: "error", configured: true, error: errMsg(e) };
  }
});
