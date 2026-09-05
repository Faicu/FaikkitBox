// Reglaj pentru ritmul statisticilor live. Preferință per-dispozitiv
// (localStorage) — vezi lib/refresh-rate.ts.

import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";

import { REFRESH_PRESETS, getRefreshMs, setRefreshMs, onRefreshMsChange } from "@/lib/refresh-rate";

export function RefreshRateCard() {
  // Pornim de la implicit și citim localStorage abia după montare: pe server
  // nu există localStorage, iar o valoare diferită la hidratare ar produce
  // exact mismatch-ul React reparat în fe0460b.
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    setMs(getRefreshMs());
    return onRefreshMsChange(setMs);
  }, []);

  return (
    <div className="rounded-2xl border border-border bg-card p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">Ritm de reîmprospătare</span>
      </div>

      <div className="grid grid-cols-6 gap-1.5">
        {REFRESH_PRESETS.map((p) => {
          const active = ms === p.ms;
          return (
            <button
              key={p.ms}
              type="button"
              onClick={() => setRefreshMs(p.ms)}
              aria-pressed={active}
              className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors active:scale-95 ${
                active
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-muted/60"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground">
        Cât de des se recer statisticile live (Sistem, qBittorrent, Immich, sesiuni Plex). Listele
        care se schimbă mai rar — Jurnal de Activitate, Erori aplicație — folosesc multipli ai
        acestei valori. Setarea e salvată doar pe dispozitivul curent.
      </p>
    </div>
  );
}
