// Istoricul paginii Sistem: un punct la 5 s, ultimele 10 minute, doar în
// memorie (se pierde la repornire, intenționat). Eșantionat în fundal, din
// plugin, ca graficele să fie pline imediat ce se deschide pagina.

import { DISK_MOUNTS, type HostHistoryPoint } from "./host-rates";
import {
  readCpuTimes,
  readDiskstats,
  readHwmon,
  readMemPercent,
  readMountDevices,
  readNetTotals,
} from "./host-sensors.server";

const SAMPLE_MS = 5000;
const KEEP = (10 * 60_000) / SAMPLE_MS;

const points: HostHistoryPoint[] = [];
let prev: {
  ts: number;
  cpu: { idle: number; total: number } | null;
  net: { rx: number; tx: number };
  disks: Record<string, { readBytes: number; writeBytes: number }>;
} | null = null;
let started = false;

async function sample(): Promise<void> {
  const ts = Date.now();
  const [cpu, mem, hwmon, net, diskstats, mounts] = await Promise.all([
    readCpuTimes(),
    readMemPercent(),
    readHwmon(),
    readNetTotals(),
    readDiskstats(),
    readMountDevices(),
  ]);
  const disksByMount: Record<string, { readBytes: number; writeBytes: number }> = {};
  for (const { mount } of DISK_MOUNTS) {
    const counters = mounts[mount] ? diskstats[mounts[mount]] : undefined;
    if (counters) disksByMount[mount] = counters;
  }

  if (prev) {
    const dt = (ts - prev.ts) / 1000;
    const rate = (a: number, b: number) => Math.max(0, (a - b) / dt);
    const point: HostHistoryPoint = {
      ts,
      mem: mem ?? undefined,
      cpuTemp: hwmon.cpuTemp,
      gpuBusy: hwmon.gpu?.busyPercent,
      rx: rate(net.rx, prev.net.rx),
      tx: rate(net.tx, prev.net.tx),
      disks: {},
    };
    if (cpu && prev.cpu && cpu.total > prev.cpu.total) {
      point.cpu = 100 * (1 - (cpu.idle - prev.cpu.idle) / (cpu.total - prev.cpu.total));
    }
    for (const [mount, cur] of Object.entries(disksByMount)) {
      const old = prev.disks[mount];
      if (old) {
        point.disks[mount] = {
          r: rate(cur.readBytes, old.readBytes),
          w: rate(cur.writeBytes, old.writeBytes),
        };
      }
    }
    points.push(point);
    if (points.length > KEEP) points.splice(0, points.length - KEEP);
  }
  prev = { ts, cpu, net, disks: disksByMount };
}

export function startHostHistory(): void {
  if (started) return;
  started = true;
  const tick = () => {
    sample()
      .catch((e) => console.warn("[host-history] eșantion eșuat:", e))
      .finally(() => setTimeout(tick, SAMPLE_MS).unref());
  };
  tick();
}

export function hostHistory(): HostHistoryPoint[] {
  return points;
}
