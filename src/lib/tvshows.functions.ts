import { createServerFn } from "@tanstack/react-start";
import { checkPlexHasEpisode } from "./services.functions";
import type { ShowStatusData } from "./services.functions";

// TVmaze este folosit in locul IMDb, pentru doua motive:
// 1. IMDb blocheaza explicit accesul automatizat (robots.txt disallow) -
//    a construi ceva care il "loveste" la fiecare incarcare de pagina i-ar
//    incalca termenii si ar risca blocarea IP-ului serverului.
// 2. IMDb nu afiseaza, in general, ORA lansarii episoadelor - doar data.
//    TVmaze e un API public, gratuit, fara cheie, facut special pentru asta:
//    fiecare episod are un camp "airstamp" (ISO 8601, cu fus orar corect),
//    exact ce lipsea. Fiecare rezultat pastreaza si legatura catre IMDb
//    (externals.imdb), asa ca poti ajunge tot acolo cu un click.
const TVMAZE_BASE = "https://api.tvmaze.com";

interface TvmazeSearchResult {
  show: {
    id: number;
    name: string;
    premiered?: string | null;
    network?: { name?: string } | null;
    webChannel?: { name?: string } | null;
    image?: { medium?: string } | null;
    externals?: { imdb?: string | null };
  };
}

interface TvmazeEpisode {
  season: number;
  number: number;
  name?: string;
  airstamp?: string;
}

interface TvmazeShow {
  name: string;
  externals?: { imdb?: string | null };
  _embedded?: { episodes?: TvmazeEpisode[] };
}

export interface TvShowSearchResult {
  id: number;
  name: string;
  premiered: string | null;
  network: string | null;
  image: string | null;
  imdbId: string | null;
}

export const searchTvShows = createServerFn({ method: "GET" })
  .validator((data: { query: string }) => data)
  .handler(async ({ data }): Promise<TvShowSearchResult[]> => {
    const q = data.query.trim();
    if (!q) return [];
    try {
      const res = await fetch(`${TVMAZE_BASE}/search/shows?q=${encodeURIComponent(q)}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      const json: TvmazeSearchResult[] = await res.json();
      return json.slice(0, 8).map((r) => ({
        id: r.show.id,
        name: r.show.name,
        premiered: r.show.premiered ?? null,
        network: r.show.network?.name ?? r.show.webChannel?.name ?? null,
        image: r.show.image?.medium ?? null,
        imdbId: r.show.externals?.imdb ?? null,
      }));
    } catch {
      return [];
    }
  });

export interface CustomShowStatus extends ShowStatusData {
  showId: number;
  imdbId: string | null;
}

export const getTvShowStatus = createServerFn({ method: "GET" })
  .validator((data: { showId: number }) => data)
  .handler(async ({ data }): Promise<CustomShowStatus> => {
    try {
      const res = await fetch(`${TVMAZE_BASE}/shows/${data.showId}?embed=episodes`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`TVmaze a raspuns ${res.status}`);
      const show: TvmazeShow = await res.json();
      const showName: string = show.name;
      const imdbId: string | null = show.externals?.imdb ?? null;

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
        inLibrary = await checkPlexHasEpisode(showName, lastAiredEp.season, lastAiredEp.episode);
      }

      return {
        status: "ok",
        show: showName,
        showId: data.showId,
        imdbId,
        lastAired: lastAiredEp
          ? {
              season: lastAiredEp.season,
              episode: lastAiredEp.episode,
              title: lastAiredEp.title,
              airDateIso: lastAiredEp.airDateIso,
              inLibrary,
            }
          : null,
        next: nextEp
          ? {
              season: nextEp.season,
              episode: nextEp.episode,
              title: nextEp.title,
              airDateIso: nextEp.airDateIso,
            }
          : null,
      };
    } catch (e) {
      return {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
        show: "",
        showId: data.showId,
        imdbId: null,
        lastAired: null,
        next: null,
      };
    }
  });
