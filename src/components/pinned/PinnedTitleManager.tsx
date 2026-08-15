import type { WatchSettings } from "@/lib/pinned.functions";
import type { TvPlexStatus } from "./plex-status";
import { PinnedItemCard } from "./PinnedItemCard";

const DEFAULT_WATCH_SETTINGS = (id: number, mediaType: "movie" | "tv"): WatchSettings => ({
  id,
  mediaType,
  watchFilelist: false,
  watchFilelistSeason: false,
  watchTmdb: false,
  autoDownload: false,
  autoDownloadQuality: "1080p",
});

// Panoul complet de gestionare a unui titlu fixat (sezoane/episoade, status
// Plex, countdown, toggle-uri watch/auto-download) — portat din fostele
// carduri Lansări (PinnedItemCard/MovieCard/ShowCard), afișat direct în
// drawer-ul de detalii al Bibliotecii, unicul loc unde apar titlurile fixate.
export function PinnedTitleManager({
  tmdbId,
  mediaType,
  title,
  originalTitle,
  posterUrl,
  watchSettings,
  onWatchChange,
  onUnpin,
  onPlexStatus,
}: {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  originalTitle: string | null;
  posterUrl: string | null;
  watchSettings: WatchSettings | null;
  onWatchChange: (patch: Partial<WatchSettings>) => void;
  onUnpin: () => void;
  onPlexStatus?: (status: TvPlexStatus | null, loading: boolean) => void;
}) {
  return (
    <PinnedItemCard
      item={{
        id: tmdbId,
        mediaType,
        title,
        originalTitle: originalTitle || title,
        posterUrl,
      }}
      watchSettings={watchSettings ?? DEFAULT_WATCH_SETTINGS(tmdbId, mediaType)}
      onWatchChange={onWatchChange}
      onUnpin={onUnpin}
      onPlexStatus={onPlexStatus}
    />
  );
}
