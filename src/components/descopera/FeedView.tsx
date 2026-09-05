import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Loader2, Plus } from "lucide-react";

import { getFeedClips } from "@/lib/tmdb/tmdb.discover.functions";
import type { DiscoverMediaType, DiscoverSort, FeedClip } from "@/lib/tmdb/tmdb.discover.functions";
import { getTmdbDetails } from "@/lib/tmdb/tmdb.functions";
import { AddMediaWizard } from "@/components/principala/AddMediaWizard";

function FeedCard({ clip, isActive }: { clip: FeedClip; isActive: boolean }) {
  const detailsFn = useServerFn(getTmdbDetails);
  const detailsQuery = useQuery({
    queryKey: ["tmdbDetails", clip.mediaType, clip.id],
    queryFn: () => detailsFn({ data: { id: clip.id, mediaType: clip.mediaType } }),
    enabled: isActive,
  });
  const imdbId = detailsQuery.data?.imdbId ?? null;
  const [wizardOpen, setWizardOpen] = useState(false);

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
            <div className="truncate text-base font-semibold text-white">{clip.originalTitle}</div>
            <div className="text-xs text-white/70">
              {clip.mediaType === "movie" ? "Film" : "Serial"}
              {clip.year && ` · ${clip.year}`}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setWizardOpen(true)}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-transform hover:bg-primary/90 active:scale-[0.96]"
              >
                <Plus className="h-3.5 w-3.5" /> Adaugă
              </button>
            </div>
          </div>
          {imdbId && (
            <a
              href={`https://www.imdb.com/title/${imdbId}/`}
              target="_blank"
              rel="noreferrer"
              className="flex shrink-0 items-center gap-1 rounded-lg bg-white/15 px-3 py-2 text-xs font-medium text-white backdrop-blur transition-transform hover:bg-white/25 active:scale-[0.96]"
            >
              IMDb <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>

      <AddMediaWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        initialItem={{
          id: clip.id,
          mediaType: clip.mediaType,
          title: clip.title,
          originalTitle: detailsQuery.data?.originalTitle ?? clip.title,
          year: clip.year,
          posterUrl: clip.posterUrl,
        }}
      />
    </div>
  );
}

export function FeedView({
  sort,
  media,
}: {
  sort: DiscoverSort;
  media: DiscoverMediaType | "all";
}) {
  const feedFn = useServerFn(getFeedClips);
  const query = useQuery({
    queryKey: ["feedClips", media, sort],
    queryFn: () => feedFn({ data: { mediaType: media, sort } }),
  });

  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const degraded = query.data?.degraded ?? false;
  const clips = ((): FeedClip[] => {
    const all = query.data?.clips ?? [];
    let seen = new Set<string>();
    try {
      seen = new Set(JSON.parse(sessionStorage.getItem("feedSeenClips") ?? "[]"));
    } catch {
      seen = new Set();
    }
    const unseen = all.filter((c) => !seen.has(`${c.mediaType}-${c.id}`));
    return unseen.length > 0 ? unseen : all;
  })();

  useEffect(() => {
    if (clips.length === 0) return;
    const active = clips[activeIndex];
    if (!active) return;
    let seen: string[] = [];
    try {
      seen = JSON.parse(sessionStorage.getItem("feedSeenClips") ?? "[]");
    } catch {
      seen = [];
    }
    const key = `${active.mediaType}-${active.id}`;
    if (!seen.includes(key)) {
      sessionStorage.setItem("feedSeenClips", JSON.stringify([...seen, key]));
    }
  }, [activeIndex, clips]);

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
      <div className="flex h-[calc(100dvh-13rem)] items-center justify-center rounded-2xl border border-border bg-black/60">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-xs">Se încarcă clipurile...</span>
        </div>
      </div>
    );
  }

  if (clips.length === 0) {
    return (
      <div className="rounded-xl glass-card p-6 text-center text-sm text-muted-foreground">
        {degraded
          ? "Serviciul TMDB este indisponibil momentan. Încearcă din nou mai târziu."
          : "Niciun clip disponibil pentru filtrele curente."}
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
          <FeedCard clip={clip} isActive={i === activeIndex} />
        </div>
      ))}
    </div>
  );
}
