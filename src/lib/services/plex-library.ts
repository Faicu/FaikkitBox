import { createServerFn } from "@tanstack/react-start";
import { fetchJson, type ServiceStatus } from "./shared";
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

