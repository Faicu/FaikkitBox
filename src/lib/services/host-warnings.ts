// Avertizările din banda de sus a paginii Sistem — aceleași praguri ca la
// carduri, ca banda și culorile să nu se contrazică. Pur, sigur și în client.

import type { HostData } from "./host";
import { DISK_MOUNTS, levelFor, smartProblems, type Level } from "./host-rates";

export interface HostWarning {
  level: Exclude<Level, "ok">;
  text: string;
}

export const MEM_LIMITS = [80, 92] as const;
export const SWAP_LIMITS = [50, 80] as const;
export const CPU_TEMP_LIMITS = [80, 90] as const;
export const DISK_USE_LIMITS = [75, 90] as const;

const fmt = (n: number) => n.toFixed(0);

export function hostWarnings(d: HostData): HostWarning[] {
  const out: HostWarning[] = [];
  const add = (level: Level, text: string) => {
    if (level !== "ok") out.push({ level, text });
  };

  if (d.memPercent != null) {
    add(levelFor(d.memPercent, ...MEM_LIMITS), `Memorie ${fmt(d.memPercent)}%`);
  }
  if (d.swapTotalBytes) {
    const pct = ((d.swapUsedBytes ?? 0) / d.swapTotalBytes) * 100;
    add(levelFor(pct, ...SWAP_LIMITS), `Swap ${fmt(pct)}%`);
  }
  if (d.cpuTemp != null) {
    add(levelFor(d.cpuTemp, ...CPU_TEMP_LIMITS), `Procesor ${fmt(d.cpuTemp)} °C`);
  }
  if (d.gpu?.temp != null) {
    add(levelFor(d.gpu.temp, ...CPU_TEMP_LIMITS), `Placa video ${fmt(d.gpu.temp)} °C`);
  }
  for (const { mount, label } of DISK_MOUNTS) {
    const disk = d.disks?.find((x) => x.mount === mount);
    if (!disk) {
      out.push({ level: "danger", text: `${label} nemontat` });
      continue;
    }
    add(levelFor(disk.percent, ...DISK_USE_LIMITS), `${label} plin ${fmt(disk.percent)}%`);
    if (disk.temp != null) {
      add(levelFor(disk.temp, ...disk.tempLimits), `${label} ${fmt(disk.temp)} °C`);
    }
    for (const p of disk.smart ? smartProblems(disk.smart) : []) {
      out.push({ level: p.level === "danger" ? "danger" : "warn", text: `${label}: ${p.text}` });
    }
  }
  // Întâi cele grave.
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "danger" ? -1 : 1));
}
