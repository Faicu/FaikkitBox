import { useQueryClient } from "@tanstack/react-query";
import {
  PinOff,
  ExternalLink,
  HelpCircle,
  Download,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

import type { TmdbDetails } from "@/lib/tmdb.functions";
import type { TvShowCountdown } from "@/lib/tmdb.functions";
import type { WatchSettings } from "@/lib/pinned.functions";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import type { PinnedItem } from "./types";
import { groupTorrentsBySeasonEpisode } from "./utils";
import { useDownload } from "./hooks";
import { CountdownDisplay, LibraryBadge } from "./badges";
import { WatchTogglePanel } from "./WatchTogglePanel";
import { SeasonPanel } from "./SeasonPanel";

export function ShowCard({
  item,
  details,
  plexSeasonEps,
  torrents,
  filelistLoading,
  isOpen,
  onToggleOpen,
  countdown,
  countdownLoading,
  watchSettings,
  onWatchChange,
  onUnpin,
}: {
  item: PinnedItem;
  details: TmdbDetails | null;
  plexSeasonEps: { num: number; quality: string | null; watched: boolean }[];
  torrents: FilelistTorrent[];
  filelistLoading: boolean;
  isOpen: boolean;
  onToggleOpen: () => void;
  countdown: TvShowCountdown | null;
  countdownLoading: boolean;
  watchSettings: WatchSettings;
  onWatchChange: (patch: Partial<WatchSettings>) => void;
  onUnpin: () => void;
}) {
  const qc = useQueryClient();

  const imdbId = details?.imdbId ?? countdown?.imdbId ?? null;
  const showTitle = countdown?.showName || item.title;

  const { downloading, handleDownload } = useDownload({
    mediaType: "tv",
    imdbId,
    tmdbId: item.id,
    title: showTitle,
    originalTitle: item.originalTitle,
    literalTitle: details?.literalTitle ?? null,
    overviewRo: details?.overview ?? null,
    genres: details?.genres ?? [],
    posterUrl: item.posterUrl,
    tvStatus: details?.tvStatus ?? null,
  });

  const seasonGroups = groupTorrentsBySeasonEpisode(torrents);

  return (
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
          <button
            type="button"
            onClick={() => {
              onUnpin();
              qc.removeQueries({ queryKey: ["tmdbDetails", "tv", item.id] });
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
        <div className="space-y-3">
          {/* Countdown + ultimul episod */}
          {countdownLoading ? (
            <div className="h-8 animate-pulse rounded-xl bg-muted" />
          ) : countdown?.status === "ok" && countdown.lastAired ? (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Ultimul episod lansat
              </div>
              <div className="mt-1 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium text-sm">
                    S{String(countdown.lastAired.season).padStart(2, "0")}E
                    {String(countdown.lastAired.episode).padStart(2, "0")} —{" "}
                    {countdown.lastAired.title}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(countdown.lastAired.airDateIso).toLocaleDateString("ro-RO", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      timeZone: "Europe/Bucharest",
                    })}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <LibraryBadge inLibrary={countdown.lastAired.inLibrary} />
                  {countdown.lastAired.inLibrary &&
                    (() => {
                      const ep = plexSeasonEps.find((e) => e.num === countdown.lastAired!.episode);
                      if (!ep) return null;
                      return (
                        <>
                          {ep.quality && (
                            <span className="text-[10px] text-muted-foreground">{ep.quality}</span>
                          )}
                          {ep.watched ? (
                            <span className="text-[10px] text-emerald-400/70">Văzut</span>
                          ) : (
                            <span className="flex items-center gap-0.5 text-[10px] font-medium text-orange-400">
                              <HelpCircle className="h-3 w-3" /> Nevăzut
                            </span>
                          )}
                        </>
                      );
                    })()}
                </div>
              </div>
            </div>
          ) : null}

          <div className="border-t border-border pt-3">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <Download className="h-3 w-3" /> Descarcă de pe Filelist
              {filelistLoading && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
            </div>
            {!filelistLoading && torrents.length === 0 ? (
              <div className="text-xs text-muted-foreground">Niciun torrent găsit pe Filelist.</div>
            ) : seasonGroups.length === 0 && !filelistLoading ? (
              <div className="text-xs text-muted-foreground">Niciun torrent cu sezon detectat.</div>
            ) : (
              <div className="space-y-1.5">
                {seasonGroups.map((group) => (
                  <SeasonPanel
                    key={group.seasonNum}
                    showTitle={showTitle}
                    tmdbId={item.id}
                    group={group}
                    downloading={downloading}
                    onDownload={handleDownload}
                  />
                ))}
              </div>
            )}
          </div>

          <WatchTogglePanel mediaType="tv" settings={watchSettings} onChange={onWatchChange} />

          {/* Următorul episod — jos, după Filelist */}
          {countdown?.status === "ok" && countdown.next && (
            <div className="border-t border-border pt-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Următorul episod — S{String(countdown.next.season).padStart(2, "0")}E
                {String(countdown.next.episode).padStart(2, "0")}
              </div>
              <CountdownDisplay airDateIso={countdown.next.airDateIso} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
