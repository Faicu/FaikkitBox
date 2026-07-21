import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Tv,
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
import { PlexStatusBadge, CountdownDisplay, LibraryBadge } from "./badges";
import { WatchTogglePanel } from "./WatchTogglePanel";
import { SeasonPanel } from "./SeasonPanel";

export function ShowCard({
  item,
  details,
  tvPlexStatus,
  tvPlexLoading,
  plexSeasonEps,
  torrents,
  filelistLoading,
  countdown,
  countdownLoading,
  watchSettings,
  isAdmin,
  onWatchChange,
  onUnpin,
}: {
  item: PinnedItem;
  details: TmdbDetails | null;
  tvPlexStatus: "complet" | "incomplet" | "lipsa" | null;
  tvPlexLoading: boolean;
  plexSeasonEps: { num: number; quality: string | null; watched: boolean }[];
  torrents: FilelistTorrent[];
  filelistLoading: boolean;
  countdown: TvShowCountdown | null;
  countdownLoading: boolean;
  watchSettings: WatchSettings;
  isAdmin: boolean;
  onWatchChange: (patch: Partial<WatchSettings>) => void;
  onUnpin: () => void;
}) {
  const { downloading, handleDownload } = useDownload();
  const qc = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);

  const imdbId = details?.imdbId ?? countdown?.imdbId ?? null;
  const showTitle = countdown?.showName || item.title;

  const seasonGroups = groupTorrentsBySeasonEpisode(torrents);

  return (
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
              <Tv className="h-6 w-6 text-muted-foreground/40" />
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
                    qc.removeQueries({ queryKey: ["tmdbDetails", "tv", item.id] });
                  }}
                  className="shrink-0 text-muted-foreground hover:text-foreground mt-0.5"
                  title="Scoate din listă"
                >
                  <PinOff className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400">
                  Serial
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
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
              {tvPlexLoading ? (
                <div className="h-4 w-16 animate-pulse rounded bg-muted" />
              ) : (
                <PlexStatusBadge status={tvPlexStatus ?? "lipsa"} />
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className="w-full flex items-center justify-center gap-1 border-t border-border mt-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {isOpen ? "Mai puține detalii" : "Mai multe detalii"}
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        {isOpen && (
        <div className="p-3 pt-0 space-y-3">
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

          {/* Secțiunea Filelist — doar pentru admin */}
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
              ) : seasonGroups.length === 0 && !filelistLoading ? (
                <div className="text-xs text-muted-foreground">
                  Niciun torrent cu sezon detectat.
                </div>
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
          )}

          <WatchTogglePanel
            mediaType="tv"
            settings={watchSettings}
            isAdmin={isAdmin}
            onChange={onWatchChange}
          />

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
    </section>
  );
}
