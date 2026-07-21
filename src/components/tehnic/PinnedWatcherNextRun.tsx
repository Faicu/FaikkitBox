import { useState, useEffect } from "react";

export function PinnedWatcherNextRun({ nextRun }: { nextRun: string | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!nextRun) return null;
  const ms = new Date(nextRun).getTime() - Date.now();
  if (ms <= 0)
    return <span className="text-[10px] text-emerald-400 whitespace-nowrap">în curând</span>;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const label =
    h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s).padStart(2, "0")}s`;
  return (
    <span className="text-[10px] text-muted-foreground whitespace-nowrap">următoarea: {label}</span>
  );
}
