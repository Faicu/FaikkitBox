import { useState } from "react";
import { BarChart3 } from "lucide-react";

import { UserAvatar } from "@/components/principala/UserAvatar";
import { countRo } from "@/lib/format";
import type { RecentWatchStats } from "@/lib/services/recent-watch-types";

type PeriodKey = keyof RecentWatchStats;

const PERIODS: Array<{ key: PeriodKey; tab: string; window: string; current: string }> = [
  { key: "day", tab: "Zi", window: "în ultimele 30 de zile", current: "Azi" },
  { key: "week", tab: "Săptămână", window: "în ultimele 12 săptămâni", current: "Săptămâna asta" },
  { key: "month", tab: "Lună", window: "în ultimele 12 luni", current: "Luna asta" },
];

// Vizionări pe zi / săptămână / lună și topul userilor pentru aceeași perioadă.
export function WatchStatsWidget({ stats }: { stats: RecentWatchStats }) {
  const [periodKey, setPeriodKey] = useState<PeriodKey>("day");
  // Bara atinsă; fără selecție, citirea arată perioada curentă (ultima bară).
  const [selected, setSelected] = useState<number | null>(null);

  const meta = PERIODS.find((p) => p.key === periodKey)!;
  const period = stats[periodKey];
  const buckets = period.buckets;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const shownIndex = selected ?? buckets.length - 1;
  const shown = buckets[shownIndex];
  const userMax = Math.max(1, ...period.users.map((u) => u.count));
  // Etichete selective pe axă: prima, mijlocul, ultima.
  const axisIdx = new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1]);

  return (
    <div className="corner-glow corner-glow-emerald mt-4 rounded-2xl glass-card p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400/25 to-teal-500/10 text-emerald-300 shadow-[0_0_22px_-6px] shadow-emerald-400/60 ring-1 ring-emerald-400/30">
          <BarChart3 className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-tight">Statistici vizionări</div>
          <div className="text-[11px] text-muted-foreground">
            {countRo(period.total, "vizionare", "vizionări")} {meta.window}
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-1 rounded-xl bg-muted/30 p-1" role="tablist">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={p.key === periodKey}
            onClick={() => {
              setPeriodKey(p.key);
              setSelected(null);
            }}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${
              p.key === periodKey
                ? "bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/30"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.tab}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">
          {selected == null ? meta.current : shown.label}
        </span>
        <span className="font-semibold tabular-nums text-foreground">
          {countRo(shown.count, "vizionare", "vizionări")}
        </span>
      </div>

      <div className="relative mt-2 h-32">
        {/* Linia maximului, discretă, cu valoarea ei. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-white/10" />
        <span className="pointer-events-none absolute top-0 right-0 -translate-y-full pb-0.5 text-[10px] text-muted-foreground/70 tabular-nums">
          {max}
        </span>
        <div className="flex h-full items-end gap-[2px]" onMouseLeave={() => setSelected(null)}>
          {buckets.map((b, i) => {
            const pct = (b.count / max) * 100;
            const active = i === shownIndex;
            return (
              <button
                key={b.key}
                type="button"
                aria-label={`${b.label}: ${countRo(b.count, "vizionare", "vizionări")}`}
                onMouseEnter={() => setSelected(i)}
                onFocus={() => setSelected(i)}
                onClick={() => setSelected(i)}
                className="flex h-full flex-1 items-end"
              >
                <span
                  className={`block w-full rounded-t-[4px] transition-colors ${
                    b.count === 0 ? "bg-white/10" : active ? "bg-emerald-300" : "bg-emerald-400/60"
                  }`}
                  style={{ height: b.count === 0 ? "2px" : `max(${pct}%, 3px)` }}
                />
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex gap-[2px] text-[10px] text-muted-foreground/80">
        {buckets.map((b, i) => (
          <span
            key={b.key}
            className={`flex-1 whitespace-nowrap ${
              i === 0 ? "text-left" : i === buckets.length - 1 ? "text-right" : "text-center"
            }`}
            style={{ visibility: axisIdx.has(i) ? "visible" : "hidden", minWidth: 0 }}
          >
            <span className="inline-block">{b.label}</span>
          </span>
        ))}
      </div>

      {period.users.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <div className="text-[11px] font-semibold tracking-wider text-emerald-300/80 uppercase">
            Pe utilizator
          </div>
          {period.users.map((u) => (
            <div key={u.username} className="flex items-center gap-2 text-xs">
              <UserAvatar name={u.username} />
              <span className="w-28 shrink-0 truncate text-foreground/90">{u.username}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                <span
                  className="block h-full rounded-full bg-emerald-400/60"
                  style={{ width: `${(u.count / userMax) * 100}%` }}
                />
              </span>
              <span className="w-8 shrink-0 text-right font-medium tabular-nums">{u.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
