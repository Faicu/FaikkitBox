// Citiri directe din /proc și /sys pentru pagina Sistem (doar server). Fără
// systeminformation: sunt fișiere mici, citite și la fiecare 5 s pentru istoric.

import { readFile, readdir, stat } from "node:fs/promises";

import { baseBlockDevice, type SmartSummary } from "./host-rates";

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

// Octeți cumulativi per dispozitiv (1 sector din /proc/diskstats = 512 B).
export async function readDiskstats(): Promise<
  Record<string, { readBytes: number; writeBytes: number }>
> {
  const raw = await readText("/proc/diskstats");
  const result: Record<string, { readBytes: number; writeBytes: number }> = {};
  for (const line of raw?.trim().split("\n") ?? []) {
    const p = line.trim().split(/\s+/);
    result[p[2]] = { readBytes: Number(p[5]) * 512, writeBytes: Number(p[9]) * 512 };
  }
  return result;
}

// Octeți cumulativi pe interfețele fizice (fără lo, docker, veth — traficul
// containerelor trece oricum prin placa fizică și s-ar număra de două ori).
export async function readNetTotals(): Promise<{ rx: number; tx: number }> {
  const raw = await readText("/proc/net/dev");
  let rx = 0;
  let tx = 0;
  for (const line of raw?.split("\n").slice(2) ?? []) {
    const [name, rest] = line.split(":");
    if (!rest || !/^(en|eth|wl)/.test(name.trim())) continue;
    const p = rest.trim().split(/\s+/).map(Number);
    rx += p[0];
    tx += p[8];
  }
  return { rx, tx };
}

export async function readCpuTimes(): Promise<{ idle: number; total: number } | null> {
  const raw = await readText("/proc/stat");
  if (!raw) return null;
  const f = raw.split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
  // idle + iowait; steal și guest nu intră în total (guest e inclus în user).
  return { idle: f[3] + f[4], total: f.slice(0, 8).reduce((a, b) => a + b, 0) };
}

// Memoria folosită ca la `free` (total − disponibil).
export async function readMemPercent(): Promise<number | null> {
  const raw = await readText("/proc/meminfo");
  const kb = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(raw ?? "")?.[1]);
  const total = kb("MemTotal");
  const avail = kb("MemAvailable");
  return total > 0 && avail >= 0 ? ((total - avail) / total) * 100 : null;
}

// Punctul de montare → dispozitivul (ex. „/” → „nvme1n1p2”).
export async function readMountDevices(): Promise<Record<string, string>> {
  const raw = await readText("/proc/self/mounts");
  const result: Record<string, string> = {};
  for (const line of raw?.split("\n") ?? []) {
    const [dev, mount] = line.split(" ");
    if (dev?.startsWith("/dev/") && !(mount in result)) result[mount] = dev.slice(5);
  }
  return result;
}

export interface HwmonReading {
  cpuTemp?: number;
  gpu?: { temp?: number; busyPercent?: number };
  // Pe disc întreg (nvme0n1); `max` = pragul de avertizare din firmware.
  nvme: Record<string, { temp: number; max?: number }>;
}

const milli = (s: string | null) => (s == null || s.trim() === "" ? undefined : Number(s) / 1000);

export async function readHwmon(): Promise<HwmonReading> {
  const result: HwmonReading = { nvme: {} };
  let dirs: string[];
  try {
    dirs = await readdir("/sys/class/hwmon");
  } catch {
    return result;
  }
  await Promise.all(
    dirs.map(async (d) => {
      const dir = `/sys/class/hwmon/${d}`;
      const name = (await readText(`${dir}/name`))?.trim();
      if (name === "k10temp" || name === "coretemp") {
        // k10temp: temp1 = Tctl, aceeași valoare ca `sensors`.
        result.cpuTemp = milli(await readText(`${dir}/temp1_input`));
      } else if (name === "amdgpu") {
        const busy = await readText(`${dir}/device/gpu_busy_percent`);
        result.gpu = {
          temp: milli(await readText(`${dir}/temp1_input`)),
          busyPercent: busy == null ? undefined : Number(busy),
        };
      } else if (name === "nvme") {
        // device → controlerul nvmeN; discul (nvmeNn1) e un subdirector al lui.
        const disk = (await readdir(`${dir}/device`).catch(() => [] as string[])).find((e) =>
          /^nvme\d+n\d+$/.test(e),
        );
        const temp = milli(await readText(`${dir}/temp1_input`));
        if (disk && temp != null) {
          result.nvme[disk] = { temp, max: milli(await readText(`${dir}/temp1_max`)) };
        }
      }
    }),
  );
  return result;
}

// Starea SMART scrisă din oră în oră de faikkit-smart-json.timer (root) —
// userul serviciului nu poate rula smartctl. Peste 26 h = fișier uitat, ignorat.
const SMART_DIR = "/var/lib/faikkit-smart";
const SMART_MAX_AGE_MS = 26 * 3600_000;

interface SmartctlJson {
  model_name?: string;
  smart_status?: { passed?: boolean };
  temperature?: { current?: number };
  power_on_time?: { hours?: number };
  nvme_smart_health_information_log?: {
    critical_warning?: number;
    percentage_used?: number;
    data_units_written?: number;
    media_errors?: number;
  };
  ata_smart_attributes?: { table?: Array<{ id: number; raw?: { value?: number } }> };
}

export function summarizeSmart(j: SmartctlJson, checkedAt: number): SmartSummary {
  const nvme = j.nvme_smart_health_information_log;
  const ata = (id: number) => j.ata_smart_attributes?.table?.find((a) => a.id === id)?.raw?.value;
  return {
    model: j.model_name,
    passed: j.smart_status?.passed ?? null,
    tempC: j.temperature?.current,
    powerOnHours: j.power_on_time?.hours,
    wearPercent: nvme?.percentage_used,
    // O „unitate de date” NVMe = 1000 × 512 B.
    writtenBytes: nvme?.data_units_written != null ? nvme.data_units_written * 512_000 : undefined,
    criticalWarning: nvme?.critical_warning,
    mediaErrors: nvme?.media_errors,
    reallocated: ata(5),
    pending: ata(197),
    uncorrectable: ata(198),
    checkedAt,
  };
}

export async function readSmart(): Promise<Record<string, SmartSummary>> {
  const result: Record<string, SmartSummary> = {};
  let files: string[];
  try {
    files = (await readdir(SMART_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return result;
  }
  await Promise.all(
    files.map(async (f) => {
      try {
        const path = `${SMART_DIR}/${f}`;
        const mtime = (await stat(path)).mtimeMs;
        if (Date.now() - mtime > SMART_MAX_AGE_MS) return;
        const j = JSON.parse(await readFile(path, "utf8")) as SmartctlJson;
        result[baseBlockDevice(f.replace(/\.json$/, ""))] = summarizeSmart(j, mtime);
      } catch {
        // Fișier în curs de scriere sau stricat — data viitoare.
      }
    }),
  );
  return result;
}

// Memoria proprie a unui proces (anonimă + partajată), fără paginile de fișiere
// mapate: qBittorrent mapează torrentele în memorie, iar RSS-ul lui (~5 GB)
// e aproape tot cache de fișiere pe care kernelul îl eliberează oricând.
export async function readProcessOwnMemBytes(pid: number): Promise<number | null> {
  const raw = await readText(`/proc/${pid}/status`);
  if (!raw) return null;
  const kb = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(raw)?.[1] ?? 0);
  return (kb("RssAnon") + kb("RssShmem")) * 1024;
}
