import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Star, Film, Tv } from "lucide-react";

import { getDiscoverTitles } from "@/lib/tmdb.discover.functions";
import type { DiscoverMediaType, DiscoverSort, DiscoverTitle } from "@/lib/tmdb.discover.functions";
import { SceneViewer } from "./SceneViewer";

export function DiscoverGrid({
  sort,
  media,
  isAdmin,
}: {
  sort: DiscoverSort;
  media: DiscoverMediaType | "all";
  isAdmin: boolean;
}) {
  const [selected, setSelected] = useState<DiscoverTitle | null>(null);

  const discoverFn = useServerFn(getDiscoverTitles);

  const movieQuery = useQuery({
    queryKey: ["discover", "movie", sort],
    queryFn: () => discoverFn({ data: { mediaType: "movie", sort } }),
    enabled: media === "all" || media === "movie",
  });
  const tvQuery = useQuery({
    queryKey: ["discover", "tv", sort],
    queryFn: () => discoverFn({ data: { mediaType: "tv", sort } }),
    enabled: media === "all" || media === "tv",
  });

  const isLoading =
    (media === "all" || media === "movie" ? movieQuery.isLoading : false) ||
    (media === "all" || media === "tv" ? tvQuery.isLoading : false);

  const items: DiscoverTitle[] = (() => {
    const movies = media === "tv" ? [] : (movieQuery.data ?? []);
    const shows = media === "movie" ? [] : (tvQuery.data ?? []);
    if (media === "all") {
      // interclasare simplă movie/tv ca să nu fie toate filmele primele
      const merged: DiscoverTitle[] = [];
      const max = Math.max(movies.length, shows.length);
      for (let i = 0; i < max; i++) {
        if (movies[i]) merged.push(movies[i]);
        if (shows[i]) merged.push(shows[i]);
      }
      return merged;
    }
    return [...movies, ...shows];
  })();

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] animate-pulse rounded-xl bg-muted/40" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Niciun rezultat găsit.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {items.map((item) => (
            <button
              key={`${item.mediaType}-${item.id}`}
              type="button"
              onClick={() => setSelected(item)}
              className="group relative aspect-[2/3] overflow-hidden rounded-xl border border-border bg-muted/40 text-left"
            >
              {item.posterUrl ? (
                <img
                  src={item.posterUrl}
                  alt=""
                  className="h-full w-full object-cover transition-transform group-active:scale-95"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  {item.mediaType === "movie" ? (
                    <Film className="h-6 w-6 text-muted-foreground/40" />
                  ) : (
                    <Tv className="h-6 w-6 text-muted-foreground/40" />
                  )}
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 pt-6">
                <div className="line-clamp-2 text-[11px] font-medium leading-tight text-white">
                  {item.title}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-white/70">
                  {item.year && <span>{item.year}</span>}
                  {item.voteAverage != null && (
                    <span className="flex items-center gap-0.5">
                      <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                      {item.voteAverage.toFixed(1)}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <SceneViewer item={selected} isAdmin={isAdmin} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
