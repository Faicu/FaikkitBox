import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Shuffle } from "lucide-react";

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { getTmdbVideos } from "@/lib/tmdb.discover.functions";
import type { DiscoverTitle } from "@/lib/tmdb.discover.functions";
import { getTmdbDetails } from "@/lib/tmdb.functions";

export function SceneViewer({ item, onClose }: { item: DiscoverTitle; onClose: () => void }) {
  const videosFn = useServerFn(getTmdbVideos);
  const detailsFn = useServerFn(getTmdbDetails);
  const [videoIndex, setVideoIndex] = useState(0);

  const videosQuery = useQuery({
    queryKey: ["tmdbVideos", item.mediaType, item.id],
    queryFn: () => videosFn({ data: { id: item.id, mediaType: item.mediaType } }),
  });
  const detailsQuery = useQuery({
    queryKey: ["tmdbDetails", item.mediaType, item.id],
    queryFn: () => detailsFn({ data: { id: item.id, mediaType: item.mediaType } }),
  });

  const videos = videosQuery.data ?? [];
  const current = videos[videoIndex] ?? null;
  const imdbId = detailsQuery.data?.imdbId ?? null;

  const otherVideosCount = useMemo(() => Math.max(0, videos.length - 1), [videos]);

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader className="text-left pb-0">
          <DrawerTitle>{item.title}</DrawerTitle>
        </DrawerHeader>
        <div className="space-y-3 overflow-y-auto px-4 pb-6 pt-3">
          {videosQuery.isLoading ? (
            <div className="aspect-video animate-pulse rounded-xl bg-muted/40" />
          ) : current ? (
            <div className="aspect-video overflow-hidden rounded-xl bg-black">
              <iframe
                key={current.key}
                src={`https://www.youtube.com/embed/${current.key}?autoplay=1`}
                title={current.name || item.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="h-full w-full"
              />
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              Niciun clip disponibil pentru acest titlu.
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            {otherVideosCount > 0 ? (
              <button
                type="button"
                onClick={() => setVideoIndex((i) => (i + 1) % videos.length)}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60"
              >
                <Shuffle className="h-3.5 w-3.5" /> Alt clip ({otherVideosCount} altele)
              </button>
            ) : (
              <span />
            )}
            {imdbId && (
              <a
                href={`https://www.imdb.com/title/${imdbId}/`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                IMDb <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
