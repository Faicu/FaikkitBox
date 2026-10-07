import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp } from "lucide-react";

import { getFilelistTopTitles } from "@/lib/filelist/top-torrents.functions";
import { TOP_PERIODS, type TopPeriodHours } from "@/lib/filelist/top-torrents";
import type { DiscoverMediaType, DiscoverTitle } from "@/lib/tmdb/tmdb.discover.functions";
import { PosterCard } from "./PosterCard";
import { SceneViewer } from "./SceneViewer";

// Tabul „Top Filelist" — cele mai populare titluri dintre torrentele urcate
// recent (vezi top-torrents.functions.ts pentru fereastra și limitările ei).
export function TopTorrentsGrid({
  media,
  hours,
}: {
  media: DiscoverMediaType | "all";
  hours: TopPeriodHours;
}) {
  const [selected, setSelected] = useState<DiscoverTitle | null>(null);
  const topFn = useServerFn(getFilelistTopTitles);

  const query = useQuery({
    queryKey: ["filelistTop", hours],
    queryFn: () => topFn({ data: { hours } }),
    // Serverul ține lista în cache 15 min — nu are rost să întrebăm mai des.
    staleTime: 5 * 60_000,
  });

  const items = (query.data?.items ?? []).filter((i) => media === "all" || i.mediaType === media);
  const error = query.data?.error ?? (query.isError ? "Eroare la încărcare" : null);

  // Tipurile din vizualizare pentru care API-ul Filelist nu ajunge până la
  // începutul perioadei (serialele, de regulă, ~1 zi).
  const coverage = query.data?.coverage;
  const shortTypes = (["movie", "tv"] as const)
    .filter((t) => media === "all" || media === t)
    .map((t) => ({ t, h: coverage?.[t] ?? null }))
    .filter((c): c is { t: "movie" | "tv"; h: number } => c.h !== null && c.h < hours);
  const periodLabel = TOP_PERIODS.find((p) => p.hours === hours)?.label ?? `${hours}h`;

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">
        Cele mai populare dintre torrentele urcate pe Filelist în ultimele{" "}
        {hours === 168 ? "7 zile" : `${hours} de ore`}, după seederi + leecheri. Rating-ul e cel de
        pe IMDb.
      </p>
      {shortTypes.length > 0 && (
        <div className="rounded-xl bg-sky-500/10 px-3 py-2 text-xs text-sky-400">
          Filelist dă doar ultimele 100 de torrente pe categorie, deci pentru{" "}
          {shortTypes
            .map(
              ({ t, h }) =>
                `${t === "movie" ? "filme" : "seriale"} doar ultimele ~${formatHours(h)}`,
            )
            .join(" și ")}{" "}
          din {periodLabel}.
        </div>
      )}
      {query.isLoading ? (
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] skeleton-sweep rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl glass-card p-6 text-center text-sm text-muted-foreground">
          {error ? `Filelist indisponibil momentan: ${error}` : "Niciun rezultat găsit."}
        </div>
      ) : (
        <>
          {error && (
            <div className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
              Filelist indisponibil momentan — se afișează ultima listă obținută.
            </div>
          )}
          <div className="grid grid-cols-3 gap-3 stagger-in">
            {items.map((item) => (
              <PosterCard
                key={item.key}
                item={item}
                onClick={() => setSelected(item)}
                badge={
                  <>
                    <span className="flex items-center gap-0.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                      <ArrowUp className="h-2.5 w-2.5" />
                      {item.seeders}
                    </span>
                    {item.episodeLabel && (
                      <span className="rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {item.episodeLabel}
                      </span>
                    )}
                  </>
                }
              />
            ))}
          </div>
        </>
      )}

      {selected && <SceneViewer item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function formatHours(h: number): string {
  return h < 48 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)} zile`;
}
