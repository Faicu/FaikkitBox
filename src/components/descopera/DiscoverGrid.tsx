import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Star, Film, Tv } from "lucide-react";

import { getDiscoverTitles } from "@/lib/tmdb.discover.functions";
import type { DiscoverMediaType, DiscoverSort, DiscoverTitle } from "@/lib/tmdb.discover.functions";
import { SceneViewer } from "./SceneViewer";

export function DiscoverGrid({
  sort,
  media,
}: {
  sort: DiscoverSort;
  media: DiscoverMediaType | "all";
}) {
  const [selected, setSelected] = useState<DiscoverTitle | null>(null);

  const discoverFn = useServerFn(getDiscoverTitles);

  const movieQuery = useInfiniteQuery({
    queryKey: ["discover", "movie", sort],
    queryFn: ({ pageParam }) => discoverFn({ data: { mediaType: "movie", sort, page: pageParam } }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.items.length > 0 ? allPages.length + 1 : undefined,
    enabled: media === "all" || media === "movie",
  });
  const tvQuery = useInfiniteQuery({
    queryKey: ["discover", "tv", sort],
    queryFn: ({ pageParam }) => discoverFn({ data: { mediaType: "tv", sort, page: pageParam } }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.items.length > 0 ? allPages.length + 1 : undefined,
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
            <div key={i} className="aspect-[2/3] animate-pulse rounded-xl bg-muted/40" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
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
                    className="h-full w-full object-cover transition-transform group-hover:scale-[1.02] group-active:scale-95"
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

          {hasNextPage && (
            <button
              type="button"
              onClick={fetchMore}
              disabled={isFetchingNextPage}
              className="w-full rounded-xl bg-muted/50 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors disabled:opacity-50"
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
