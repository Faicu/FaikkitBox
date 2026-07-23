import { createServerFn } from "@tanstack/react-start";
import { fetchJson, errMsg, type ServiceStatus } from "./shared";
import {
  discoverPlexUrl,
  normalizeShowTitle,
  plexQualityFromMedia,
  type PlexApiResponse,
  type PlexMetadataItem,
} from "./plex-shared";

// ---------------------------------------------------------------------------
// Căutare titluri/episoade în biblioteca Plex — folosit de fluxul de
// urmărire "Lansări" (pinned watcher) pentru a verifica dacă un film/episod
// e deja disponibil. Extras din fostul plex.ts monolitic.
// ---------------------------------------------------------------------------

export interface ShowEpisodeInfo {
  season: number;
  episode: number;
  title: string;
  airDateIso: string;
}

export interface ShowStatusData {
  status: ServiceStatus;
  error?: string;
  show: string;
  lastAired: (ShowEpisodeInfo & { inLibrary: boolean | null }) | null;
  next: ShowEpisodeInfo | null;
}

async function findShowByTitle(
  url: string,
  headers: Record<string, string>,
  showTitle: string,
): Promise<PlexMetadataItem | undefined> {
  const normalizedTarget = normalizeShowTitle(showTitle);

  const search = await fetchJson<PlexApiResponse>(
    `${url}/search?query=${encodeURIComponent(showTitle)}&type=2`,
    { headers },
    8000,
  );
  const searchShows = (search?.MediaContainer?.Metadata ?? []).filter(
    (r: PlexMetadataItem) => r.type === "show",
  );
  let show: PlexMetadataItem | undefined =
    searchShows.find(
      (r: PlexMetadataItem) => normalizeShowTitle(String(r.title ?? "")) === normalizedTarget,
    ) ??
    searchShows.find((r: PlexMetadataItem) =>
      normalizeShowTitle(String(r.title ?? "")).includes(normalizedTarget),
    ) ??
    searchShows.find((r: PlexMetadataItem) =>
      normalizedTarget.includes(normalizeShowTitle(String(r.title ?? ""))),
    ) ??
    searchShows[0];

  if (!show) {
    const allShows = await fetchJson<PlexApiResponse>(
      `${url}/library/sections/2/all?type=2`,
      { headers },
      10000,
    );
    const libShows = (allShows?.MediaContainer?.Metadata ?? []).filter(
      (r: PlexMetadataItem) => r.type === "show",
    );
    show =
      libShows.find(
        (r: PlexMetadataItem) => normalizeShowTitle(String(r.title ?? "")) === normalizedTarget,
      ) ??
      libShows.find((r: PlexMetadataItem) =>
        normalizeShowTitle(String(r.title ?? "")).includes(normalizedTarget),
      ) ??
      libShows.find((r: PlexMetadataItem) =>
        normalizedTarget.includes(normalizeShowTitle(String(r.title ?? ""))),
      );
  }
  return show;
}

async function episodesInSeason(
  url: string,
  headers: Record<string, string>,
  showTitle: string,
  season: number,
): Promise<{ num: number; quality: string | null; watched: boolean }[]> {
  const show = await findShowByTitle(url, headers, showTitle);
  if (!show) return [];

  const seasons = await fetchJson<PlexApiResponse>(
    `${url}/library/metadata/${show.ratingKey}/children`,
    { headers },
    8000,
  );
  const seasonsMd = seasons?.MediaContainer?.Metadata ?? [];
  const seasonMatch = seasonsMd.find((s: PlexMetadataItem) => Number(s.index) === season);
  if (!seasonMatch) return [];

  const episodes = await fetchJson<PlexApiResponse>(
    `${url}/library/metadata/${seasonMatch.ratingKey}/children`,
    { headers },
    8000,
  );
  const episodesMd = episodes?.MediaContainer?.Metadata ?? [];
  return episodesMd
    .filter((e: PlexMetadataItem) => Number(e.index) > 0)
    .map((e: PlexMetadataItem) => ({
      num: Number(e.index),
      quality: plexQualityFromMedia(e.Media?.[0]),
      watched: Number(e.viewCount ?? 0) > 0,
    }));
}

async function hasEpisode(
  url: string,
  headers: Record<string, string>,
  showTitle: string,
  season: number,
  episode: number,
): Promise<boolean> {
  const show = await findShowByTitle(url, headers, showTitle);
  if (!show) return false;

  const seasons = await fetchJson<PlexApiResponse>(
    `${url}/library/metadata/${show.ratingKey}/children`,
    { headers },
    8000,
  );
  const seasonsMd = seasons?.MediaContainer?.Metadata ?? [];
  const seasonMatch = seasonsMd.find((s: PlexMetadataItem) => Number(s.index) === season);
  if (!seasonMatch) return false;

  const episodes = await fetchJson<PlexApiResponse>(
    `${url}/library/metadata/${seasonMatch.ratingKey}/children`,
    { headers },
    8000,
  );
  const episodesMd = episodes?.MediaContainer?.Metadata ?? [];
  return episodesMd.some((e: PlexMetadataItem) => Number(e.index) === episode);
}

async function findByTitle(
  url: string,
  headers: Record<string, string>,
  title: string,
  originalTitle: string,
  mediaType: "movie" | "tv",
): Promise<{ found: boolean; quality: string | null }> {
  const plexType = mediaType === "movie" ? 1 : 2;
  for (const q of [title, originalTitle, normalizeShowTitle(title)].filter(Boolean)) {
    const search = await fetchJson<PlexApiResponse>(
      `${url}/search?query=${encodeURIComponent(q)}&type=${plexType}`,
      { headers },
      8000,
    );
    const results = search?.MediaContainer?.Metadata ?? [];
    if (results.length > 0) {
      const quality = plexQualityFromMedia(results[0]?.Media?.[0]);
      return { found: true, quality };
    }
  }
  return { found: false, quality: null };
}

export async function checkPlexHasEpisode(
  showTitle: string,
  season: number,
  episode: number,
): Promise<boolean | null> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return null;
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const discovered = await discoverPlexUrl(token, base);
    return await hasEpisode(discovered.url, headers, showTitle, season, episode);
  } catch {
    return null;
  }
}

export const getPlexEpisodesInSeason = createServerFn({ method: "GET" })
  .validator((data: { showTitle: string; season: number }) => data)
  .handler(
    async ({ data }): Promise<{ num: number; quality: string | null; watched: boolean }[]> => {
      const token = process.env.PLEX_TOKEN;
      const base = process.env.PLEX_URL;
      if (!token) return [];
      try {
        const headers = { Accept: "application/json", "X-Plex-Token": token };
        const discovered = await discoverPlexUrl(token, base);
        return await episodesInSeason(discovered.url, headers, data.showTitle, data.season);
      } catch {
        return [];
      }
    },
  );

export const checkPlexHasTitle = createServerFn({ method: "GET" })
  .validator((data: { title: string; originalTitle: string; mediaType: "movie" | "tv" }) => data)
  .handler(async ({ data }): Promise<{ found: boolean; quality: string | null } | null> => {
    const token = process.env.PLEX_TOKEN;
    const base = process.env.PLEX_URL;
    if (!token) return null;
    try {
      const headers = { Accept: "application/json", "X-Plex-Token": token };
      const discovered = await discoverPlexUrl(token, base);
      return await findByTitle(discovered.url, headers, data.title, data.originalTitle, data.mediaType);
    } catch {
      return null;
    }
  });

// ---------------------------------------------------------------------------
// Funcții interne exportate (fără createServerFn, pentru plugin-uri background)
// ---------------------------------------------------------------------------

export async function getPlexEpisodesInSeasonInternal(
  showTitle: string,
  season: number,
): Promise<{ num: number; quality: string | null; watched: boolean }[]> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return [];
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const discovered = await discoverPlexUrl(token, base);
    return await episodesInSeason(discovered.url, headers, showTitle, season);
  } catch {
    return [];
  }
}

export async function checkPlexHasTitleInternal(
  title: string,
  originalTitle: string,
  mediaType: "movie" | "tv",
): Promise<{ found: boolean; quality: string | null } | null> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return null;
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const discovered = await discoverPlexUrl(token, base);
    return await findByTitle(discovered.url, headers, title, originalTitle, mediaType);
  } catch {
    return null;
  }
}

// ---------- House of the Dragon - Sezonul 3 ----------
//
// HBO nu are un API public pentru orarul de difuzare, deci calendarul e
// codat manual, pe baza orarului oficial confirmat (Duminica 9pm ET / 21:00,
// UTC-4 in perioada iunie-august, ora de vara SUA). Titlurile episoadelor
// necunoscute la data scrierii sunt generice ("Episodul N") - actualizeaza-le
// aici pe masura ce HBO le confirma.
const HOTD_S3_EPISODES: Array<{ episode: number; title: string; airDateIso: string }> = [
  { episode: 1, title: "Salt and Sea, Fire and Blood", airDateIso: "2026-06-22T01:00:00Z" },
  { episode: 2, title: "Queen's Landing", airDateIso: "2026-06-29T01:00:00Z" },
  { episode: 3, title: "Episodul 3", airDateIso: "2026-07-06T01:00:00Z" },
  { episode: 4, title: "Episodul 4", airDateIso: "2026-07-13T01:00:00Z" },
  { episode: 5, title: "Episodul 5", airDateIso: "2026-07-20T01:00:00Z" },
  { episode: 6, title: "Episodul 6", airDateIso: "2026-07-27T01:00:00Z" },
  { episode: 7, title: "Episodul 7", airDateIso: "2026-08-03T01:00:00Z" },
  { episode: 8, title: "Episodul 8 (finalul sezonului)", airDateIso: "2026-08-10T01:00:00Z" },
];
const HOTD_SEASON = 3;
const HOTD_SHOW_TITLE = "House of the Dragon";
// ---------- Cămătarii - Sezonul 1 ----------
//
// Difuzat pe PRO TV luni de la 23:30 EEST (= 20:30 UTC), incepand cu 25 mai 2026.
// Premiera (25 mai) a avut Ep1 pe TV + Ep1 SI Ep2 pe VOYO in aceeasi zi (VOYO a
// lansat 2 episoade deodata la lansare). De la Ep3 incolo, VOYO ramane cu o
// saptamana inaintea difuzarii TV, cadenta saptamanala, luni.
// TV:   Ep1=25 mai, Ep2=1 iun, Ep3=8 iun, Ep4=15 iun, Ep5=22 iun, Ep6=29 iun, Ep7=6 iul, Ep8=13 iul
// VOYO: Ep1=25 mai, Ep2=25 mai, Ep3=1 iun, Ep4=8 iun, Ep5=15 iun, Ep6=22 iun, Ep7=29 iun, Ep8=6 iul
//
// ATENTIE: numarul total de episoade (8) si data finalului nu au putut fi
// confirmate dintr-o sursa oficiala la data scrierii - verificat manual pe
// VOYO/Plex daca sezonul chiar se termina la Ep8, altfel ajusteaza mai jos.

async function buildShowStatus(
  showTitle: string,
  season: number,
  episodes: Array<{ episode: number; title: string; airDateIso: string }>,
): Promise<ShowStatusData> {
  try {
    const now = Date.now();
    const aired = episodes.filter((e) => new Date(e.airDateIso).getTime() <= now);
    const lastAiredEp = aired.length > 0 ? aired[aired.length - 1] : null;
    const nextEp = episodes.find((e) => new Date(e.airDateIso).getTime() > now) ?? null;

    let inLibrary: boolean | null = null;
    if (lastAiredEp) {
      inLibrary = await checkPlexHasEpisode(showTitle, season, lastAiredEp.episode);
    }

    return {
      status: "ok",
      show: `${showTitle} — Sezonul ${season}`,
      lastAired: lastAiredEp
        ? {
            season,
            episode: lastAiredEp.episode,
            title: lastAiredEp.title,
            airDateIso: lastAiredEp.airDateIso,
            inLibrary,
          }
        : null,
      next: nextEp
        ? { season, episode: nextEp.episode, title: nextEp.title, airDateIso: nextEp.airDateIso }
        : null,
    };
  } catch (e) {
    return {
      status: "error",
      error: errMsg(e),
      show: `${showTitle} — Sezonul ${season}`,
      lastAired: null,
      next: null,
    };
  }
}

export const getShowStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<ShowStatusData> => {
    return await buildShowStatus(HOTD_SHOW_TITLE, HOTD_SEASON, HOTD_S3_EPISODES);
  },
);
