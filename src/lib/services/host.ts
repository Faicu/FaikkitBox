import { createServerFn } from "@tanstack/react-start";
import type { Systeminformation } from "systeminformation";
import { cachedAsync, errMsg, type ServiceStatus } from "./shared";
import {
  DISK_MOUNTS,
  baseBlockDevice,
  containerApp,
  containerCpuPercent,
  containerMemBytes,
  diskTempLimits,
  windowedDiskRate,
  type CounterSnapshot,
  type DiskCounters,
  type HostHistoryPoint,
  type SmartSummary,
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
  cpuTemp?: number;
  gpu?: { temp?: number; busyPercent?: number };
  memPercent?: number;
  memUsedBytes?: number;
  memTotalBytes?: number;
  swapUsedBytes?: number;
  swapTotalBytes?: number;
  // Doar discurile din DISK_MOUNTS, în ordinea lor; unul nemontat lipsește.
  disks?: Array<{
    mount: string;
    percent: number;
    usedBytes: number;
    totalBytes: number;
    readBps?: number;
    writeBps?: number;
    temp?: number;
    tempLimits: [number, number];
    smart?: SmartSummary;
  }>;
  net?: Array<{ name: string; rxSec: number; txSec: number }>;
  topProcesses?: Array<{ name: string; cpu: number; mem: number }>;
  apps?: Array<{ name: string; cpu: number; mem: number; dlSpeed?: number; upSpeed?: number }>;
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

export const getHost = createServerFn({ method: "GET" }).handler(async (): Promise<HostData> => {
  const { requireAdmin } = await import("../auth/admin.server");
  await requireAdmin();
  // Cache partajat: N tab-uri deschise costă cât unul. Vezi cachedAsync.
  return cachedAsync("host", HOST_TTL_MS, collectHostData);
});

// Sub cel mai rapid ritm al clientului (1s), ca TTL-ul să nu devină plafonul;
// colectarea costă ~7ms (partea scumpă e cachată separat).
const HOST_TTL_MS = 800;

// Lista proceselor (si.processes() parcurge /proc, ~1 s) se schimbă lent,
// deci cache propriu, mai lung.
const PROCESSES_TTL_MS = 15_000;

// SMART-ul e scris din oră în oră; recitit la minut.
const SMART_TTL_MS = 60_000;

// Valoarea veche imediat, reîmprospătare în fundal (cachedAsync) — altfel o
// cerere din 15 plătea 2,3s, iar pagina Sistem se poticnea.
const SWR = { staleWhileRevalidate: true } as const;

interface ProcessSummary {
  top: NonNullable<HostData["topProcesses"]>;
  qbit: { cpu: number; memBytes: number } | null;
}

async function collectProcesses(memTotal: number): Promise<ProcessSummary> {
  const si = await import("systeminformation");
  const { readProcessOwnMemBytes } = await import("./host-sensors.server");
  const list = (await si.processes()).list ?? [];

  // Fără procesele pornite chiar de server (ps-ul cu care systeminformation
  // citește lista): abia pornite, apăreau cu CPU 100%.
  const ownPids = new Set([process.pid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of list) {
      if (!ownPids.has(p.pid) && ownPids.has(p.parentPid)) {
        ownPids.add(p.pid);
        grew = true;
      }
    }
  }
  const procs = list.filter((p) => p.pid === process.pid || !ownPids.has(p.pid));

  // Același nume (ex. mai multe procese „Plex”) → un singur rând, însumat.
  const byName = new Map<string, { name: string; cpu: number; pids: number[] }>();
  for (const p of procs) {
    const name = p.name || "?";
    const row = byName.get(name) ?? { name, cpu: 0, pids: [] };
    row.cpu += Number(p.cpu ?? 0);
    row.pids.push(p.pid);
    byName.set(name, row);
  }
  // Memoria proprie, nu RSS-ul (vezi readProcessOwnMemBytes).
  const memOf = async (pids: number[]) =>
    (await Promise.all(pids.map(readProcessOwnMemBytes))).reduce<number>((s, b) => s + (b ?? 0), 0);

  const topRows = [...byName.values()].sort((a, b) => b.cpu - a.cpu).slice(0, 6);
  const top = await Promise.all(
    topRows.map(async (r) => ({
      name: r.name,
      cpu: r.cpu,
      mem: memTotal ? ((await memOf(r.pids)) / memTotal) * 100 : 0,
    })),
  );
  const qbitProcs = procs.filter((p) => /qbittorrent/i.test(p.name ?? ""));
  const qbit = qbitProcs.length
    ? {
        cpu: qbitProcs.reduce((s, p) => s + Number(p.cpu ?? 0), 0),
        memBytes: await memOf(qbitProcs.map((p) => p.pid)),
      }
    : null;
  return { top, qbit };
}

// Vitezele globale qBittorrent (WebUI); null dacă nu răspunde.
async function readQbitSpeeds(): Promise<{ dl: number; up: number } | null> {
  const base = process.env.QBIT_URL;
  const user = process.env.QBIT_USERNAME;
  const pass = process.env.QBIT_PASSWORD;
  if (!base || !user || !pass) return null;
  try {
    const { qbitGet } = await import("../qbit-client");
    const res = await qbitGet(base.replace(/\/$/, ""), "/api/v2/transfer/info", user, pass);
    if (!res.ok) return null;
    const j = (await res.json()) as { dl_info_speed?: number; up_info_speed?: number };
    return { dl: Number(j.dl_info_speed ?? 0), up: Number(j.up_info_speed ?? 0) };
  } catch {
    return null;
  }
}

async function collectHostData(): Promise<HostData> {
  try {
    const si = await import("systeminformation");
    const os = await import("node:os");
    const sensors = await import("./host-sensors.server");

    // Statice — o singură dată.
    if (!staticHostCache) {
      const [osInfo, cpu] = await Promise.all([si.osInfo(), si.cpu()]);
      staticHostCache = { osInfo, cpu };
    }
    const { osInfo, cpu } = staticHostCache;

    // Dinamice — la fiecare refresh.
    const [currentLoad, mem, fsSize, netStats, hwmon, smart, containers, diskStatsRaw, qbitSpeeds] =
      await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.networkStats(),
        sensors.readHwmon(),
        cachedAsync("host:smart", SMART_TTL_MS, sensors.readSmart, SWR),
        readDockerCgroups(),
        sensors.readDiskstats(),
        readQbitSpeeds(),
      ]);
    const processes = await cachedAsync(
      "host:processes",
      PROCESSES_TTL_MS,
      () => collectProcesses(mem.total),
      SWR,
    );

    const loadAvg = os.loadavg() as [number, number, number];

    // Vitezele per disc, din contoarele cumulative.
    const now = Date.now();
    const diskSpeeds: Record<string, { readBps: number; writeBps: number }> = {};
    for (const [dev, raw] of Object.entries(diskStatsRaw)) {
      const cur = { ...raw, ts: now };
      const history = diskHistory[dev] ?? [];
      const rate = windowedDiskRate(history, cur, DISK_WINDOW_MS);
      if (rate) diskSpeeds[dev] = rate;
      diskHistory[dev] = [...history.filter((h) => now - h.ts < DISK_WINDOW_MS), cur];
    }

    const disks: NonNullable<HostData["disks"]> = [];
    for (const { mount } of DISK_MOUNTS) {
      const f = fsSize.find((x) => x.mount === mount && x.size > 0);
      if (!f) continue;
      // Device-ul vine din fsSize, iar /proc/diskstats are și partiții. O
      // mapare manuală inversase cele două NVMe (numerotare instabilă).
      const dev = f.fs.startsWith("/dev/") ? f.fs.slice(5) : "";
      const base = baseBlockDevice(dev);
      const io = diskSpeeds[dev];
      const nvme = hwmon.nvme[base];
      const diskSmart = smart[base];
      disks.push({
        mount,
        percent: Number(f.use ?? 0),
        usedBytes: Number(f.used ?? 0),
        totalBytes: Number(f.size ?? 0),
        readBps: io?.readBps,
        writeBps: io?.writeBps,
        // NVMe: senzorul live; HDD-ul doar din SMART (orar), fără senzor în kernel.
        temp: nvme?.temp ?? diskSmart?.tempC,
        tempLimits: diskTempLimits(nvme || base.startsWith("nvme") ? "ssd" : "hdd", nvme?.max),
        smart: diskSmart,
      });
    }

    const net = netStats
      .filter((n) => n.iface && !n.iface.startsWith("lo"))
      .map((n) => ({
        name: n.iface,
        rxSec: Number(n.rx_sec ?? 0),
        txSec: Number(n.tx_sec ?? 0),
      }));

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
      });
    }
    for (const c of containers) prevContainerCpu.set(c.id, { value: c.usageUsec, ts: c.ts });
    if (processes.qbit) {
      apps.push({
        name: "qBittorrent",
        cpu: processes.qbit.cpu,
        mem: mem.total ? (processes.qbit.memBytes / mem.total) * 100 : 0,
        dlSpeed: qbitSpeeds?.dl,
        upSpeed: qbitSpeeds?.up,
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
      cpuTemp: hwmon.cpuTemp,
      gpu: hwmon.gpu,
      memPercent: mem.total ? (mem.active / mem.total) * 100 : 0,
      memUsedBytes: mem.active,
      memTotalBytes: mem.total,
      swapUsedBytes: mem.swapused,
      swapTotalBytes: mem.swaptotal,
      disks,
      net,
      topProcesses: processes.top,
      apps,
    };
  } catch (e) {
    return { status: "error", configured: true, error: errMsg(e) };
  }
}

// Istoricul de 10 minute, eșantionat în fundal (host-history.server.ts).
export const getHostHistory = createServerFn({ method: "GET" }).handler(
  async (): Promise<HostHistoryPoint[]> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { hostHistory } = await import("./host-history.server");
    return hostHistory();
  },
);
