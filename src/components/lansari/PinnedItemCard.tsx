import { useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { checkPlexHasTitle, getPlexEpisodesInSeason } from "@/lib/services.functions";
import { checkFilelistForItem } from "@/lib/filelist.functions";
import { getTmdbDetails, getTvShowCountdown, getTmdbSeasonEpisodes } from "@/lib/tmdb.functions";
import type { WatchSettings } from "@/lib/pinned.functions";
import type { PinnedItem } from "./types";
import { computeTvPlexStatus } from "./plex-status";
import { MovieCard } from "./MovieCard";
import { ShowCard } from "./ShowCard";

// ---------------------------------------------------------------------------
// Card item fixat — router spre Movie sau Show
// ---------------------------------------------------------------------------

export function PinnedItemCard({
  item,
  watchSettings,
  onWatchChange,
  onUnpin,
}: {
  item: PinnedItem;
  watchSettings: WatchSettings;
  onWatchChange: (patch: Partial<WatchSettings>) => void;
  onUnpin: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const detailsFn = useServerFn(getTmdbDetails);
  const plexFn = useServerFn(checkPlexHasTitle);
  const plexSeasonFn = useServerFn(getPlexEpisodesInSeason);
  const tmdbSeasonFn = useServerFn(getTmdbSeasonEpisodes);
  const filelistFn = useServerFn(checkFilelistForItem);
  const countdownFn = useServerFn(getTvShowCountdown);

  const { data: details, isLoading: detailsLoading } = useQuery({
    queryKey: ["tmdbDetails", item.mediaType, item.id],
    queryFn: () => detailsFn({ data: { id: item.id, mediaType: item.mediaType } }),
    staleTime: 5 * 60_000,
  });

  // Pentru filme: checkPlexHasTitle simplu
  const { data: inPlexMovie, isLoading: plexMovieLoading } = useQuery({
    queryKey: ["plexHasTitle", item.mediaType, item.id],
    queryFn: () =>
      plexFn({
        data: { title: item.title, originalTitle: item.originalTitle, mediaType: item.mediaType },
      }),
    staleTime: 5 * 60_000,
    enabled: item.mediaType === "movie",
  });

  const { data: countdown, isLoading: countdownLoading } = useQuery({
    queryKey: ["tvCountdown", item.id],
    queryFn: () =>
      countdownFn({ data: { imdbId: details?.imdbId ?? null, showTitle: item.title } }),
    staleTime: 5 * 60_000,
    enabled: item.mediaType === "tv" && !!details,
  });

  const itemImdbId = details?.imdbId ?? countdown?.imdbId ?? null;
  // Pentru căutarea pe Filelist preferăm titlul literal/romanizat (ex.
  // "Gunche"), nu original_title brut din TMDB (rămâne în scriptul nativ,
  // ex. "군체", inutil ca text de căutare) — vezi findLiteralTitle în
  // tmdb.functions.ts.
  const itemOriginalTitle =
    details?.literalTitle || details?.originalTitle || item.originalTitle || item.title;

  // checkFilelistForItem caută exclusiv după IMDB ID — aceeași sursă unică
  // folosită și de Descoperă. Contul Filelist are o limită orară de cereri,
  // deci verificarea pornește doar când utilizatorul deschide "Mai multe
  // detalii" la card, nu automat pentru toate itemele fixate la încărcarea
  // paginii.
  const { data: filelistData, isLoading: filelistLoading } = useQuery({
    queryKey: ["filelistForItem", item.mediaType, item.id, itemOriginalTitle, itemImdbId],
    queryFn: () =>
      filelistFn({
        data: {
          title: item.title,
          originalTitle: itemOriginalTitle,
          imdbId: itemImdbId,
          mediaType: item.mediaType,
        },
      }),
    staleTime: 2 * 60_000,
    enabled: isOpen && !!(item.title || itemOriginalTitle),
  });

  const latestSeasonFromTmdb =
    details?.seasons && details.seasons.length > 0
      ? details.seasons[details.seasons.length - 1].seasonNumber
      : null;
  const latestSeason =
    countdown?.status === "ok"
      ? (countdown.lastAired?.season ?? latestSeasonFromTmdb)
      : latestSeasonFromTmdb;
  const showTitleForPlex = item.originalTitle || countdown?.showName || item.title;

  const torrents = filelistData?.status === "ok" ? filelistData.torrents : [];
  // Sezoanele verificate în Plex pentru badge-ul principal vin din TMDB, nu
  // din Filelist — independent de starea "Mai multe detalii" a cardului.
  const allSeasonNums = (details?.seasons ?? []).map((s) => s.seasonNumber);

  // Plex + TMDB pentru TOATE sezoanele detectate — pentru badge-ul principal
  const plexSeasonQueries = useQueries({
    queries: allSeasonNums.map((sn) => ({
      queryKey: ["plexSeasonEps", showTitleForPlex, sn],
      queryFn: () => plexSeasonFn({ data: { showTitle: showTitleForPlex, season: sn } }),
      staleTime: 5 * 60_000,
      enabled: item.mediaType === "tv" && allSeasonNums.length > 0,
    })),
  });
  const tmdbSeasonQueries = useQueries({
    queries: allSeasonNums.map((sn) => ({
      queryKey: ["tmdbSeasonEps", item.id, sn],
      queryFn: () => tmdbSeasonFn({ data: { tmdbId: item.id, seasonNum: sn } }),
      staleTime: 60 * 60_000,
      enabled: item.mediaType === "tv" && allSeasonNums.length > 0,
    })),
  });

  // Status per sezon — din aceleași date ca SeasonPanel
  const plexSeasonEps = plexSeasonQueries[allSeasonNums.indexOf(latestSeason ?? -1)]?.data;
  const plexSeasonLoading = plexSeasonQueries.some((q) => q.isLoading);
  const tmdbSeasonLoading = tmdbSeasonQueries.some((q) => q.isLoading);

  // Badge principal — vezi ordinea de priorități în plex-status.ts.
  const tvPlexStatus =
    item.mediaType === "tv"
      ? computeTvPlexStatus({
          allSeasonNums,
          latestSeason,
          plexSeasonQueries,
          tmdbSeasonQueries,
          lastAired: countdown?.status === "ok" ? countdown.lastAired : null,
        })
      : null;

  const isLoading = detailsLoading || (item.mediaType === "movie" ? plexMovieLoading : false);

  if (isLoading) {
    return <div className="h-32 animate-pulse rounded-2xl border border-border bg-card" />;
  }

  if (item.mediaType === "movie") {
    return (
      <MovieCard
        item={item}
        details={details ?? null}
        plexInfo={inPlexMovie ?? null}
        torrents={torrents}
        filelistLoading={isOpen && filelistLoading}
        isOpen={isOpen}
        onToggleOpen={() => setIsOpen((v) => !v)}
        watchSettings={watchSettings}
        onWatchChange={onWatchChange}
        onUnpin={onUnpin}
      />
    );
  }

  return (
    <ShowCard
      item={item}
      details={details ?? null}
      tvPlexStatus={tvPlexStatus}
      tvPlexLoading={plexSeasonLoading || tmdbSeasonLoading || countdownLoading}
      plexSeasonEps={plexSeasonEps ?? []}
      torrents={torrents}
      filelistLoading={isOpen && filelistLoading}
      isOpen={isOpen}
      onToggleOpen={() => setIsOpen((v) => !v)}
      countdown={countdown ?? null}
      countdownLoading={countdownLoading}
      watchSettings={watchSettings}
      onWatchChange={onWatchChange}
      onUnpin={onUnpin}
    />
  );
}
