import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Star, Film, Tv } from "lucide-react";

import { getDiscoverTitles } from "@/lib/tmdb.discover.functions";
import type { DiscoverMediaType, DiscoverSort, DiscoverTitle } from "@/lib/tmdb.discover.functions";
import { SceneViewer } from "./SceneViewer";

const sortTabs: { value: DiscoverSort; label: string }[] = [
  { value: "trending", label: "Trending" },
  { value: "popular_all_time", label: "Populare all-time" },
  { value: "newest", label: "Cele mai noi" },
];

const mediaTabs: { value: DiscoverMediaType | "all"; label: string }[] = [
  { value: "all", label: "Tot" },
  { value: "movie", label: "Filme" },
  { value: "tv", label: "Seriale" },
];

export function DiscoverGrid() {
  const [sort, setSort] = useState<DiscoverSort>("trending");
  const [media, setMedia] = useState<DiscoverMediaType | "all">("all");
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
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {sortTabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setSort(tab.value)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              sort === tab.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5">
        {mediaTabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setMedia(tab.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              media === tab.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

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

      {selected && <SceneViewer item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
