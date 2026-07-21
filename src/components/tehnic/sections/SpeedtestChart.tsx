import type { SpeedtestHistoryEntry } from "@/lib/speedtest.functions";

export function SpeedtestChart({ history }: { history: SpeedtestHistoryEntry[] }) {
  const sorted = [...history].reverse();
  const BAR_H = 80; // px — înălțimea maximă a barelor
  const maxDl = Math.max(...sorted.map((h) => h.download), 1);
  const maxUp = Math.max(...sorted.map((h) => h.upload), 1);
  const maxAll = Math.max(maxDl, maxUp);

  const fmt = (v: number) => {
    const mb = v / 1_000_000;
    return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB/s` : `${mb.toFixed(0)} MB/s`;
  };

  const fmtDate = (ts: string) =>
    new Date(ts).toLocaleDateString("ro-RO", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Istoric ({sorted.length} teste)
      </div>
      <div className="rounded-xl border border-border bg-card p-3">
        {/* Grafic bare */}
        <div className="flex items-end gap-1.5" style={{ height: BAR_H }}>
          {sorted.map((h) => {
            const dlH = Math.max(4, Math.round((h.download / maxAll) * BAR_H));
            const upH = Math.max(4, Math.round((h.upload / maxAll) * BAR_H));
            return (
              <div key={h.id} className="flex-1 flex flex-row items-end gap-px group relative">
                <div
                  className="flex-1 rounded-t bg-sky-500/70 group-hover:bg-sky-400 transition-colors"
                  style={{ height: dlH }}
                />
                <div
                  className="flex-1 rounded-t bg-emerald-500/70 group-hover:bg-emerald-400 transition-colors"
                  style={{ height: upH }}
                />
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                  <div className="rounded-lg bg-popover border border-border px-2.5 py-1.5 text-[10px] whitespace-nowrap shadow-lg space-y-0.5">
                    <div className="text-sky-400">↓ {fmt(h.download)}</div>
                    <div className="text-emerald-400">↑ {fmt(h.upload)}</div>
                    <div className="text-muted-foreground border-t border-border/50 pt-0.5 mt-0.5">
                      {fmtDate(h.timestamp)}
                    </div>
                  </div>
                  <div className="w-1.5 h-1.5 bg-popover border-b border-r border-border rotate-45 -mt-1" />
                </div>
              </div>
            );
          })}
        </div>
        {/* Legendă + valori min/max */}
        <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-sky-500/70" />
              Download
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-emerald-500/70" />
              Upload
            </span>
          </div>
          <span>max {fmt(maxAll)}</span>
        </div>
      </div>
    </div>
  );
}
