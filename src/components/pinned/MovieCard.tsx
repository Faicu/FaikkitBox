import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  PinOff,
  ExternalLink,
  CheckCircle2,
  Download,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

import type { TmdbDetails } from "@/lib/tmdb.functions";
import type { WatchSettings } from "@/lib/pinned.functions";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import type { PinnedItem } from "./types";
import { detectQuality } from "./utils";
import { useDownload } from "./hooks";
import { QualityDownloadButton } from "./badges";
import { PlexStatusBadge } from "./PlexStatusBadge";
import { DownloadConfirmDialog } from "./DownloadConfirmDialog";
import { WatchTogglePanel } from "./WatchTogglePanel";

// ---------------------------------------------------------------------------
// MovieCard
// ---------------------------------------------------------------------------

export function MovieCard({
  item,
  details,
  plexInfo,
  torrents,
  filelistLoading,
  isOpen,
  onToggleOpen,
  watchSettings,
  onWatchChange,
  onUnpin,
}: {
  item: PinnedItem;
  details: TmdbDetails | null;
  plexInfo: { found: boolean; quality: string | null } | null;
  torrents: FilelistTorrent[];
  filelistLoading: boolean;
  isOpen: boolean;
  onToggleOpen: () => void;
  watchSettings: WatchSettings;
  onWatchChange: (patch: Partial<WatchSettings>) => void;
  onUnpin: () => void;
}) {
  const { downloading, handleDownload } = useDownload({
    mediaType: "movie",
    imdbId: details?.imdbId ?? null,
    tmdbId: item.id,
    title: item.title,
    originalTitle: item.originalTitle,
    literalTitle: details?.literalTitle ?? null,
    overviewRo: details?.overview ?? null,
    genres: details?.genres ?? [],
    posterUrl: item.posterUrl,
  });
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<{ torrent: FilelistTorrent; label: string } | null>(null);

  const imdbId = details?.imdbId ?? null;
  const plexStatus =
    plexInfo?.found === true ? "complet" : plexInfo?.found === false ? "lipsa" : null;
  const plexQuality = plexInfo?.quality ?? null;

  const t720 = torrents.filter((t) => detectQuality(t.name).is720p);
  const t1080 = torrents.filter((t) => detectQuality(t.name).is1080p);
  const t4k = torrents.filter((t) => detectQuality(t.name).is4k);
  const t4kHdr = torrents.filter((t) => detectQuality(t.name).is4kHdr);

  return (
    <>
      {confirm && (
        <DownloadConfirmDialog
          torrent={confirm.torrent}
          label={confirm.label}
          onConfirm={() => {
            handleDownload(confirm.torrent);
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          {imdbId ? (
            <a
              href={`https://www.imdb.com/title/${imdbId}/`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              IMDb <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {plexStatus === "complet" ? (
              <>
                {plexQuality && (
                  <span className="text-[11px] text-muted-foreground">{plexQuality}</span>
                )}
                <span className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> În bibliotecă
                </span>
              </>
            ) : plexStatus === "lipsa" ? (
              <PlexStatusBadge status="lipsa" />
            ) : (
              <span className="h-6 w-24 animate-pulse rounded-lg bg-muted/40" />
            )}
            <button
              type="button"
              onClick={() => {
                onUnpin();
                qc.removeQueries({ queryKey: ["tmdbDetails", "movie", item.id] });
              }}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              title="Scoate din fixări"
            >
              <PinOff className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleOpen}
          className="flex w-full items-center justify-center gap-1 rounded-xl border border-border bg-muted/40 py-2 text-xs font-medium text-foreground hover:bg-muted/60 transition-colors"
        >
          {isOpen ? "Mai puține detalii" : "Mai multe detalii"}
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>

        {isOpen && (
          <>
            <div>
              <div className="mb-2 flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                <Download className="h-3 w-3" /> Descarcă de pe Filelist
                {filelistLoading && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
              </div>
              {!filelistLoading && torrents.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  Niciun torrent găsit pe Filelist.
                </div>
              ) : (
                <div className="flex gap-2">
                  <QualityDownloadButton
                    label="720p"
                    torrents={t720}
                    plexQuality={plexQuality}
                    downloading={downloading}
                    onDownload={(t, l) => setConfirm({ torrent: t, label: l })}
                  />
                  <QualityDownloadButton
                    label="1080p"
                    torrents={t1080}
                    plexQuality={plexQuality}
                    downloading={downloading}
                    onDownload={(t, l) => setConfirm({ torrent: t, label: l })}
                  />
                  <QualityDownloadButton
                    label="4K"
                    torrents={t4k}
                    plexQuality={plexQuality}
                    downloading={downloading}
                    onDownload={(t, l) => setConfirm({ torrent: t, label: l })}
                  />
                  <QualityDownloadButton
                    label="4K HDR"
                    torrents={t4kHdr}
                    plexQuality={plexQuality}
                    downloading={downloading}
                    onDownload={(t, l) => setConfirm({ torrent: t, label: l })}
                  />
                </div>
              )}
            </div>
            <WatchTogglePanel mediaType="movie" settings={watchSettings} onChange={onWatchChange} />
          </>
        )}
      </div>
    </>
  );
}
