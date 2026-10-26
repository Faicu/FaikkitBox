import { createServerFn } from "@tanstack/react-start";
import { tmdbFetch } from "./tmdb-client";
import { interleaveSearchResults } from "./search-merge";

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
  original_language?: string;
  overview?: string | null;
  release_date?: string | null;
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
  original_language?: string;
  overview?: string | null;
  external_ids?: { imdb_id?: string | null };
  first_air_date?: string | null;
  status?: string | null;
  in_production?: boolean;
  next_episode_to_air?: {
    season_number?: number;
    episode_number?: number;
    air_date?: string | null;
  } | null;
  last_episode_to_air?: { air_date?: string | null } | null;
  seasons?: TmdbApiSeasonSummary[];
  alternative_titles?: { results?: TmdbApiAlternativeTitle[] };
  genres?: TmdbApiGenre[];
  poster_path?: string | null;
}

// „Literal title” în TMDB = romanizarea folosită pe scenă pentru titlurile în
// alt alfabet (Colony 2026: original „군체”, pe Filelist „Gunche”).
function findLiteralTitle(titles: TmdbApiAlternativeTitle[] | undefined): string | null {
  return titles?.find((t) => t.type === "literal title")?.title ?? null;
}

interface TmdbApiEpisode {
  episode_number: number;
  name?: string;
  air_date?: string | null;
  overview?: string;
  still_path?: string | null;
}

interface TmdbApiSeason {
  episodes?: TmdbApiEpisode[];
  poster_path?: string | null;
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
    const { requireAuth } = await import("../auth/admin.server");
    await requireAuth();
    const q = data.query.trim();
    if (!q) return [];
    try {
      // TMDB caută în titlurile limbii cererii, deci ro și en dau liste diferite
      // („elita” pe en-US nu găsește Élite). Le intercalăm, ca primul rezultat
      // din fiecare limbă să fie în primele două. Titlul salvat e cel ro-RO unde
      // există — altfel apărea englezesc peste tot în aplicație.
      const [json, roJson] = await Promise.all([
        tmdbFetch<TmdbApiSearchResponse>(
          `/search/multi?query=${encodeURIComponent(q)}&include_adult=false&language=en-US&page=1`,
        ),
        tmdbFetch<TmdbApiSearchResponse>(
          `/search/multi?query=${encodeURIComponent(q)}&include_adult=false&language=ro-RO&page=1`,
        ).catch(() => null),
      ]);
      const roByKey = new Map((roJson?.results ?? []).map((r) => [`${r.media_type}:${r.id}`, r]));
      const merged = interleaveSearchResults(roJson?.results ?? [], json.results ?? []);
      return merged.slice(0, 8).map((r) => {
        const roR = roByKey.get(`${r.media_type}:${r.id}`);
        const enTitle =
          r.media_type === "movie"
            ? (r.title ?? r.original_title ?? "")
            : (r.name ?? r.original_name ?? "");
        const roTitle = roR ? (r.media_type === "movie" ? roR.title : roR.name) : null;
        return {
          id: r.id,
          mediaType: r.media_type as "movie" | "tv",
          title: roTitle?.trim() || enTitle,
          originalTitle:
            r.media_type === "movie"
              ? (r.original_title ?? r.title ?? "")
              : (r.original_name ?? r.name ?? ""),
          year:
            r.media_type === "movie"
              ? (r.release_date ?? "").slice(0, 4) || null
              : (r.first_air_date ?? "").slice(0, 4) || null,
          posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w92${r.poster_path}` : null,
        };
      });
    } catch {
      return [];
    }
  });

export interface TmdbDetails {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  originalTitle: string;
  // Titlul romanizat („Gunche” pentru 군체), ca pe IMDb și Filelist; null fără.
  literalTitle: string | null;
  imdbId: string | null;
  // Lansarea (film) / primul episod (serial), „YYYY-MM-DD”; null neanunțat.
  releaseDate: string | null;
  // doar pentru tv:
  tvStatus: string | null;
  // Următorul episod anunțat (cu dată) — tvStatus spune doar că serialul e
  // reînnoit, nu că există un episod programat.
  nextEpisode: { seasonNumber: number; episodeNumber: number; airDate: string } | null;
  // Ultimul episod difuzat — fereastra orară a urmăririi.
  lastEpisodeAirDate?: string | null;
  seasons: Array<{ seasonNumber: number; episodeCount: number; airDate: string | null }>;
  // Rezumat în română, altfel engleză.
  overview: string | null;
  // Genurile (RO) — lista TMDB e predefinită, deci mereu traduse.
  genres: string[];
  posterUrl: string | null;
}

// Numele ro-RO egal cu originalul înseamnă de obicei traducere lipsă, deci un
// titlu alternativ „RO” e mai bun. NU la producțiile românești: acolo
// alternativul e varianta internațională (Insula Iubirii devenea „Temptation
// Island – Insula iubirii”).
function shouldTryRomanianAka(
  title: string,
  originalTitle: string | undefined,
  lang: string | undefined,
): boolean {
  return !!title && title === originalTitle?.trim() && lang !== "ro";
}

// Fără createServerFn — și pentru apelurile din alt cod de server.
export async function getTmdbDetailsInternal(
  id: number,
  mediaType: "movie" | "tv",
): Promise<TmdbDetails> {
  try {
    if (mediaType === "movie") {
      const movie = await tmdbFetch<TmdbApiMovie>(
        `/movie/${id}?language=ro-RO&append_to_response=external_ids,alternative_titles`,
      );
      // Engleza se cere cel mult o dată, doar dacă lipsește ceva în română.
      let enMovieP: Promise<TmdbApiMovie | null> | null = null;
      const enMovie = () =>
        (enMovieP ??= tmdbFetch<TmdbApiMovie>(`/movie/${id}`).catch(() => null));
      let overview = movie.overview?.trim() || null;
      if (!overview) overview = (await enMovie())?.overview?.trim() || null;
      let title = movie.title?.trim() || movie.original_title?.trim() || "";
      if (shouldTryRomanianAka(title, movie.original_title, movie.original_language)) {
        const { findRomanianAkaTitle } = await import("./tmdb-title-lookup");
        title = (await findRomanianAkaTitle("movie", id)) || title;
      }
      // Fără titlu românesc: engleza înaintea originalului (un film coreean e
      // mai lizibil în engleză).
      if (shouldTryRomanianAka(title, movie.original_title, movie.original_language)) {
        title = (await enMovie())?.title?.trim() || title;
      }
      return {
        id,
        mediaType: "movie",
        title,
        originalTitle: movie.original_title ?? movie.title ?? "",
        literalTitle: findLiteralTitle(movie.alternative_titles?.titles),
        imdbId: movie.external_ids?.imdb_id ?? movie.imdb_id ?? null,
        releaseDate: movie.release_date || null,
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
      // Engleza cel mult o dată, la nevoie.
      let enShowP: Promise<TmdbApiTvShow | null> | null = null;
      const enShow = () => (enShowP ??= tmdbFetch<TmdbApiTvShow>(`/tv/${id}`).catch(() => null));
      let overview = show.overview?.trim() || null;
      if (!overview) overview = (await enShow())?.overview?.trim() || null;
      let title = show.name?.trim() || show.original_name?.trim() || "";
      if (shouldTryRomanianAka(title, show.original_name, show.original_language)) {
        const { findRomanianAkaTitle } = await import("./tmdb-title-lookup");
        title = (await findRomanianAkaTitle("tv", id)) || title;
      }
      // Fără titlu românesc: engleza înaintea originalului.
      if (shouldTryRomanianAka(title, show.original_name, show.original_language)) {
        title = (await enShow())?.name?.trim() || title;
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
        title,
        originalTitle: show.original_name ?? show.name ?? "",
        literalTitle: findLiteralTitle(show.alternative_titles?.results),
        imdbId: show.external_ids?.imdb_id ?? null,
        releaseDate: show.first_air_date || null,
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
        lastEpisodeAirDate: show.last_episode_to_air?.air_date || null,
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
      releaseDate: null,
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
    const { requireAuth } = await import("../auth/admin.server");
    await requireAuth();
    return getTmdbDetailsInternal(data.id, data.mediaType);
  });

export interface TmdbEpisode {
  episodeNum: number;
  title: string;
  airDate: string | null;
  aired: boolean;
  // Doar cu `details: true`: descrierea (RO, altfel EN, null fără) și un cadru
  // din episod (orizontal).
  overview?: string | null;
  stillUrl?: string | null;
}

// Titlul unui episod dintr-o listă deja încărcată — comun wizard-ului și
// notificărilor.
export function findEpisodeTitle(episodes: TmdbEpisode[], episodeNum: number): string {
  return episodes.find((e) => e.episodeNum === episodeNum)?.title ?? `Episodul ${episodeNum}`;
}

// Fără traducere, TMDB nu întoarce gol, ci „Episodul {N}” — verificat explicit.
function isGenericEpisodePlaceholder(name: string | undefined, episodeNumber: number): boolean {
  const n = name?.trim();
  if (!n) return true;
  return new RegExp(`^episodul\\s*${episodeNumber}$`, "i").test(n);
}

// Fără createServerFn — pentru apelurile din alt cod de server.
export async function getTmdbSeasonEpisodesInternal(
  tmdbId: number,
  seasonNum: number,
): Promise<TmdbEpisode[]> {
  try {
    const path = `/tv/${tmdbId}/season/${seasonNum}`;
    // Cache-bust: CDN-ul TMDB ține cache pe URL, iar un episod abia difuzat
    // rămânea ore întregi cu placeholder-ul, deși TMDB avea titlul (House of
    // the Dragon S03E08, 9 aug. 2026).
    const bust = `_=${Date.now()}`;
    const season = await tmdbFetch<TmdbApiSeason>(`${path}?language=ro-RO&${bust}`);
    // Engleza doar pentru episoadele fără traducere, nu pentru tot sezonul.
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
      // Placeholder și în engleză: păstrăm varianta curată în română.
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

export interface TmdbSeasonSchema {
  seasonNumber: number;
  episodes: TmdbEpisode[];
  // Doar cu `details: true`: posterul sezonului (românesc când există).
  posterUrl?: string | null;
}

// Toate sezoanele (episoade + date) într-o singură cerere suplimentară, prin
// append_to_response — wizard-ul arată orice sezon fără altă cerere.
// `details` adaugă descrierile, cadrele și posterele — pentru Bibliotecă;
// wizard-ul nu le cere, ar îngreuna răspunsul.
export async function getTmdbAllSeasonsInternal(
  tmdbId: number,
  seasonNumbers: number[],
  opts: { details?: boolean } = {},
): Promise<TmdbSeasonSchema[]> {
  if (seasonNumbers.length === 0) return [];
  // Plafon — peste el, URL-ul cu „season/N” ar fi prea lung.
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

    // Engleza într-o singură cerere suplimentară, doar dacă lipsește vreun
    // titlu românesc.
    const needsEnFallback = [...roBySeason.values()].some((s) =>
      (s.episodes ?? []).some(
        (e) =>
          isGenericEpisodePlaceholder(e.name, e.episode_number) ||
          (opts.details && !e.overview?.trim()),
      ),
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
      const enOverviewByNum = new Map(
        (seasonEn?.episodes ?? []).map((e) => [e.episode_number, e.overview?.trim() || null]),
      );
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
          ...(opts.details
            ? {
                overview: e.overview?.trim() || enOverviewByNum.get(e.episode_number) || null,
                // Originalul: cadrele au doar 92/185/300 px, iar 300 e neclar pe
                // lățimea unui telefon.
                stillUrl: e.still_path
                  ? `https://image.tmdb.org/t/p/original${e.still_path}`
                  : null,
              }
            : {}),
        };
      });
      return {
        seasonNumber: n,
        episodes,
        ...(opts.details
          ? {
              posterUrl: season?.poster_path
                ? `https://image.tmdb.org/t/p/w342${season.poster_path}`
                : null,
            }
          : {}),
      };
    });
  } catch {
    return [];
  }
}
