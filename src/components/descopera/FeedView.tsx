import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Loader2 } from "lucide-react";

import { getFeedClips } from "@/lib/tmdb.discover.functions";
import type { DiscoverMediaType, DiscoverSort, FeedClip } from "@/lib/tmdb.discover.functions";
import { getTmdbDetails } from "@/lib/tmdb.functions";
import { FilelistCheckButton } from "./FilelistCheckButton";

function FeedCard({
  clip,
  isActive,
  isAdmin,
}: {
  clip: FeedClip;
  isActive: boolean;
  isAdmin: boolean;
}) {
  const detailsFn = useServerFn(getTmdbDetails);
  const detailsQuery = useQuery({
    queryKey: ["tmdbDetails", clip.mediaType, clip.id],
    queryFn: () => detailsFn({ data: { id: clip.id, mediaType: clip.mediaType } }),
    enabled: isActive,
  });
  const imdbId = detailsQuery.data?.imdbId ?? null;

  return (
    <div className="relative flex h-full w-full snap-start items-center justify-center bg-black">
      {isActive ? (
        <iframe
          key={clip.videoKey}
          src={`https://www.youtube.com/embed/${clip.videoKey}?autoplay=1&mute=1&playsinline=1&controls=1`}
          title={clip.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          {clip.posterUrl && (
            <img src={clip.posterUrl} alt="" className="h-full w-full object-cover opacity-40" />
          )}
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-4 pt-16">
        <div className="pointer-events-auto flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-white">{clip.title}</div>
            <div className="text-xs text-white/70">
              {clip.mediaType === "movie" ? "Film" : "Serial"}
              {clip.year && ` · ${clip.year}`}
            </div>
            <div className="mt-2">
              <FilelistCheckButton title={clip.title} mediaType={clip.mediaType} isAdmin={isAdmin} />
            </div>
          </div>
          {imdbId && (
            <a
              href={`https://www.imdb.com/title/${imdbId}/`}
              target="_blank"
              rel="noreferrer"
              className="flex shrink-0 items-center gap-1 rounded-lg bg-white/15 px-3 py-2 text-xs font-medium text-white backdrop-blur hover:bg-white/25"
            >
              IMDb <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export function FeedView({
  sort,
  media,
  isAdmin,
}: {
  sort: DiscoverSort;
  media: DiscoverMediaType | "all";
  isAdmin: boolean;
}) {
  const feedFn = useServerFn(getFeedClips);
  const query = useQuery({
    queryKey: ["feedClips", media, sort],
    queryFn: () => feedFn({ data: { mediaType: media, sort } }),
  });

  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const clips = query.data ?? [];

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
            const idx = cardRefs.current.indexOf(entry.target as HTMLDivElement);
            if (idx !== -1) setActiveIndex(idx);
          }
        }
      },
      { root: container, threshold: [0.6] },
    );

    for (const el of cardRefs.current) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [clips.length]);

  if (query.isLoading) {
    return (
      <div className="flex h-[70vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (clips.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Niciun clip disponibil pentru filtrele curente.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-[calc(100dvh-13rem)] snap-y snap-mandatory overflow-y-scroll rounded-2xl border border-border"
    >
      {clips.map((clip, i) => (
        <div
          key={`${clip.mediaType}-${clip.id}`}
          ref={(el) => {
            cardRefs.current[i] = el;
          }}
          className="h-full w-full snap-start"
        >
          <FeedCard clip={clip} isActive={i === activeIndex} isAdmin={isAdmin} />
        </div>
      ))}
    </div>
  );
}
