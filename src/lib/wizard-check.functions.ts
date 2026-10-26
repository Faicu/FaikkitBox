// Verificarea completă a unui titlu pentru wizard, într-o singură cerere.
// Înainte, telefonul făcea 10 cereri în trei valuri; munca durează ~1s pe
// server, dar dus-întorsurile pe 5G adunau „foarte multe secunde”. Valurile
// rămân (al doilea are nevoie de datele primului), dar rulează pe server.
// Transversal (TMDB, Plex, Filelist, `media`, TVMaze), deci la rădăcina `lib/`.

import { createServerFn } from "@tanstack/react-start";

import type { TmdbDetails, TmdbSeasonSchema } from "./tmdb/tmdb.functions";
import type { TvmazeAirstamp } from "./tvmaze/tvmaze.functions";
import type { DownloadingMediaEntry, WantedMovie } from "./media/media.functions";
import type { FilelistTorrent } from "./filelist.functions";

export interface WizardCheckResult {
  details: TmdbDetails;
  originalTitle: string;
  plexFound: boolean;
  // TOATE calitățile din Plex (4K HDR și 1080p), ca wizard-ul să nu ofere una
  // deja deținută.
  plexQualities: string[];
  torrents: FilelistTorrent[];
  seasons: Array<{ seasonNumber: number; episodeCount: number }>;
  seasonSchema: TmdbSeasonSchema[];
  tvmazeAirstamps: TvmazeAirstamp[];
  // Perechi [sezon, episoade]: un Map nu trece prin JSON.
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
      // Titlul original TMDB, ultima rezervă.
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
        tmdbId: data.tmdbId,
        title: data.title,
        originalTitle,
        mediaType: data.mediaType,
      }),
      checkFilelistForItemInternal({
        useCache: true,
        includeDubbed: true,
        title: data.title,
        originalTitle,
        imdbId: details.imdbId,
        mediaType: data.mediaType,
      }),
    ]);

    const downloadingEntries = await getDownloadingMediaForTmdbIdCore(data.tmdbId, data.mediaType);

    // canManage calculat aici, unde e sesiunea — clientul primește un boolean.
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
            getPlexEpisodesInSeasonInternal({
              tmdbId: data.tmdbId,
              showTitle: originalTitle,
              season: s.seasonNumber,
            }),
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

    const torrents = filelistRes.status === "ok" ? filelistRes.torrents : [];
    // Pentru verificarea calității la descărcare (download-quality.ts).
    if (session.data.userId) {
      const { rememberWizardTorrents } = await import("./filelist/download-quality");
      rememberWizardTorrents(session.data.userId, torrents);
    }

    return {
      details,
      originalTitle,
      plexFound: !!plexRes?.found,
      plexQualities: plexRes?.qualities ?? [],
      torrents,
      seasons,
      seasonSchema,
      tvmazeAirstamps,
      plexBySeason,
      downloadingEntries,
      wantedEntry,
    };
  });
