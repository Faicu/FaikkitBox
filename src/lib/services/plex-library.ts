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
// Căutare titluri/episoade în biblioteca Plex — folosit de wizard (Acasă)
// pentru a verifica dacă un film/episod e deja disponibil. Extras din fostul
// plex.ts monolitic.
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

// Cache scurt pentru key-ul secțiunii TV Shows, ca să nu interogăm
// /library/sections la fiecare căutare de fallback.
let showSectionCache: { url: string; key: string; expiresAt: number } | null = null;

async function findShowSectionKey(
  url: string,
  headers: Record<string, string>,
): Promise<string | undefined> {
  if (showSectionCache && showSectionCache.url === url && showSectionCache.expiresAt > Date.now()) {
    return showSectionCache.key;
  }
  const sections = await fetchJson<PlexApiResponse>(`${url}/library/sections`, { headers }, 8000);
  const dirs = sections?.MediaContainer?.Directory ?? [];
  const showSection = dirs.find((d) => d.type === "show");
  if (!showSection?.key) return undefined;
  showSectionCache = { url, key: showSection.key, expiresAt: Date.now() + 5 * 60 * 1000 };
  return showSection.key;
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
    const sectionKey = await findShowSectionKey(url, headers);
    if (!sectionKey) return undefined;
    const allShows = await fetchJson<PlexApiResponse>(
      `${url}/library/sections/${sectionKey}/all?type=2`,
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

// Găsește serialul după titlu și întoarce lista brută de episoade dintr-un
// sezon dat — comun pentru episodesInSeason și hasEpisode.
async function findSeasonEpisodes(
  url: string,
  headers: Record<string, string>,
  showTitle: string,
  season: number,
): Promise<PlexMetadataItem[] | null> {
  const show = await findShowByTitle(url, headers, showTitle);
  if (!show) return null;

  const seasons = await fetchJson<PlexApiResponse>(
    `${url}/library/metadata/${show.ratingKey}/children`,
    { headers },
    8000,
  );
  const seasonsMd = seasons?.MediaContainer?.Metadata ?? [];
  const seasonMatch = seasonsMd.find((s: PlexMetadataItem) => Number(s.index) === season);
  if (!seasonMatch) return null;

  const episodes = await fetchJson<PlexApiResponse>(
    `${url}/library/metadata/${seasonMatch.ratingKey}/children`,
    { headers },
    8000,
  );
  return episodes?.MediaContainer?.Metadata ?? [];
}

async function episodesInSeason(
  url: string,
  headers: Record<string, string>,
  showTitle: string,
  season: number,
): Promise<{ num: number; quality: string | null; watched: boolean }[]> {
  const episodesMd = await findSeasonEpisodes(url, headers, showTitle, season);
  if (!episodesMd) return [];
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
  const episodesMd = await findSeasonEpisodes(url, headers, showTitle, season);
  if (!episodesMd) return false;
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

export interface PlexItemLink {
  ratingKey: string;
  quality: string | null;
  durationMs: number;
  addedAt: number;
}

// Găsește ratingKey-ul + calitatea/durata unui film deja apărut în Plex —
// folosit ca să legăm un rând din tabela `media` de item-ul lui real din
// Plex, o singură dată, cache-uit permanent acolo (vezi media.ts).
export async function findPlexMovieLink(
  title: string,
  originalTitle: string,
): Promise<PlexItemLink | null> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return null;
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const { url } = await discoverPlexUrl(token, base);
    for (const q of [title, originalTitle].filter(Boolean)) {
      const search = await fetchJson<PlexApiResponse>(
        `${url}/search?query=${encodeURIComponent(q)}&type=1`,
        { headers },
        8000,
      );
      const item = (search?.MediaContainer?.Metadata ?? []).find((r) => r.type === "movie");
      if (item?.ratingKey) {
        return {
          ratingKey: String(item.ratingKey),
          quality: plexQualityFromMedia(item.Media?.[0]),
          durationMs: Number(item.duration ?? 0),
          addedAt: Number(item.addedAt ?? 0),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Echivalentul de mai sus, pentru un episod anume — reutilizează
// findSeasonEpisodes (aceeași sursă ca getPlexEpisodesInSeason).
export async function findPlexEpisodeLink(
  showTitle: string,
  season: number,
  episode: number,
): Promise<PlexItemLink | null> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return null;
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const { url } = await discoverPlexUrl(token, base);
    const episodesMd = await findSeasonEpisodes(url, headers, showTitle, season);
    const item = episodesMd?.find((e) => Number(e.index) === episode);
    if (item?.ratingKey) {
      return {
        ratingKey: String(item.ratingKey),
        quality: plexQualityFromMedia(item.Media?.[0]),
        durationMs: Number(item.duration ?? 0),
        addedAt: Number(item.addedAt ?? 0),
      };
    }
    return null;
  } catch {
    return null;
  }
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
      const { requireAuth } = await import("../admin.server");
      await requireAuth();
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
    const { requireAuth } = await import("../admin.server");
    await requireAuth();
    const token = process.env.PLEX_TOKEN;
    const base = process.env.PLEX_URL;
    if (!token) return null;
    try {
      const headers = { Accept: "application/json", "X-Plex-Token": token };
      const discovered = await discoverPlexUrl(token, base);
      return await findByTitle(
        discovered.url,
        headers,
        data.title,
        data.originalTitle,
        data.mediaType,
      );
    } catch {
      return null;
    }
  });
