import { createServerFn } from "@tanstack/react-start";
import type { Systeminformation } from "systeminformation";
import { cachedAsync, errMsg, type ServiceStatus } from "./shared";
import {
  containerApp,
  containerCpuPercent,
  containerMemBytes,
  windowedDiskRate,
  type CounterSnapshot,
  type DiskCounters,
} from "./host-rates";

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
    source: "process" | "container";
  }>;
}

// Cache pentru datele statice.
let staticHostCache: {
  osInfo: Systeminformation.OsData;
  cpu: Systeminformation.CpuData;
} | null = null;

// Citirile recente ale contoarelor per disc (/proc/diskstats), pentru viteza
// mediată pe DISK_WINDOW_MS.
const DISK_WINDOW_MS = 5000;
const diskHistory: Record<string, DiskCounters[]> = {};

// Containerele Docker citite direct din cgroup (userul serviciului n-are acces
// la socket-ul Docker). CPU-ul e un contor cumulativ, deci ținem citirea
// anterioară; aplicația unui container nu se schimbă, deci o ținem minte.
const CGROUP_DIR = "/sys/fs/cgroup/system.slice";
const prevContainerCpu = new Map<string, CounterSnapshot>();
const containerAppById = new Map<string, string | null>();

interface ContainerSample {
  id: string;
  app: string | null;
  usageUsec: number;
  memBytes: number;
  ts: number;
}

async function readDockerCgroups(): Promise<ContainerSample[]> {
  const { readdir, readFile } = await import("node:fs/promises");
  let entries: string[];
  try {
    entries = (await readdir(CGROUP_DIR)).filter((e) => /^docker-[0-9a-f]+\.scope$/.test(e));
  } catch {
    return [];
  }
  const samples = await Promise.all(
    entries.map(async (entry): Promise<ContainerSample | null> => {
      const dir = `${CGROUP_DIR}/${entry}`;
      try {
        if (!containerAppById.has(entry)) {
          const pids = (await readFile(`${dir}/cgroup.procs`, "utf8")).trim().split("\n");
          const cmdlines = await Promise.all(
            pids.map((pid) =>
              readFile(`/proc/${pid}/cmdline`, "utf8")
                .then((c) => c.replaceAll("\0", " "))
                .catch(() => ""),
            ),
          );
          containerAppById.set(entry, containerApp(cmdlines));
        }
        const [cpuStat, memCurrent, memStat] = await Promise.all([
          readFile(`${dir}/cpu.stat`, "utf8"),
          readFile(`${dir}/memory.current`, "utf8"),
          readFile(`${dir}/memory.stat`, "utf8"),
        ]);
        const usageUsec = Number(/^usage_usec (\d+)/m.exec(cpuStat)?.[1] ?? 0);
        const inactiveFile = Number(/^inactive_file (\d+)/m.exec(memStat)?.[1] ?? 0);
        return {
          id: entry,
          app: containerAppById.get(entry) ?? null,
          usageUsec,
          memBytes: containerMemBytes(Number(memCurrent), inactiveFile),
          ts: Date.now(),
        };
      } catch {
        // Container oprit între readdir și citire.
        return null;
      }
    }),
  );
  return samples.filter((x): x is ContainerSample => x !== null);
}

async function readProcDiskstats(): Promise<Record<string, { rSec: number; wSec: number }>> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile("/proc/diskstats", "utf8");
    const result: Record<string, { rSec: number; wSec: number }> = {};
    for (const line of raw.trim().split("\n")) {
      const parts = line.trim().split(/\s+/);
      const name = parts[2];
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
  const { requireAdmin } = await import("../auth/admin.server");
  await requireAdmin();
  // Cache partajat: N tab-uri deschise costă cât unul. Vezi cachedAsync.
  return cachedAsync("host", HOST_TTL_MS, collectHostData);
});

// Sub cel mai rapid ritm al clientului (1s), ca TTL-ul să nu devină plafonul;
// colectarea costă ~7ms (partea scumpă e cachată separat).
const HOST_TTL_MS = 800;

// Cele mai scumpe apeluri (si.processes() parcurge /proc, docker lovește
// socket-ul) — se schimbă lent, deci cache propriu, mai lung.
const HEAVY_TTL_MS = 15_000;

// Valoarea veche imediat, reîmprospătare în fundal (cachedAsync) — altfel o
// cerere din 15 plătea 2,3s, iar pagina Sistem se poticnea.
const SWR = { staleWhileRevalidate: true } as const;

async function collectHostData(): Promise<HostData> {
  try {
    const si = await import("systeminformation");
    const os = await import("node:os");

    // Statice — o singură dată.
    if (!staticHostCache) {
      const [osInfo, cpu] = await Promise.all([si.osInfo(), si.cpu()]);
      staticHostCache = { osInfo, cpu };
    }
    const { osInfo, cpu } = staticHostCache;

    // Dinamice — la fiecare refresh.
    const [currentLoad, mem, fsSize, netStats, cpuTemp, processes, containers, diskStatsRaw] =
      await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.networkStats(),
        si.cpuTemperature().catch(() => null),
        cachedAsync("host:processes", HEAVY_TTL_MS, () => si.processes(), SWR),
        readDockerCgroups(),
        readProcDiskstats(),
      ]);

    const loadAvg = os.loadavg() as [number, number, number];

    // Vitezele per disc, din contoarele cumulative.
    const now = Date.now();
    const diskSpeeds: Record<string, { readBps: number; writeBps: number }> = {};
    for (const [dev, raw] of Object.entries(diskStatsRaw)) {
      const cur = { readBytes: raw.rSec * 512, writeBytes: raw.wSec * 512, ts: now };
      const history = diskHistory[dev] ?? [];
      const rate = windowedDiskRate(history, cur, DISK_WINDOW_MS);
      if (rate) diskSpeeds[dev] = rate;
      diskHistory[dev] = [...history.filter((h) => now - h.ts < DISK_WINDOW_MS), cur];
    }

    const disks = fsSize
      .filter((f) => f.size > 0)
      .map((f) => {
        // Device-ul vine din fsSize, iar /proc/diskstats are și partiții. O
        // mapare manuală inversase cele două NVMe (numerotare instabilă).
        const dev = f.fs.startsWith("/dev/") ? f.fs.slice(5) : undefined;
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

    // Fără procesele pornite chiar de server (ps-ul cu care systeminformation
    // citește lista): abia pornite, apăreau cu CPU 100%.
    const ownPids = new Set([process.pid]);
    for (let grew = true; grew;) {
      grew = false;
      for (const p of processes.list ?? []) {
        if (!ownPids.has(p.pid) && ownPids.has(p.parentPid)) {
          ownPids.add(p.pid);
          grew = true;
        }
      }
    }
    const procList = (processes.list ?? []).filter(
      (p) => p.pid === process.pid || !ownPids.has(p.pid),
    );

    // Același nume (ex. mai multe procese „Plex”) → un singur rând, însumat.
    const byName = new Map<string, { name: string; cpu: number; mem: number }>();
    for (const p of procList) {
      const name = p.name || "?";
      const row = byName.get(name) ?? { name, cpu: 0, mem: 0 };
      row.cpu += Number(p.cpu ?? 0);
      row.mem += Number(p.mem ?? 0);
      byName.set(name, row);
    }
    const topProcesses = [...byName.values()].sort((a, b) => b.cpu - a.cpu).slice(0, 6);

    // Plex și Immich sunt containere (toate containerele aplicației, însumate);
    // qBittorrent e proces systemd. La prima citire după pornire CPU-ul
    // containerelor nu are încă interval, deci 0.
    const apps: NonNullable<HostData["apps"]> = [];
    for (const name of ["Plex", "Immich"]) {
      const own = containers.filter((c) => c.app === name);
      if (own.length === 0) continue;
      apps.push({
        name,
        cpu: own.reduce(
          (s, c) =>
            s +
            (containerCpuPercent(prevContainerCpu.get(c.id), c.usageUsec, c.ts, cpu.cores) ?? 0),
          0,
        ),
        mem: mem.total ? (own.reduce((s, c) => s + c.memBytes, 0) / mem.total) * 100 : 0,
        source: "container",
      });
    }
    for (const c of containers) prevContainerCpu.set(c.id, { value: c.usageUsec, ts: c.ts });
    const qbit = procList.filter((p) => /qbittorrent/i.test(p.name ?? ""));
    if (qbit.length > 0) {
      apps.push({
        name: "qBittorrent",
        cpu: qbit.reduce((s, p) => s + Number(p.cpu ?? 0), 0),
        mem: qbit.reduce((s, p) => s + Number(p.mem ?? 0), 0),
        source: "process",
      });
    }

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
      disks,
      net,
      sensors,
      topProcesses,
      apps,
    };
  } catch (e) {
    return { status: "error", configured: true, error: errMsg(e) };
  }
}
