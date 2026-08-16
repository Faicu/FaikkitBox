import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Film, Tv } from "lucide-react";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { unpinTitleEverywhere, getWatchSettings, setWatchSettings } from "@/lib/pinned.functions";
import type { WatchSettings } from "@/lib/pinned.functions";
import { PinnedTitleManager } from "@/components/pinned/PinnedTitleManager";
import type { TvPlexStatus } from "@/components/pinned/plex-status";
import { PlexStatusBadge } from "@/components/pinned/PlexStatusBadge";
import type { WatchingItem } from "@/lib/services/plex-browse";

// Drawer pentru un titlu DOAR fixat (secțiunea "Urmărite" din Bibliotecă) —
// spre deosebire de TitleDetailDrawer, nu există niciun rând `media` în
// spate (nimic descărcat încă), deci nu există subtitrare/durată/istoric de
// vizionare de arătat — doar panoul de gestionare a fixării (sezoane, status
// Plex, descărcare), identic cu cel din TitleDetailDrawer.
export function WatchingTitleDrawer({
  item,
  onClose,
}: {
  item: WatchingItem | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [plexStatus, setPlexStatus] = useState<TvPlexStatus | null>(null);
  const [plexLoading, setPlexLoading] = useState(false);

  const unpinFn = useServerFn(unpinTitleEverywhere);
  const getWatchFn = useServerFn(getWatchSettings);
  const setWatchFn = useServerFn(setWatchSettings);

  const { data: watchList = [] } = useQuery({
    queryKey: ["watchSettings"],
    queryFn: () => getWatchFn({}),
    staleTime: 10_000,
  });
  const watchSettings = item
    ? (watchList.find((w) => w.id === item.tmdbId && w.mediaType === item.mediaType) ?? null)
    : null;

  async function onWatchChange(patch: Partial<WatchSettings>) {
    if (!item) return;
    const current = watchSettings ?? {
      id: item.tmdbId,
      mediaType: item.mediaType,
      watchFilelist: false,
      watchFilelistSeason: false,
      watchTmdb: false,
      autoDownload: false,
      autoDownloadQuality: "1080p" as const,
    };
    const next = { ...current, ...patch };
    if (!next.watchFilelist) {
      next.watchFilelistSeason = false;
      next.autoDownload = false;
    }
    await setWatchFn({ data: next }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ["watchSettings"] });
  }

  async function onUnpin() {
    if (!item) return;
    await unpinFn({ data: { id: item.tmdbId, mediaType: item.mediaType } }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ["pinnedItems"] });
    queryClient.invalidateQueries({ queryKey: ["plexLibraryBrowse"] });
    onClose();
  }

  return (
    <Drawer open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="pb-2 text-left">
          <div className="flex items-start gap-3">
            {item?.posterUrl && (
              <img
                src={item.posterUrl}
                className="h-20 w-14 shrink-0 rounded-lg object-cover bg-muted"
                loading="lazy"
                alt=""
              />
            )}
            <div className="min-w-0">
              <DrawerTitle className="flex items-center gap-2 text-base">
                {item?.mediaType === "movie" ? (
                  <Film className="h-4 w-4 text-amber-400 shrink-0" />
                ) : (
                  <Tv className="h-4 w-4 text-blue-400 shrink-0" />
                )}
                {item?.title ?? "Se încarcă…"}
              </DrawerTitle>
              <DrawerDescription className="text-left text-xs mt-1">
                Doar fixat — nimic descărcat încă
              </DrawerDescription>
            </div>
          </div>
        </DrawerHeader>

        {item && (
          <div className="px-4 pb-6 space-y-3 overflow-y-auto max-h-[65vh]">
            {item.mediaType === "tv" && (
              <div className="flex items-center gap-2 text-xs">
                {plexLoading ? (
                  <span className="h-5 w-20 animate-pulse rounded-full bg-muted/40" />
                ) : (
                  <PlexStatusBadge status={plexStatus ?? "lipsa"} />
                )}
              </div>
            )}
            <PinnedTitleManager
              tmdbId={item.tmdbId}
              mediaType={item.mediaType}
              title={item.title}
              originalTitle={item.originalTitle}
              posterUrl={item.posterUrl}
              watchSettings={watchSettings}
              onWatchChange={onWatchChange}
              onUnpin={onUnpin}
              onPlexStatus={(status, loading) => {
                setPlexStatus(status);
                setPlexLoading(loading);
              }}
            />
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
