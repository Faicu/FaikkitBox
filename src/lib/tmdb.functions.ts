import { createServerFn } from "@tanstack/react-start";
import { checkPlexHasEpisode } from "./services.functions";

const TMDB_BASE = "https://api.themoviedb.org/3";

function tmdbHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.TMDB_API_KEY ?? ""}`,
    Accept: "application/json",
  };
}

async function tmdbFetch<T>(path: string, timeoutMs = 8000): Promise<T> {
  const res = await fetch(`${TMDB_BASE}${path}`, {
    headers: tmdbHeaders(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`TMDB a răspuns ${res.status}`);
  return res.json() as Promise<T>;
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
    const q = data.query.trim();
    if (!q) return [];
    try {
      const json: any = await tmdbFetch(
        `/search/multi?query=${encodeURIComponent(q)}&include_adult=false&language=en-US&page=1`,
      );
      const results: any[] = json.results ?? [];
      return results
        .filter((r: any) => r.media_type === "movie" || r.media_type === "tv")
        .slice(0, 8)
        .map((r: any) => ({
          id: r.id,
          mediaType: r.media_type as "movie" | "tv",
          title: r.media_type === "movie" ? (r.title ?? r.original_title ?? "") : (r.name ?? r.original_name ?? ""),
          originalTitle: r.media_type === "movie" ? (r.original_title ?? r.title ?? "") : (r.original_name ?? r.name ?? ""),
          year: r.media_type === "movie"
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
  imdbId: string | null;
  // doar pentru tv:
  tvStatus: string | null;
  seasons: Array<{ seasonNumber: number; episodeCount: number; airDate: string | null }>;
}

export const getTmdbDetails = createServerFn({ method: "GET" })
  .validator((data: { id: number; mediaType: "movie" | "tv" }) => data)
  .handler(async ({ data }): Promise<TmdbDetails> => {
    try {
      if (data.mediaType === "movie") {
        const movie: any = await tmdbFetch(`/movie/${data.id}?append_to_response=external_ids`);
        return {
          id: data.id,
          mediaType: "movie",
          title: movie.title ?? movie.original_title ?? "",
          originalTitle: movie.original_title ?? movie.title ?? "",
          imdbId: movie.external_ids?.imdb_id ?? movie.imdb_id ?? null,
          tvStatus: null,
          seasons: [],
        };
      } else {
        const show: any = await tmdbFetch(`/tv/${data.id}?append_to_response=external_ids`);
        const seasons = (show.seasons ?? [])
          .filter((s: any) => s.season_number > 0)
          .map((s: any) => ({
            seasonNumber: s.season_number,
            episodeCount: s.episode_count,
            airDate: s.air_date ?? null,
          }));
        return {
          id: data.id,
          mediaType: "tv",
          title: show.name ?? show.original_name ?? "",
          originalTitle: show.original_name ?? show.name ?? "",
          imdbId: show.external_ids?.imdb_id ?? null,
          tvStatus: show.status ?? null,
          seasons,
        };
      }
    } catch (e) {
      return {
        id: data.id,
        mediaType: data.mediaType,
        title: "",
        originalTitle: "",
        imdbId: null,
        tvStatus: null,
        seasons: [],
      };
    }
  });

export interface TmdbEpisode {
  episodeNum: number;
  title: string;
  airDate: string | null;
  aired: boolean;
}

export const getTmdbSeasonEpisodes = createServerFn({ method: "GET" })
  .validator((data: { tmdbId: number; seasonNum: number }) => data)
  .handler(async ({ data }): Promise<TmdbEpisode[]> => {
    try {
      const season: any = await tmdbFetch(`/tv/${data.tmdbId}/season/${data.seasonNum}`);
      const now = new Date();
      return (season.episodes ?? []).map((e: any) => {
        const airDate = e.air_date ?? null;
        return {
          episodeNum: Number(e.episode_number),
          title: e.name ?? `Episodul ${e.episode_number}`,
          airDate,
          aired: airDate ? new Date(airDate) <= now : false,
        };
      });
    } catch {
      return [];
    }
  });

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
    try {
      let tvmazeShow: any = null;

      // Încearcă lookup direct după IMDB id (mai precis)
      if (data.imdbId) {
        try {
          const res = await fetch(
            `https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(data.imdbId)}`,
            { signal: AbortSignal.timeout(6000) },
          );
          if (res.ok) tvmazeShow = await res.json();
        } catch {}
      }

      // Fallback: caută după titlu
      if (!tvmazeShow) {
        const res = await fetch(
          `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(data.showTitle)}`,
          { signal: AbortSignal.timeout(6000) },
        );
        if (res.ok) {
          const results: any[] = await res.json();
          tvmazeShow = results[0]?.show ?? null;
        }
      }

      if (!tvmazeShow) {
        return { status: "not_found", showName: data.showTitle, tvmazeId: null, imdbId: data.imdbId, lastAired: null, next: null };
      }

      const showRes = await fetch(
        `https://api.tvmaze.com/shows/${tvmazeShow.id}?embed=episodes`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!showRes.ok) throw new Error(`TVmaze ${showRes.status}`);
      const show: any = await showRes.json();

      const episodes = (show._embedded?.episodes ?? [])
        .filter((e: any) => e.airstamp && Number(e.season) > 0)
        .map((e: any) => ({
          season: Number(e.season),
          episode: Number(e.number),
          title: e.name || `Episodul ${e.number}`,
          airDateIso: e.airstamp as string,
        }));

      const now = Date.now();
      const aired = episodes.filter((e: any) => new Date(e.airDateIso).getTime() <= now);
      const lastAiredEp = aired.length > 0 ? aired[aired.length - 1] : null;
      const nextEp = episodes.find((e: any) => new Date(e.airDateIso).getTime() > now) ?? null;

      let inLibrary: boolean | null = null;
      if (lastAiredEp) {
        inLibrary = await checkPlexHasEpisode(data.showTitle, lastAiredEp.season, lastAiredEp.episode);
      }

      return {
        status: "ok",
        showName: show.name ?? data.showTitle,
        tvmazeId: tvmazeShow.id,
        imdbId: show.externals?.imdb ?? data.imdbId,
        lastAired: lastAiredEp ? { ...lastAiredEp, inLibrary } : null,
        next: nextEp ?? null,
      };
    } catch (e) {
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
