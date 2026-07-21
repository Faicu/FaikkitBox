import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  HelpCircle,
  XCircle,
} from "lucide-react";

import { getPlexEpisodesInSeason } from "@/lib/services.functions";
import { getTmdbSeasonEpisodes } from "@/lib/tmdb.functions";
import type { TmdbEpisode } from "@/lib/tmdb.functions";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import type { SeasonGroup } from "./types";
import { DownloadConfirmDialog } from "./DownloadConfirmDialog";
import { QualityDownloadButton, PlexStatusBadge } from "./badges";

// SeasonPanel — accordion cu ambele moduri + confirmare download + status Plex complet
export function SeasonPanel({
  showTitle,
  tmdbId,
  group,
  downloading,
  onDownload,
}: {
  showTitle: string;
  tmdbId: number;
  group: SeasonGroup;
  downloading: number | null;
  onDownload: (t: FilelistTorrent) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ torrent: FilelistTorrent; label: string } | null>(null);
  const plexFn = useServerFn(getPlexEpisodesInSeason);
  const tmdbSeasonFn = useServerFn(getTmdbSeasonEpisodes);

  // Plex + TMDB se verifică automat la mount — necesare pentru badge pe rândul închis
  const { data: plexEpisodes, isLoading: plexLoading } = useQuery({
    queryKey: ["plexSeasonEps", showTitle, group.seasonNum],
    queryFn: () => plexFn({ data: { showTitle, season: group.seasonNum } }),
    staleTime: 5 * 60_000,
  });

  const { data: tmdbEpisodes, isLoading: tmdbLoading } = useQuery({
    queryKey: ["tmdbSeasonEps", tmdbId, group.seasonNum],
    queryFn: () => tmdbSeasonFn({ data: { tmdbId, seasonNum: group.seasonNum } }),
    staleTime: 60 * 60_000,
  });

  const loading = isOpen && (plexLoading || tmdbLoading);
  // Map epNum → { quality, watched }
  const plexMap = new Map<number, { quality: string | null; watched: boolean }>(
    (plexEpisodes ?? []).map((e) => [e.num, { quality: e.quality, watched: e.watched }]),
  );
  const airedEps: TmdbEpisode[] = (tmdbEpisodes ?? []).filter((e) => e.aired);
  const filelistEpNums = Array.from(group.episodes.keys()).sort((a, b) => a - b);
  const episodeList: number[] =
    airedEps.length > 0 ? airedEps.map((e) => e.episodeNum) : filelistEpNums;

  const allInPlex = episodeList.length > 0 && episodeList.every((n) => plexMap.has(n));
  const someInPlex = !allInPlex && episodeList.some((n) => plexMap.has(n));
  const noneInPlex = episodeList.length > 0 && !episodeList.some((n) => plexMap.has(n));
  const missingCount = episodeList.filter((n) => !plexMap.has(n)).length;

  const hasPackTorrents =
    group.byQuality.t1080.length > 0 ||
    group.byQuality.t4k.length > 0 ||
    group.byQuality.t4kHdr.length > 0;
  const hasEpisodeTorrents = group.episodes.size > 0;

  function requestDownload(t: FilelistTorrent, label: string) {
    setConfirm({ torrent: t, label });
  }

  // Badge pe butonul închis
  let closedBadge: React.ReactNode = null;
  if (plexEpisodes !== undefined && !loading && episodeList.length > 0) {
    if (allInPlex) closedBadge = <PlexStatusBadge status="complet" />;
    else if (someInPlex) closedBadge = <PlexStatusBadge status="incomplet" />;
    else closedBadge = <PlexStatusBadge status="lipsa" />;
  }

  const plexSet = new Set(plexMap.keys()); // pentru verificări rapide în render

  return (
    <>
      {confirm && (
        <DownloadConfirmDialog
          torrent={confirm.torrent}
          label={confirm.label}
          onConfirm={() => {
            onDownload(confirm.torrent);
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
      <div className="rounded-xl border border-border/60 overflow-hidden">
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
        >
          <span>Sezon {String(group.seasonNum).padStart(2, "0")}</span>
          <div className="flex items-center gap-2">
            {!isOpen && closedBadge}
            {isOpen ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>

        {isOpen && (
          <div className="border-t border-border/60 p-3 space-y-3">
            {loading && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Verifică Plex și episoade...
              </div>
            )}

            {!loading && (
              <>
                {/* Status general */}
                {episodeList.length > 0 &&
                  (allInPlex ? (
                    <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-[11px] font-medium text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Complet — toate cele {episodeList.length} episoade sunt în Plex
                    </div>
                  ) : someInPlex ? (
                    <div className="flex items-center gap-1.5 rounded-lg bg-yellow-500/15 px-3 py-1.5 text-[11px] font-medium text-yellow-400">
                      <HelpCircle className="h-3.5 w-3.5" />
                      Incomplet — {plexSet.size}/{episodeList.length} episoade în Plex, lipsesc{" "}
                      {missingCount}
                    </div>
                  ) : noneInPlex ? (
                    <div className="flex items-center gap-1.5 rounded-lg bg-red-500/15 px-3 py-1.5 text-[11px] font-medium text-red-400">
                      <XCircle className="h-3.5 w-3.5" />
                      Lipsă — niciun episod în Plex
                    </div>
                  ) : null)}

                {/* Pack sezon întreg */}
                {hasPackTorrents && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
                      Sezon complet (pack)
                    </div>
                    <div className="flex gap-2">
                      <QualityDownloadButton
                        label="1080p"
                        torrents={group.byQuality.t1080}
                        downloading={downloading}
                        onDownload={requestDownload}
                      />
                      <QualityDownloadButton
                        label="4K"
                        torrents={group.byQuality.t4k}
                        downloading={downloading}
                        onDownload={requestDownload}
                      />
                      <QualityDownloadButton
                        label="4K HDR"
                        torrents={group.byQuality.t4kHdr}
                        downloading={downloading}
                        onDownload={requestDownload}
                      />
                    </div>
                  </div>
                )}

                {/* Episoade individuale */}
                {(hasEpisodeTorrents || episodeList.length > 0) && (
                  <div className="space-y-2">
                    {hasPackTorrents && (
                      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
                        Episoade individuale
                      </div>
                    )}
                    {episodeList.map((epNum) => {
                      const epData = plexMap.get(epNum);
                      const inPlex = plexSet.has(epNum);
                      const q = group.episodes.get(epNum);
                      const tmdbEp = airedEps.find((e) => e.episodeNum === epNum);
                      return (
                        <div key={epNum} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium w-8 shrink-0 text-muted-foreground">
                              E{String(epNum).padStart(2, "0")}
                            </span>
                            {tmdbEp && (
                              <span className="text-xs text-muted-foreground truncate flex-1">
                                {tmdbEp.title}
                              </span>
                            )}
                            {inPlex && (
                              <span className="shrink-0 flex items-center gap-1 text-[10px] text-emerald-400">
                                <CheckCircle2 className="h-3 w-3" />
                                {epData?.quality ?? "Complet"}
                              </span>
                            )}
                            {inPlex && !epData?.watched && (
                              <span className="shrink-0 flex items-center gap-0.5 text-[10px] font-medium text-orange-400">
                                <HelpCircle className="h-3 w-3" /> Nevăzut
                              </span>
                            )}
                          </div>
                          {q && (
                            <div className="pl-10 flex gap-1.5">
                              <QualityDownloadButton
                                label="1080p"
                                torrents={q.t1080}
                                plexQuality={epData?.quality ?? null}
                                downloading={downloading}
                                onDownload={requestDownload}
                              />
                              <QualityDownloadButton
                                label="4K"
                                torrents={q.t4k}
                                plexQuality={epData?.quality ?? null}
                                downloading={downloading}
                                onDownload={requestDownload}
                              />
                              <QualityDownloadButton
                                label="4K HDR"
                                torrents={q.t4kHdr}
                                plexQuality={epData?.quality ?? null}
                                downloading={downloading}
                                onDownload={requestDownload}
                              />
                            </div>
                          )}
                          {!inPlex && !q && (
                            <div className="pl-10">
                              <PlexStatusBadge status="lipsa" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
