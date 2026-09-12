// Verificarea completă a unui titlu pentru wizard, într-o singură cerere.
//
// Înainte, ecranul de verificare făcea 10 cereri HTTP separate de pe telefon,
// în trei valuri care se așteptau unul pe altul: detaliile TMDB, apoi Plex +
// Filelist + „ce se descarcă deja", apoi CÂTE O CERERE PER SEZON pentru starea
// din Plex, plus schema sezoanelor și TVMaze.
//
// Măsurat pe server, munca în sine durează ~1 secundă, aproape toată în
// paralel: Plex răspunde în 5ms, Filelist în 113ms, TMDB în 49ms. Costul real
// erau cele zece dus-întors, înmulțite cu latența unei legături mobile — de
// unde „foarte multe secunde" pe 5G pentru ceva ce serverul rezolvă instant.
//
// Aici valurile rămân aceleași (al doilea are nevoie de `originalTitle` și
// `imdbId` din primul), dar se execută pe server, unde un dus-întors costă
// milisecunde. Clientul face una singură.
//
// Transversal prin construcție — atinge TMDB, Plex, Filelist, `media` și
// TVMaze — de-asta stă la rădăcina lui `lib/`, nu într-un domeniu anume.

import { createServerFn } from "@tanstack/react-start";

import type { TmdbDetails, TmdbSeasonSchema } from "./tmdb/tmdb.functions";
import type { TvmazeAirstamp } from "./tvmaze/tvmaze.functions";
import type { DownloadingMediaEntry, WantedMovie } from "./media/media.functions";
import type { FilelistTorrent } from "./filelist.functions";

export interface WizardCheckResult {
  details: TmdbDetails;
  originalTitle: string;
  plexFound: boolean;
  plexQuality: string | null;
  torrents: FilelistTorrent[];
  seasons: Array<{ seasonNumber: number; episodeCount: number }>;
  seasonSchema: TmdbSeasonSchema[];
  tvmazeAirstamps: TvmazeAirstamp[];
  // Serializat ca pereche [sezon, episoade]: un Map nu supraviețuiește
  // trecerii prin JSON, iar clientul îl reface la primire.
  plexBySeason: Array<[number, { num: number; quality: string | null; watched: boolean }[]]>;
  downloadingEntries: DownloadingMediaEntry[];
  wantedEntry: WantedMovie | null;
}

export const checkTitleForWizard = createServerFn({ method: "GET" })
  .validator(
    (data: {
      tmdbId: number;
      mediaType: "movie" | "tv";
      title: string;
      // Titlul original de la TMDB, folosit doar ca ultimă rezervă dacă
      // detaliile nu aduc unul mai bun.
      fallbackOriginalTitle: string;
    }) => data,
  )
  .handler(async ({ data }): Promise<WizardCheckResult> => {
    const { requireAuth, isAdminOrOwner } = await import("./auth/admin.server");
    const session = await requireAuth();

    const { getTmdbDetailsInternal, getTmdbAllSeasonsInternal } =
      await import("./tmdb/tmdb.functions");
    const { checkPlexHasTitleInternal, getPlexEpisodesInSeasonInternal } =
      await import("./services/plex-library");
    const { checkFilelistForItemInternal } = await import("./filelist/filelist-client");
    const { getDownloadingMediaForTmdbIdCore } = await import("./media/media");
    const { listWantedMoviesCore } = await import("./media/movie-watch");
    const { getTvmazeAirstampsInternal } = await import("./tvmaze/tvmaze.functions");

    const details = await getTmdbDetailsInternal(data.tmdbId, data.mediaType);
    const originalTitle =
      details.literalTitle || details.originalTitle || data.fallbackOriginalTitle;

    const [plexRes, filelistRes] = await Promise.all([
      checkPlexHasTitleInternal({
        title: data.title,
        originalTitle,
        mediaType: data.mediaType,
      }),
      checkFilelistForItemInternal({
        title: data.title,
        originalTitle,
        imdbId: details.imdbId,
        mediaType: data.mediaType,
      }),
    ]);

    const downloadingEntries = await getDownloadingMediaForTmdbIdCore(data.tmdbId, data.mediaType);

    // `canManage` se calculează aici, ca în listWantedMovies: sesiunea e
    // cunoscută doar la nivelul ăsta, iar clientul primește un boolean gata
    // decis, nu id-uri de utilizator de comparat.
    const wantedEntry =
      data.mediaType === "movie"
        ? (listWantedMoviesCore()
            .map((m) => ({ ...m, canManage: isAdminOrOwner(session, m.requestedByUserId) }))
            .find((m) => m.tmdbId === data.tmdbId) ?? null)
        : null;

    const seasons = details.seasons
      .filter((s) => s.seasonNumber > 0)
      .map((s) => ({ seasonNumber: s.seasonNumber, episodeCount: s.episodeCount }));

    let seasonSchema: TmdbSeasonSchema[] = [];
    let tvmazeAirstamps: TvmazeAirstamp[] = [];
    let plexBySeason: WizardCheckResult["plexBySeason"] = [];

    if (data.mediaType === "tv" && seasons.length > 0) {
      const [plexResults, schema, airstamps] = await Promise.all([
        Promise.allSettled(
          seasons.map((s) =>
            getPlexEpisodesInSeasonInternal({ showTitle: originalTitle, season: s.seasonNumber }),
          ),
        ),
        getTmdbAllSeasonsInternal(
          data.tmdbId,
          seasons.map((s) => s.seasonNumber),
        ),
        details.imdbId ? getTvmazeAirstampsInternal(details.imdbId) : Promise.resolve([]),
      ]);
      plexBySeason = seasons.map((s, i) => {
        const r = plexResults[i];
        return [s.seasonNumber, r.status === "fulfilled" ? r.value : []];
      });
      seasonSchema = schema;
      tvmazeAirstamps = airstamps;
    }

    return {
      details,
      originalTitle,
      plexFound: !!plexRes?.found,
      plexQuality: plexRes?.quality ?? null,
      torrents: filelistRes.status === "ok" ? filelistRes.torrents : [],
      seasons,
      seasonSchema,
      tvmazeAirstamps,
      plexBySeason,
      downloadingEntries,
      wantedEntry,
    };
  });
