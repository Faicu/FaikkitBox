import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  PinOff,
  ExternalLink,
  Film,
  CheckCircle2,
  XCircle,
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
  watchSettings,
  isAdmin,
  onWatchChange,
  onUnpin,
}: {
  item: PinnedItem;
  details: TmdbDetails | null;
  plexInfo: { found: boolean; quality: string | null } | null;
  torrents: FilelistTorrent[];
  filelistLoading: boolean;
  watchSettings: WatchSettings;
  isAdmin: boolean;
  onWatchChange: (patch: Partial<WatchSettings>) => void;
  onUnpin: () => void;
}) {
  const { downloading, handleDownload } = useDownload();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<{ torrent: FilelistTorrent; label: string } | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const imdbId = details?.imdbId ?? null;
  const plexStatus =
    plexInfo?.found === true ? "complet" : plexInfo?.found === false ? "lipsa" : null;
  const plexQuality = plexInfo?.quality ?? null;

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
      <section>
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {/* Header cu poster */}
          <div className="flex gap-3 p-3 pb-0">
            {item.posterUrl ? (
              <img
                src={item.posterUrl}
                alt=""
                className="h-24 w-16 rounded-xl object-cover shrink-0 shadow-md"
              />
            ) : (
              <div className="h-24 w-16 rounded-xl bg-muted shrink-0 flex items-center justify-center">
                <Film className="h-6 w-6 text-muted-foreground/40" />
              </div>
            )}
            <div className="flex flex-col justify-between min-w-0 py-0.5 flex-1">
              <div>
                <div className="flex items-start gap-1">
                  <span className="font-semibold text-sm leading-tight line-clamp-2 flex-1">
                    {item.title}
                  </span>
                  <button
                    onClick={() => {
                      onUnpin();
                      qc.removeQueries({ queryKey: ["tmdbDetails", "movie", item.id] });
                    }}
                    className="shrink-0 text-muted-foreground hover:text-foreground mt-0.5"
                    title="Scoate din listă"
                  >
                    <PinOff className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
                    Film
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {imdbId && (
                  <a
                    href={`https://www.imdb.com/title/${imdbId}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    IMDb <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
            </div>
          </div>
          <div className="p-3 pt-3 space-y-3">
            <div className="flex items-center justify-end">
              <div className="flex items-center gap-2">
                {plexStatus === "complet" ? (
                  <>
                    {plexQuality && (
                      <span className="text-[11px] text-muted-foreground">{plexQuality}</span>
                    )}
                    <span className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" /> În bibliotecă
                    </span>
                  </>
                ) : plexStatus === "lipsa" ? (
                  <span className="flex items-center gap-1 rounded-lg bg-muted/60 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                    <XCircle className="h-3.5 w-3.5" /> Lipsă din Plex
                  </span>
                ) : (
                  <span className="h-7 w-28 animate-pulse rounded-lg bg-muted/40" />
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen((v) => !v)}
              className="w-full flex items-center justify-center gap-1 border-t border-border pt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {isOpen ? "Mai puține detalii" : "Mai multe detalii"}
              {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            {isOpen && (
              <>
                {isAdmin && (
                  <div className="border-t border-border pt-3">
                    <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
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
                )}
                <WatchTogglePanel
                  mediaType="movie"
                  settings={watchSettings}
                  isAdmin={isAdmin}
                  onChange={onWatchChange}
                />
              </>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
