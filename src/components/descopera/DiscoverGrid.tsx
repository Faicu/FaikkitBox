import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { discoverQuery } from "@/lib/queries";
import type {
  DiscoverMediaType,
  DiscoverSort,
  DiscoverTitle,
} from "@/lib/tmdb/tmdb.discover.functions";
import { PosterCard } from "./PosterCard";
import { SceneViewer } from "./SceneViewer";

export function DiscoverGrid({
  sort,
  media,
}: {
  sort: DiscoverSort;
  media: DiscoverMediaType | "all";
}) {
  const [selected, setSelected] = useState<DiscoverTitle | null>(null);

  const movieQuery = useInfiniteQuery({
    ...discoverQuery("movie", sort),
    enabled: media === "all" || media === "movie",
  });
  const tvQuery = useInfiniteQuery({
    ...discoverQuery("tv", sort),
    enabled: media === "all" || media === "tv",
  });

  const isLoading =
    (media === "all" || media === "movie" ? movieQuery.isLoading : false) ||
    (media === "all" || media === "tv" ? tvQuery.isLoading : false);

  const degraded =
    (media === "all" || media === "movie"
      ? (movieQuery.data?.pages.some((p) => p.degraded) ?? false)
      : false) ||
    (media === "all" || media === "tv"
      ? (tvQuery.data?.pages.some((p) => p.degraded) ?? false)
      : false);

  const items: DiscoverTitle[] = (() => {
    const movies = media === "tv" ? [] : (movieQuery.data?.pages.flatMap((p) => p.items) ?? []);
    const shows = media === "movie" ? [] : (tvQuery.data?.pages.flatMap((p) => p.items) ?? []);
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

  const hasNextPage =
    ((media === "all" || media === "movie") && movieQuery.hasNextPage) ||
    ((media === "all" || media === "tv") && tvQuery.hasNextPage);
  const isFetchingNextPage = movieQuery.isFetchingNextPage || tvQuery.isFetchingNextPage;

  function fetchMore() {
    if (media === "all" || media === "movie") movieQuery.fetchNextPage();
    if (media === "all" || media === "tv") tvQuery.fetchNextPage();
  }

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] skeleton-sweep rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl glass-card p-6 text-center text-sm text-muted-foreground">
          {degraded
            ? "Serviciul TMDB este indisponibil momentan. Încearcă din nou mai târziu."
            : "Niciun rezultat găsit."}
        </div>
      ) : (
        <>
          {degraded && (
            <div className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
              Serviciul TMDB este parțial indisponibil — rezultatele pot fi incomplete.
            </div>
          )}
          <div className="grid grid-cols-3 gap-3 stagger-in">
            {items.map((item) => (
              <PosterCard
                key={`${item.mediaType}-${item.id}`}
                item={item}
                onClick={() => setSelected(item)}
              />
            ))}
          </div>

          {hasNextPage && (
            <button
              type="button"
              onClick={fetchMore}
              disabled={isFetchingNextPage}
              className="w-full rounded-xl bg-muted/50 py-2 text-xs font-medium text-muted-foreground transition-all hover:bg-muted/80 hover:text-foreground active:scale-[0.98] disabled:opacity-50"
            >
              {isFetchingNextPage ? "Se încarcă..." : "Încarcă mai multe"}
            </button>
          )}
        </>
      )}

      {selected && <SceneViewer item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
