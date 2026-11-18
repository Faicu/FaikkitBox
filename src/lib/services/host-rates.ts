// Calcule pure pentru pagina Sistem (fără importuri server, deci sigure și în client).

export interface CounterSnapshot {
  value: number;
  ts: number;
}

// Viteza dintr-un contor cumulativ (octeți); undefined la prima citire, la
// interval prea scurt sau când contorul a coborât (container repornit).
export function counterRate(
  prev: CounterSnapshot | undefined,
  value: number,
  ts: number,
): number | undefined {
  if (!prev) return undefined;
  const dt = (ts - prev.ts) / 1000;
  if (dt <= 0.1 || value < prev.value) return undefined;
  return (value - prev.value) / dt;
}

// Viteza unui disc mediată pe ultimele secunde: kernelul scrie pe disc în
// rafale (datele stau întâi în memorie), iar la o secundă pagina arăta 0 și
// vârfuri. Bază = cea mai veche citire din fereastră; fără niciuna, ultima.
export interface DiskCounters {
  readBytes: number;
  writeBytes: number;
  ts: number;
}

export function windowedDiskRate(
  history: DiskCounters[],
  cur: DiskCounters,
  windowMs: number,
): { readBps: number; writeBps: number } | undefined {
  const base = history.find((h) => cur.ts - h.ts <= windowMs) ?? history.at(-1);
  if (!base) return undefined;
  const dt = (cur.ts - base.ts) / 1000;
  if (dt <= 0.1) return undefined;
  return {
    readBps: Math.max(0, (cur.readBytes - base.readBytes) / dt),
    writeBps: Math.max(0, (cur.writeBytes - base.writeBytes) / dt),
  };
}

// CPU-ul unui container din cgroup (`usage_usec` cumulativ), raportat la toate
// nucleele, ca procesele și cardul Procesor.
export function containerCpuPercent(
  prev: CounterSnapshot | undefined,
  usageUsec: number,
  ts: number,
  cores: number | undefined,
): number | undefined {
  const usecPerSec = counterRate(prev, usageUsec, ts);
  if (usecPerSec == null) return undefined;
  const onePerCore = usecPerSec / 10_000; // % dintr-un nucleu
  return cores && cores > 0 ? onePerCore / cores : onePerCore;
}

// Memoria unui container ca la `docker stats`: fără cache-ul de fișiere
// inactiv, pe care kernelul îl eliberează oricând.
export function containerMemBytes(current: number, inactiveFile: number): number {
  return Math.max(0, current - inactiveFile);
}

// Aplicația unui container, după liniile de comandă ale proceselor din el —
// userul serviciului n-are acces la Docker, deci nici la numele containerelor.
// Postgres-ul (cu extensia „vectors”) și Valkey sunt pe server doar ale Immich.
const CONTAINER_APPS: Array<{ name: string; match: RegExp }> = [
  { name: "Plex", match: /plex/i },
  { name: "Immich", match: /immich|postgres: vectors|valkey-server/i },
];

export function containerApp(cmdlines: string[]): string | null {
  for (const { name, match } of CONTAINER_APPS) {
    if (cmdlines.some((c) => match.test(c))) return name;
  }
  return null;
}

export type Level = "ok" | "warn" | "danger";

export function levelFor(value: number, warn: number, danger: number): Level {
  return value >= danger ? "danger" : value >= warn ? "warn" : "ok";
}

export const LEVEL_TEXT: Record<Level, string> = {
  ok: "text-emerald-400",
  warn: "text-amber-400",
  danger: "text-red-400",
};

// Discurile afișate, în ordine; restul montărilor (efi, overlay Docker) nu.
export const DISK_MOUNTS = [
  { mount: "/", label: "M.2 Bază" },
  { mount: "/media/ssd2tb", label: "M.2 2TB" },
  { mount: "/media/hddextern", label: "HDD Extern" },
] as const;

// Discul întreg al unei partiții: nvme1n1p2 → nvme1n1, sda1 → sda.
export function baseBlockDevice(dev: string): string {
  return /^nvme\d+n\d+/.exec(dev)?.[0] ?? dev.replace(/^(sd[a-z]+)\d+$/, "$1");
}

export interface SmartSummary {
  model?: string;
  passed: boolean | null;
  tempC?: number;
  powerOnHours?: number;
  wearPercent?: number;
  writtenBytes?: number;
  criticalWarning?: number;
  mediaErrors?: number;
  reallocated?: number;
  pending?: number;
  uncorrectable?: number;
  checkedAt: number;
}

// Praguri de temperatură pentru SSD: 75 / 80 °C, coborâte dacă firmware-ul
// declară un prag mai mic (SSD-ul de 512 GB: 74,85 °C). HDD-urile țin mai puțin.
export function diskTempLimits(kind: "ssd" | "hdd", firmwareMax?: number): [number, number] {
  if (kind === "hdd") return [50, 55];
  if (firmwareMax && firmwareMax < 80) return [firmwareMax - 5, firmwareMax];
  return [75, 80];
}

// Problemele raportate de SMART, ca text scurt; gol = disc sănătos.
export function smartProblems(s: SmartSummary): Array<{ level: Level; text: string }> {
  const out: Array<{ level: Level; text: string }> = [];
  if (s.passed === false) out.push({ level: "danger", text: "SMART: test eșuat" });
  if (s.criticalWarning) out.push({ level: "danger", text: "SMART: avertizare critică" });
  if (s.mediaErrors) out.push({ level: "warn", text: `${s.mediaErrors} erori de citire` });
  if (s.wearPercent != null && s.wearPercent >= 80) {
    out.push({ level: s.wearPercent >= 95 ? "danger" : "warn", text: `uzură ${s.wearPercent}%` });
  }
  const bad = (s.reallocated ?? 0) + (s.pending ?? 0) + (s.uncorrectable ?? 0);
  if (bad > 0) out.push({ level: "warn", text: `${bad} sectoare defecte` });
  return out;
}

// Un punct din istoricul de 10 minute (la 5 s), pentru graficele din carduri.
export interface HostHistoryPoint {
  ts: number;
  cpu?: number;
  mem?: number;
  cpuTemp?: number;
  gpuBusy?: number;
  rx?: number;
  tx?: number;
  disks: Record<string, { r: number; w: number }>;
}
