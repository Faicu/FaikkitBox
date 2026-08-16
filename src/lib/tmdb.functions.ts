import { createServerFn } from "@tanstack/react-start";
import { checkPlexHasEpisode } from "./services.functions";
import { tmdbFetch } from "./tmdb-client";

interface TmdbApiSearchResult {
  id: number;
  media_type: string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
}

interface TmdbApiSearchResponse {
  results?: TmdbApiSearchResult[];
}

interface TmdbApiAlternativeTitle {
  iso_3166_1?: string;
  title?: string;
  type?: string;
}

interface TmdbApiGenre {
  id: number;
  name?: string;
}

interface TmdbApiMovie {
  title?: string;
  original_title?: string;
  overview?: string | null;
  external_ids?: { imdb_id?: string | null };
  imdb_id?: string | null;
  alternative_titles?: { titles?: TmdbApiAlternativeTitle[] };
  genres?: TmdbApiGenre[];
  poster_path?: string | null;
}

interface TmdbApiSeasonSummary {
  season_number: number;
  episode_count: number;
  air_date?: string | null;
}

interface TmdbApiTvShow {
  name?: string;
  original_name?: string;
  overview?: string | null;
  external_ids?: { imdb_id?: string | null };
  status?: string | null;
  in_production?: boolean;
  next_episode_to_air?: {
    season_number?: number;
    episode_number?: number;
    air_date?: string | null;
  } | null;
  seasons?: TmdbApiSeasonSummary[];
  alternative_titles?: { results?: TmdbApiAlternativeTitle[] };
  genres?: TmdbApiGenre[];
  poster_path?: string | null;
}

// TMDB marchează cu type "literal title" romanizarea/transliterarea folosită
// efectiv pe scenă (Filelist, grupuri de release) pentru producții cu titlu
// original în alt alfabet — spre deosebire de original_title/original_name,
// care rămâne mereu în scriptul nativ (ex. coreeană, "군체"), inutilizabil ca
// text de căutare. Ex: pentru "Colony" (2026), original_title TMDB e "군체",
// dar pe Filelist lansarea e denumită "Gunche" — exact "literal title" de mai
// jos, ceea ce IMDB afișează drept "titlu original".
function findLiteralTitle(titles: TmdbApiAlternativeTitle[] | undefined): string | null {
  return titles?.find((t) => t.type === "literal title")?.title ?? null;
}

interface TmdbApiEpisode {
  episode_number: number;
  name?: string;
  air_date?: string | null;
}

interface TmdbApiSeason {
  episodes?: TmdbApiEpisode[];
}

interface TvmazeShow {
  id: number;
  name?: string;
  externals?: { imdb?: string | null };
  _embedded?: { episodes?: TvmazeEpisode[] };
}

interface TvmazeEpisode {
  season: number;
  number: number;
  name?: string;
  airstamp?: string;
}

interface TvmazeSearchResult {
  show: TvmazeShow;
}

export interface TmdbSearchResult {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  originalTitle: string;
  year: string | null;
  posterUrl: string | null;
}

export const searchTmdb = createServerFn({ method: "GET" })
  .validator((data: { query: string }) => data)
  .handler(async ({ data }): Promise<TmdbSearchResult[]> => {
    const { requireAuth } = await import("./admin.server");
    await requireAuth();
    const q = data.query.trim();
    if (!q) return [];
    try {
      const json = await tmdbFetch<TmdbApiSearchResponse>(
        `/search/multi?query=${encodeURIComponent(q)}&include_adult=false&language=en-US&page=1`,
      );
      const results = json.results ?? [];
      return results
        .filter((r) => r.media_type === "movie" || r.media_type === "tv")
        .slice(0, 8)
        .map((r) => ({
          id: r.id,
          mediaType: r.media_type as "movie" | "tv",
          title:
            r.media_type === "movie"
              ? (r.title ?? r.original_title ?? "")
              : (r.name ?? r.original_name ?? ""),
          originalTitle:
            r.media_type === "movie"
              ? (r.original_title ?? r.title ?? "")
              : (r.original_name ?? r.name ?? ""),
          year:
            r.media_type === "movie"
              ? (r.release_date ?? "").slice(0, 4) || null
              : (r.first_air_date ?? "").slice(0, 4) || null,
          posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w92${r.poster_path}` : null,
        }));
    } catch {
      return [];
    }
  });

export interface TmdbDetails {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  originalTitle: string;
  // Titlul romanizat/literal (ex. "Gunche" pentru 군체) — ce arată IMDB drept
  // "titlu original" și ce folosesc grupurile de release pe Filelist. Null
  // dacă TMDB n-are un titlu marcat "literal title" pentru producția asta
  // (frecvent pentru titluri deja în alfabet latin).
  literalTitle: string | null;
  imdbId: string | null;
  // doar pentru tv:
  tvStatus: string | null;
  // Următorul episod anunțat de TMDB (dacă există dată de lansare) — separat
  // de tvStatus, care doar spune dacă serialul e reînnoit/în producție, nu și
  // dacă chiar există un episod concret programat. Folosit ca mesajul din
  // wizard să nu mai spună generic "încă în producție" pentru un serial al
  // cărui ultim sezon cunoscut e deja lansat complet, fără nimic anunțat.
  nextEpisode: { seasonNumber: number; episodeNumber: number; airDate: string } | null;
  seasons: Array<{ seasonNumber: number; episodeCount: number; airDate: string | null }>;
  // Rezumat scurt — în română când TMDB are traducerea disponibilă, altfel
  // cade pe engleză (multe producții mai puțin populare n-au overview RO).
  overview: string | null;
  // Genurile (RO) — lista TMDB e globală/predefinită, deci numele sunt deja
  // traduse chiar și pentru producții obscure fără overview RO propriu.
  genres: string[];
  posterUrl: string | null;
}

// Versiune internă (fără createServerFn) — folosită și din plex-browse.ts,
// care are nevoie de detaliile TMDB (overview RO, genuri, imdbId) pentru
// pagina Bibliotecă, fără să treacă prin granița de server function.
export async function getTmdbDetailsInternal(
  id: number,
  mediaType: "movie" | "tv",
): Promise<TmdbDetails> {
  try {
    if (mediaType === "movie") {
      const movie = await tmdbFetch<TmdbApiMovie>(
        `/movie/${id}?language=ro-RO&append_to_response=external_ids,alternative_titles`,
      );
      let overview = movie.overview?.trim() || null;
      if (!overview) {
        const enMovie = await tmdbFetch<TmdbApiMovie>(`/movie/${id}`).catch(() => null);
        overview = enMovie?.overview?.trim() || null;
      }
      return {
        id,
        mediaType: "movie",
        title: movie.title ?? movie.original_title ?? "",
        originalTitle: movie.original_title ?? movie.title ?? "",
        literalTitle: findLiteralTitle(movie.alternative_titles?.titles),
        imdbId: movie.external_ids?.imdb_id ?? movie.imdb_id ?? null,
        tvStatus: null,
        nextEpisode: null,
        seasons: [],
        overview,
        genres: (movie.genres ?? []).map((g) => g.name ?? "").filter(Boolean),
        posterUrl: movie.poster_path ? `https://image.tmdb.org/t/p/w342${movie.poster_path}` : null,
      };
    } else {
      const show = await tmdbFetch<TmdbApiTvShow>(
        `/tv/${id}?language=ro-RO&append_to_response=external_ids,alternative_titles`,
      );
      let overview = show.overview?.trim() || null;
      if (!overview) {
        const enShow = await tmdbFetch<TmdbApiTvShow>(`/tv/${id}`).catch(() => null);
        overview = enShow?.overview?.trim() || null;
      }
      const seasons = (show.seasons ?? [])
        .filter((s) => s.season_number > 0)
        .map((s) => ({
          seasonNumber: s.season_number,
          episodeCount: s.episode_count,
          airDate: s.air_date ?? null,
        }));
      return {
        id,
        mediaType: "tv",
        title: show.name ?? show.original_name ?? "",
        originalTitle: show.original_name ?? show.name ?? "",
        literalTitle: findLiteralTitle(show.alternative_titles?.results),
        imdbId: show.external_ids?.imdb_id ?? null,
        tvStatus: show.status ?? null,
        nextEpisode:
          show.next_episode_to_air?.air_date &&
          show.next_episode_to_air.season_number != null &&
          show.next_episode_to_air.episode_number != null
            ? {
                seasonNumber: show.next_episode_to_air.season_number,
                episodeNumber: show.next_episode_to_air.episode_number,
                airDate: show.next_episode_to_air.air_date,
              }
            : null,
        seasons,
        overview,
        genres: (show.genres ?? []).map((g) => g.name ?? "").filter(Boolean),
        posterUrl: show.poster_path ? `https://image.tmdb.org/t/p/w342${show.poster_path}` : null,
      };
    }
  } catch {
    return {
      id,
      mediaType,
      title: "",
      originalTitle: "",
      literalTitle: null,
      imdbId: null,
      tvStatus: null,
      nextEpisode: null,
      seasons: [],
      overview: null,
      genres: [],
      posterUrl: null,
    };
  }
}

export const getTmdbDetails = createServerFn({ method: "GET" })
  .validator((data: { id: number; mediaType: "movie" | "tv" }) => data)
  .handler(async ({ data }): Promise<TmdbDetails> => {
    const { requireAuth } = await import("./admin.server");
    await requireAuth();
    return getTmdbDetailsInternal(data.id, data.mediaType);
  });

export interface TmdbEpisode {
  episodeNum: number;
  title: string;
  airDate: string | null;
  aired: boolean;
}

// Găsește titlul unui episod dintr-o listă deja încărcată (getTmdbSeasonEpisodes*)
// — sursă unică, folosită atât în wizard-ul "Adaugă film/serial" (AddMediaWizard)
// cât și în buildTorrentDisplayName (tmdb-title-lookup.ts, pentru notificări),
// ca să nu se repete același `.find(...) ?? fallback` în ambele locuri.
export function findEpisodeTitle(episodes: TmdbEpisode[], episodeNum: number): string {
  return episodes.find((e) => e.episodeNum === episodeNum)?.title ?? `Episodul ${episodeNum}`;
}

// TMDB, când nu are o traducere RO reală pentru un episod, nu întoarce câmp
// gol — întoarce un placeholder generic "Episodul {N}" (autogenerat, în
// funcție de limba cerută). E indistigabil de un titlu real doar uitându-te
// dacă e gol, deci verificăm explicit acest tipar.
function isGenericEpisodePlaceholder(name: string | undefined, episodeNumber: number): boolean {
  const n = name?.trim();
  if (!n) return true;
  return new RegExp(`^episodul\\s*${episodeNumber}$`, "i").test(n);
}

// Versiune internă (funcție simplă, fără createServerFn) — folosită și din
// server/plugins (pinned-watcher.ts) sau alt cod server-side care nu poate
// trece prin granița de server function (același pattern ca
// checkFilelistForItemInternal din filelist/download.ts).
export async function getTmdbSeasonEpisodesInternal(
  tmdbId: number,
  seasonNum: number,
): Promise<TmdbEpisode[]> {
  try {
    const path = `/tv/${tmdbId}/season/${seasonNum}`;
    // Cache-bust (_=timestamp) — CDN-ul TMDB ține cache pe URL exact, iar un
    // episod aterizat chiar azi (titlu adăugat abia după difuzare) poate
    // rămâne cu placeholder generic minute/ore bune după ce TMDB chiar are
    // deja titlul real, dacă lovim un răspuns cache-uit mai vechi. Confirmat
    // reproductibil: același request fără cache-bust întorcea "Episode 8" în
    // loc de titlul real "The Treasons at Tumbleton", la câteva ore după
    // difuzare (House of the Dragon S03E08, 2026-08-09).
    const bust = `_=${Date.now()}`;
    const season = await tmdbFetch<TmdbApiSeason>(`${path}?language=ro-RO&${bust}`);
    // TMDB nu are titluri RO pentru toate episoadele (mai ales lansări
    // recente) — cădem pe engleză doar pentru cele fără traducere reală,
    // nu pentru tot sezonul, ca să nu pierdem degeaba titlurile RO existente.
    const missingRo = (season.episodes ?? []).some((e) =>
      isGenericEpisodePlaceholder(e.name, e.episode_number),
    );
    const seasonEn = missingRo
      ? await tmdbFetch<TmdbApiSeason>(`${path}?${bust}`).catch(() => null)
      : null;
    const enByNum = new Map((seasonEn?.episodes ?? []).map((e) => [e.episode_number, e.name]));

    const todayStr = new Date().toISOString().slice(0, 10);
    return (season.episodes ?? []).map((e) => {
      const airDate = e.air_date ?? null;
      const enName = enByNum.get(e.episode_number)?.trim();
      // Dacă și titlul englez e tot un placeholder generic ("Episode 8" —
      // TMDB întoarce mereu placeholder-ul în limba cerută, nu doar în RO),
      // preferăm varianta noastră curată în română, nu textul englez brut.
      const enIsGeneric =
        enName && new RegExp(`^episode\\s*${e.episode_number}$`, "i").test(enName);
      const title = isGenericEpisodePlaceholder(e.name, e.episode_number)
        ? enName && !enIsGeneric
          ? enName
          : `Episodul ${e.episode_number}`
        : e.name!.trim();
      return {
        episodeNum: Number(e.episode_number),
        title,
        airDate,
        aired: airDate ? airDate < todayStr : false,
      };
    });
  } catch {
    return [];
  }
}

export const getTmdbSeasonEpisodes = createServerFn({ method: "GET" })
  .validator((data: { tmdbId: number; seasonNum: number }) => data)
  .handler(async ({ data }): Promise<TmdbEpisode[]> => {
    const { requireAuth } = await import("./admin.server");
    await requireAuth();
    return getTmdbSeasonEpisodesInternal(data.tmdbId, data.seasonNum);
  });

export interface TmdbSeasonSchema {
  seasonNumber: number;
  episodes: TmdbEpisode[];
}

// Schema completă (toate sezoanele, cu episoade+date de lansare) într-un
// singur request suplimentar — folosind append_to_response=season/1,season/2,...
// (posibil doar după ce știm câte sezoane are serialul, din getTmdbDetails).
// Wizard-ul ("Adaugă film/serial") are nevoie de toată schema dintr-o dată, ca
// utilizatorul să vadă orice sezon extins fără să aștepte un request nou de
// fiecare dată — spre deosebire de getTmdbSeasonEpisodes de mai sus (un
// singur sezon, fetch la cerere, folosit de cardurile de fixare).
export async function getTmdbAllSeasonsInternal(
  tmdbId: number,
  seasonNumbers: number[],
): Promise<TmdbSeasonSchema[]> {
  if (seasonNumbers.length === 0) return [];
  // Plafon de siguranță — peste el, un URL cu zeci de "season/N" ar deveni
  // nerezonabil de lung; apelantul cade atunci pe fetch per-sezon, la cerere
  // (getTmdbSeasonEpisodes), exact ca la cardurile de fixare.
  if (seasonNumbers.length > 40) return [];

  try {
    const bust = `_=${Date.now()}`;
    const append = seasonNumbers.map((n) => `season/${n}`).join(",");
    const roJson = await tmdbFetch<Record<string, TmdbApiSeason>>(
      `/tv/${tmdbId}?language=ro-RO&append_to_response=${append}&${bust}`,
    );
    const roBySeason = new Map<number, TmdbApiSeason>();
    for (const n of seasonNumbers) {
      const s = roJson[`season/${n}`];
      if (s) roBySeason.set(n, s);
    }

    // Fallback pe engleză — un singur request suplimentar, batched la fel,
    // declanșat doar dacă chiar lipsește vreun titlu RO undeva (aceeași
    // logică per-episod ca getTmdbSeasonEpisodesInternal, doar aplicată o
    // singură dată pentru toate sezoanele, nu per-sezon).
    const needsEnFallback = [...roBySeason.values()].some((s) =>
      (s.episodes ?? []).some((e) => isGenericEpisodePlaceholder(e.name, e.episode_number)),
    );
    const enBySeason = new Map<number, TmdbApiSeason>();
    if (needsEnFallback) {
      try {
        const enJson = await tmdbFetch<Record<string, TmdbApiSeason>>(
          `/tv/${tmdbId}?append_to_response=${append}&${bust}`,
        );
        for (const n of seasonNumbers) {
          const s = enJson[`season/${n}`];
          if (s) enBySeason.set(n, s);
        }
      } catch {
        // fallback rămâne gol — titlurile generice rămân "Episodul N"
      }
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    return seasonNumbers.map((n) => {
      const season = roBySeason.get(n);
      const seasonEn = enBySeason.get(n);
      const enByNum = new Map((seasonEn?.episodes ?? []).map((e) => [e.episode_number, e.name]));
      const episodes: TmdbEpisode[] = (season?.episodes ?? []).map((e) => {
        const airDate = e.air_date ?? null;
        const enName = enByNum.get(e.episode_number)?.trim();
        const enIsGeneric =
          enName && new RegExp(`^episode\\s*${e.episode_number}$`, "i").test(enName);
        const title = isGenericEpisodePlaceholder(e.name, e.episode_number)
          ? enName && !enIsGeneric
            ? enName
            : `Episodul ${e.episode_number}`
          : e.name!.trim();
        return {
          episodeNum: Number(e.episode_number),
          title,
          airDate,
          aired: airDate ? airDate < todayStr : false,
        };
      });
      return { seasonNumber: n, episodes };
    });
  } catch {
    return [];
  }
}

export const getTmdbAllSeasons = createServerFn({ method: "GET" })
  .validator((data: { tmdbId: number; seasonNumbers: number[] }) => data)
  .handler(async ({ data }): Promise<TmdbSeasonSchema[]> => {
    const { requireAuth } = await import("./admin.server");
    await requireAuth();
    return getTmdbAllSeasonsInternal(data.tmdbId, data.seasonNumbers);
  });

// ---------------------------------------------------------------------------
// Rezolvare titlu Plex → id TMDB, prin căutare directă (nu prin IMDb id, pe
// care Plex nu-l expune fiabil în răspunsul de metadate) — folosit de pagina
// Bibliotecă (plex-browse.ts) ca să ajungă la genuri/rezumat RO/imdbId
// pornind doar de la titlul + anul din Plex.
// ---------------------------------------------------------------------------

export async function searchTmdbTopResultInternal(
  query: string,
  mediaType: "movie" | "tv",
  year?: number | null,
): Promise<number | null> {
  const q = query.trim();
  if (!q) return null;
  try {
    const params = new URLSearchParams({ query: q });
    if (year) params.set(mediaType === "movie" ? "year" : "first_air_date_year", String(year));

    // Plex (agent RO) dă adesea titlul deja tradus în română — căutarea
    // implicită a TMDB (en-US) poate rata astfel de titluri complet diferite
    // de cel original (ex. "Iadul pe pământ" vs "Hell on Earth"). Încercăm
    // întâi cu language=ro-RO (TMDB potrivește și pe titlul RO), apoi cădem
    // pe căutarea implicită dacă nu găsește nimic.
    params.set("language", "ro-RO");
    const roRes = await tmdbFetch<TmdbApiSearchResponse>(
      `/search/${mediaType}?${params.toString()}`,
    );
    if (roRes.results?.[0]?.id) return roRes.results[0].id;

    params.delete("language");
    const res = await tmdbFetch<TmdbApiSearchResponse>(`/search/${mediaType}?${params.toString()}`);
    return res.results?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

interface TmdbApiEpisodeDetail {
  overview?: string | null;
}

// Rezumat RO (cu fallback EN) al unui episod anume — separat de
// getTmdbSeasonEpisodesInternal, care întoarce doar titluri, nu rezumate.
export async function getTmdbEpisodeOverviewInternal(
  tmdbShowId: number,
  season: number,
  episode: number,
): Promise<string | null> {
  try {
    const ro = await tmdbFetch<TmdbApiEpisodeDetail>(
      `/tv/${tmdbShowId}/season/${season}/episode/${episode}?language=ro-RO`,
    );
    const roOverview = ro.overview?.trim();
    if (roOverview) return roOverview;
    const en = await tmdbFetch<TmdbApiEpisodeDetail>(
      `/tv/${tmdbShowId}/season/${season}/episode/${episode}`,
    ).catch(() => null);
    return en?.overview?.trim() || null;
  } catch {
    return null;
  }
}

export interface TvShowCountdown {
  status: "ok" | "error" | "not_found";
  showName: string;
  tvmazeId: number | null;
  imdbId: string | null;
  lastAired: {
    season: number;
    episode: number;
    title: string;
    airDateIso: string;
    inLibrary: boolean | null;
  } | null;
  next: {
    season: number;
    episode: number;
    title: string;
    airDateIso: string;
  } | null;
}

export const getTvShowCountdown = createServerFn({ method: "GET" })
  .validator((data: { imdbId: string | null; showTitle: string }) => data)
  .handler(async ({ data }): Promise<TvShowCountdown> => {
    const { requireAuth } = await import("./admin.server");
    await requireAuth();
    try {
      let tvmazeShow: TvmazeShow | null = null;

      // Încearcă lookup direct după IMDB id (mai precis)
      if (data.imdbId) {
        try {
          const res = await fetch(
            `https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(data.imdbId)}`,
            { signal: AbortSignal.timeout(6000) },
          );
          if (res.ok) tvmazeShow = await res.json();
        } catch {
          // fallback la căutarea după titlu, mai jos
        }
      }

      // Fallback: caută după titlu
      if (!tvmazeShow) {
        const res = await fetch(
          `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(data.showTitle)}`,
          { signal: AbortSignal.timeout(6000) },
        );
        if (res.ok) {
          const results: TvmazeSearchResult[] = await res.json();
          tvmazeShow = results[0]?.show ?? null;
        }
      }

      if (!tvmazeShow) {
        return {
          status: "not_found",
          showName: data.showTitle,
          tvmazeId: null,
          imdbId: data.imdbId,
          lastAired: null,
          next: null,
        };
      }

      const showRes = await fetch(`https://api.tvmaze.com/shows/${tvmazeShow.id}?embed=episodes`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!showRes.ok) throw new Error(`TVmaze ${showRes.status}`);
      const show: TvmazeShow = await showRes.json();

      const episodes = (show._embedded?.episodes ?? [])
        .filter((e) => e.airstamp && Number(e.season) > 0)
        .map((e) => ({
          season: Number(e.season),
          episode: Number(e.number),
          title: e.name || `Episodul ${e.number}`,
          airDateIso: e.airstamp as string,
        }));

      const now = Date.now();
      const aired = episodes.filter((e) => new Date(e.airDateIso).getTime() <= now);
      const lastAiredEp = aired.length > 0 ? aired[aired.length - 1] : null;
      const nextEp = episodes.find((e) => new Date(e.airDateIso).getTime() > now) ?? null;

      let inLibrary: boolean | null = null;
      if (lastAiredEp) {
        inLibrary = await checkPlexHasEpisode(
          data.showTitle,
          lastAiredEp.season,
          lastAiredEp.episode,
        );
      }

      return {
        status: "ok",
        showName: show.name ?? data.showTitle,
        tvmazeId: tvmazeShow.id,
        imdbId: show.externals?.imdb ?? data.imdbId,
        lastAired: lastAiredEp ? { ...lastAiredEp, inLibrary } : null,
        next: nextEp ?? null,
      };
    } catch {
      return {
        status: "error",
        showName: data.showTitle,
        tvmazeId: null,
        imdbId: data.imdbId,
        lastAired: null,
        next: null,
      };
    }
  });
