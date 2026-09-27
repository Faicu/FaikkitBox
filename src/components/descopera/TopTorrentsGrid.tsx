import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp } from "lucide-react";

import { getFilelistTopTitles } from "@/lib/filelist/top-torrents.functions";
import type { DiscoverMediaType, DiscoverTitle } from "@/lib/tmdb/tmdb.discover.functions";
import { PosterCard } from "./PosterCard";
import { SceneViewer } from "./SceneViewer";

// Tabul „Top Filelist" — cele mai populare titluri dintre torrentele urcate
// recent (vezi top-torrents.functions.ts pentru fereastra și limitările ei).
export function TopTorrentsGrid({ media }: { media: DiscoverMediaType | "all" }) {
  const [selected, setSelected] = useState<DiscoverTitle | null>(null);
  const topFn = useServerFn(getFilelistTopTitles);

  const query = useQuery({
    queryKey: ["filelistTop"],
    queryFn: () => topFn(),
    // Serverul ține lista în cache 15 min — nu are rost să întrebăm mai des.
    staleTime: 5 * 60_000,
  });

  const items = (query.data?.items ?? []).filter((i) => media === "all" || i.mediaType === media);
  const error = query.data?.error ?? (query.isError ? "Eroare la încărcare" : null);

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">
        Cele mai populare dintre torrentele urcate recent pe Filelist (ultimele ~2 zile), după
        seederi + leecheri.
      </p>
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
