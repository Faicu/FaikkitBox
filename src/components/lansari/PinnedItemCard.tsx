import { useQuery, useQueries } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { checkPlexHasTitle, getPlexEpisodesInSeason } from "@/lib/services.functions";
import { searchFilelist } from "@/lib/filelist.functions";
import { getTmdbDetails, getTvShowCountdown, getTmdbSeasonEpisodes } from "@/lib/tmdb.functions";
import type { WatchSettings } from "@/lib/pinned.functions";
import type { PinnedItem } from "./types";
import { stripDiacritics, groupTorrentsBySeasonEpisode, filterTorrentsForItem } from "./utils";
import { MovieCard } from "./MovieCard";
import { ShowCard } from "./ShowCard";

// ---------------------------------------------------------------------------
// Card item fixat — router spre Movie sau Show
// ---------------------------------------------------------------------------

export function PinnedItemCard({
  item,
  watchSettings,
  isAdmin,
  onWatchChange,
  onUnpin,
}: {
  item: PinnedItem;
  watchSettings: WatchSettings;
  isAdmin: boolean;
  onWatchChange: (patch: Partial<WatchSettings>) => void;
  onUnpin: () => void;
}) {
  const detailsFn = useServerFn(getTmdbDetails);
  const plexFn = useServerFn(checkPlexHasTitle);
  const plexSeasonFn = useServerFn(getPlexEpisodesInSeason);
  const tmdbSeasonFn = useServerFn(getTmdbSeasonEpisodes);
  const filelistFn = useServerFn(searchFilelist);
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

  const origTitle = stripDiacritics(details?.originalTitle || item.originalTitle || item.title);

  const { data: filelistData, isLoading: filelistLoading } = useQuery({
    queryKey: ["filelistForItem", item.mediaType, item.id, origTitle],
    queryFn: () =>
      filelistFn({
        data: { query: origTitle, category: item.mediaType === "movie" ? "movies" : "series" },
      }),
    staleTime: 2 * 60_000,
    enabled: !!origTitle,
  });

  const { data: countdown, isLoading: countdownLoading } = useQuery({
    queryKey: ["tvCountdown", item.id],
    queryFn: () =>
      countdownFn({ data: { imdbId: details?.imdbId ?? null, showTitle: item.title } }),
    staleTime: 5 * 60_000,
    enabled: item.mediaType === "tv" && !!details,
  });

  const latestSeasonFromTmdb =
    details && details.seasons.length > 0
      ? details.seasons[details.seasons.length - 1].seasonNumber
      : null;
  const latestSeason =
    countdown?.status === "ok"
      ? (countdown.lastAired?.season ?? latestSeasonFromTmdb)
      : latestSeasonFromTmdb;
  const showTitleForPlex = item.originalTitle || countdown?.showName || item.title;

  const itemImdbId = details?.imdbId ?? countdown?.imdbId ?? null;
  const rawTorrents = filelistData?.status === "ok" ? filelistData.torrents : [];
  const torrents = filterTorrentsForItem(rawTorrents, origTitle, itemImdbId);
  const seasonGroups = groupTorrentsBySeasonEpisode(torrents);
  const allSeasonNums = seasonGroups.map((g) => g.seasonNum);

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
  const tmdbSeasonEps = tmdbSeasonQueries[allSeasonNums.indexOf(latestSeason ?? -1)]?.data;
  const plexSeasonLoading = plexSeasonQueries.some((q) => q.isLoading);
  const tmdbSeasonLoading = tmdbSeasonQueries.some((q) => q.isLoading);

  // Badge principal — agregat din toate sezoanele
  let tvPlexStatus: "complet" | "incomplet" | "lipsa" | null = null;
  if (item.mediaType === "tv" && allSeasonNums.length > 0) {
    const allLoaded =
      plexSeasonQueries.every((q) => q.data !== undefined) &&
      tmdbSeasonQueries.every((q) => q.data !== undefined);
    if (allLoaded) {
      let totalComplete = 0;
      let totalPartial = 0;
      for (let i = 0; i < allSeasonNums.length; i++) {
        const plexEps = plexSeasonQueries[i].data ?? [];
        const tmdbEps = (tmdbSeasonQueries[i].data ?? []).filter((e) => e.aired);
        const plexSet = new Set(plexEps.map((e) => e.num));
        const epList = tmdbEps.length > 0 ? tmdbEps.map((e) => e.episodeNum) : [];
        if (epList.length === 0) {
          if (plexEps.length > 0) totalComplete++;
        } else if (epList.every((n: number) => plexSet.has(n))) {
          totalComplete++;
        } else if (epList.some((n: number) => plexSet.has(n))) {
          totalPartial++;
        }
      }
      if (totalComplete === allSeasonNums.length) tvPlexStatus = "complet";
      else if (totalComplete > 0 || totalPartial > 0) tvPlexStatus = "incomplet";
      else tvPlexStatus = "lipsa";
    }
  }

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
        filelistLoading={filelistLoading}
        watchSettings={watchSettings}
        isAdmin={isAdmin}
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
      filelistLoading={filelistLoading}
      countdown={countdown ?? null}
      countdownLoading={countdownLoading}
      watchSettings={watchSettings}
      isAdmin={isAdmin}
      onWatchChange={onWatchChange}
      onUnpin={onUnpin}
    />
  );
}
