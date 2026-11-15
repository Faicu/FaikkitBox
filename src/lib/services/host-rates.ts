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

// Docker raportează CPU pe un nucleu (până la nuclee × 100), spre deosebire de
// procese și de cardul Procesor, care sunt raportate la toate nucleele.
export function normalizeContainerCpu(dockerPercent: number, cores: number | undefined): number {
  return cores && cores > 0 ? dockerPercent / cores : dockerPercent;
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
