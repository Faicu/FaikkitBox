// Încărcarea datelor wizard-ului: căutarea TMDB (cu debounce) și verificarea
// completă a unui titlu — TMDB + Plex + Filelist + TVMaze, într-un singur pas.
//
// Scos din componentă la pasul 3 al refactorizării. Nu ține stare proprie:
// primește `dispatch` și scrie în reducer, ca sursa de adevăr să rămână una
// singură.
//
// Capcană cunoscută: `useServerFn` NU e memoizat — identitatea lui se schimbă
// la fiecare randare. Nu-l pune în deps de `useEffect`, altfel efectul rulează
// la nesfârșit. Aici funcțiile sunt chemate din handlere, nu din efecte, deci
// problema nu apare; efectul care cheamă `selectItem` la deschiderea prefill
// a rămas în componentă, cu deps pe id-ul titlului, nu pe funcție.

import { useRef } from "react";
import type { Dispatch } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { searchTmdb, getTmdbDetails, getTmdbAllSeasons } from "@/lib/tmdb/tmdb.functions";
import type { TmdbSearchResult, TmdbSeasonSchema } from "@/lib/tmdb/tmdb.functions";
import { checkPlexHasTitle, getPlexEpisodesInSeason } from "@/lib/services.functions";
import { checkFilelistForItem } from "@/lib/filelist.functions";
import { getDownloadingMediaForTmdbId, listWantedMovies } from "@/lib/media/media.functions";
import type { WantedMovie } from "@/lib/media/media.functions";
import { getTvmazeAirstamps } from "@/lib/tvmaze/tvmaze.functions";
import type { TvmazeAirstamp } from "@/lib/tvmaze/tvmaze.functions";
import type { PlexSeasonEpisode } from "./types";
import type { WizardAction } from "./state";

export function useWizardData(dispatch: Dispatch<WizardAction>) {
  const searchFn = useServerFn(searchTmdb);
  const detailsFn = useServerFn(getTmdbDetails);
  const plexFn = useServerFn(checkPlexHasTitle);
  const plexSeasonFn = useServerFn(getPlexEpisodesInSeason);
  const filelistFn = useServerFn(checkFilelistForItem);
  const allSeasonsFn = useServerFn(getTmdbAllSeasons);
  const tvmazeFn = useServerFn(getTvmazeAirstamps);
  const downloadingFn = useServerFn(getDownloadingMediaForTmdbId);
  const wantedFn = useServerFn(listWantedMovies);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onQueryChange(value: string) {
    dispatch({ type: "QUERY_CHANGED", query: value });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < 2) return;
    debounceRef.current = setTimeout(async () => {
      dispatch({ type: "SEARCH_STARTED" });
      try {
        dispatch({ type: "SEARCH_RESULTS", results: await searchFn({ data: { query: q } }) });
      } catch {
        dispatch({ type: "SEARCH_RESULTS", results: [] });
      }
    }, 400);
  }

  async function selectItem(item: TmdbSearchResult) {
    dispatch({ type: "SELECT_ITEM", item });
    try {
      const details = await detailsFn({ data: { id: item.id, mediaType: item.mediaType } });
      const originalTitle = details.literalTitle || details.originalTitle || item.originalTitle;
      const [plexRes, filelistRes, downloading, wanted] = await Promise.all([
        plexFn({ data: { title: item.title, originalTitle, mediaType: item.mediaType } }),
        filelistFn({
          data: {
            title: item.title,
            originalTitle,
            imdbId: details.imdbId,
            mediaType: item.mediaType,
          },
        }),
        downloadingFn({ data: { tmdbId: item.id, mediaType: item.mediaType } }).catch(() => []),
        item.mediaType === "movie"
          ? wantedFn().catch(() => [] as WantedMovie[])
          : Promise.resolve([] as WantedMovie[]),
      ]);
      const seasons = details.seasons
        .filter((s) => s.seasonNumber > 0)
        .map((s) => ({ seasonNumber: s.seasonNumber, episodeCount: s.episodeCount }));

      // Pentru seriale: schema completă (toate sezoanele/episoadele, un
      // singur request suplimentar) + statusul Plex per-sezon (pentru TOATE
      // sezoanele deodată) — totul gata înainte de a arăta ecranul de
      // rezultat, ca extinderea unui sezon să nu declanșeze cereri noi.
      let plexBySeasonMap = new Map<number, PlexSeasonEpisode[]>();
      let schemaResult: TmdbSeasonSchema[] = [];
      let airstampsResult: TvmazeAirstamp[] = [];
      if (item.mediaType === "tv" && seasons.length > 0) {
        const [plexResults, schema, airstamps] = await Promise.all([
          Promise.allSettled(
            seasons.map((s) =>
              plexSeasonFn({ data: { showTitle: originalTitle, season: s.seasonNumber } }),
            ),
          ),
          allSeasonsFn({
            data: { tmdbId: item.id, seasonNumbers: seasons.map((s) => s.seasonNumber) },
          }),
          details.imdbId ? tvmazeFn({ data: { imdbId: details.imdbId } }) : Promise.resolve([]),
        ]);
        const map = new Map<number, PlexSeasonEpisode[]>();
        seasons.forEach((s, i) => {
          const r = plexResults[i];
          map.set(s.seasonNumber, r.status === "fulfilled" ? r.value : []);
        });
        plexBySeasonMap = map;
        schemaResult = schema;
        airstampsResult = airstamps;
      }

      // O singură acțiune, la final: ecranul de rezultat apare cu toate
      // datele deodată. Înainte, starea se scria în șapte pași, ceea ce
      // însemna că o eroare la mijloc lăsa în urmă jumătate din ea.
      dispatch({
        type: "CHECK_LOADED",
        payload: {
          checkResult: {
            imdbId: details.imdbId,
            originalTitle,
            plexFound: !!plexRes?.found,
            plexQuality: plexRes?.quality ?? null,
            torrents: filelistRes.status === "ok" ? filelistRes.torrents : [],
            seasons,
          },
          tmdbDetails: details,
          seasonSchema: schemaResult,
          tvmazeAirstamps: airstampsResult,
          plexBySeason: plexBySeasonMap,
          downloadingEntries: downloading,
          wantedEntry: wanted.find((w) => w.tmdbId === item.id) ?? null,
        },
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      toast.error("Eroare la verificare", { description: error });
      dispatch({
        type: "CHECK_FAILED",
        error,
        fallback: {
          imdbId: null,
          originalTitle: item.originalTitle,
          plexFound: false,
          plexQuality: null,
          torrents: [],
          seasons: [],
        },
      });
    }
  }

  return { onQueryChange, selectItem };
}
