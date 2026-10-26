import { fetchJson, type ServiceStatus } from "./shared";
import {
  discoverPlexUrl,
  normalizeShowTitle,
  plexQualityFromMedia,
  plexQualitiesFromItem,
  plexMediaForPath,
  type PlexApiResponse,
  type PlexMetadataItem,
} from "./plex-shared";

// ---------------------------------------------------------------------------
// Căutarea titlurilor și episoadelor în Plex după ID-ul TMDB: pentru wizard
// („e deja în Plex?”) și pentru legarea rândurilor din `media`.
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

// Cache scurt pentru key-urile secțiunilor (filme / seriale).
const sectionCache = new Map<string, { url: string; key: string; expiresAt: number }>();

async function findSectionKey(
  url: string,
  headers: Record<string, string>,
  type: "movie" | "show",
): Promise<string | undefined> {
  const cached = sectionCache.get(type);
  if (cached && cached.url === url && cached.expiresAt > Date.now()) return cached.key;
  const sections = await fetchJson<PlexApiResponse>(`${url}/library/sections`, { headers }, 8000);
  const dirs = sections?.MediaContainer?.Directory ?? [];
  const section = dirs.find((d) => d.type === type);
  if (!section?.key) return undefined;
  sectionCache.set(type, { url, key: section.key, expiresAt: Date.now() + 5 * 60 * 1000 });
  return section.key;
}

// Titlul căutat: `tmdbId` e reperul sigur; titlurile servesc la căutare și, fără
// ID, la potrivirea exactă.
export interface PlexLookup {
  tmdbId: number | null;
  titles: string[];
}

function hasTmdbId(item: PlexMetadataItem, tmdbId: number): boolean {
  return (item.Guid ?? []).some((g) => g.id === `tmdb://${tmdbId}`);
}

// Cu ID TMDB, decide doar ID-ul: biblioteca Plex e în română („Imperiul
// Mafiei” pentru MobLand), iar potrivirea după titlu lega în tăcere alt serial
// (You → Younger). Fără ID, doar potrivirea exactă — mai bine nelegat decât
// legat greșit.
function matchesLookup(item: PlexMetadataItem, lookup: PlexLookup): boolean {
  if (lookup.tmdbId != null) return hasTmdbId(item, lookup.tmdbId);
  const wanted = new Set(lookup.titles.filter(Boolean).map(normalizeShowTitle));
  return [item.title, item.originalTitle].some(
    (t) => t != null && wanted.has(normalizeShowTitle(String(t))),
  );
}

// Item-ul Plex al unui titlu: prin căutare, apoi în lista completă a secțiunii
// (căutarea nu găsește mereu după titlul original — „Élite” vs „Elita”).
// `includeGuids=1` e obligatoriu pentru `Guid`.
async function findItem(
  url: string,
  headers: Record<string, string>,
  type: "movie" | "show",
  lookup: PlexLookup,
): Promise<PlexMetadataItem | undefined> {
  const plexType = type === "movie" ? 1 : 2;
  const queries = [
    ...new Set(lookup.titles.filter(Boolean).flatMap((t) => [t, normalizeShowTitle(t)])),
  ];
  for (const q of queries) {
    const search = await fetchJson<PlexApiResponse>(
      `${url}/search?query=${encodeURIComponent(q)}&type=${plexType}&includeGuids=1`,
      { headers },
      8000,
    );
    const found = (search?.MediaContainer?.Metadata ?? []).find(
      (r) => r.type === type && matchesLookup(r, lookup),
    );
    if (found) return found;
  }

  const sectionKey = await findSectionKey(url, headers, type);
  if (!sectionKey) return undefined;
  const all = await fetchJson<PlexApiResponse>(
    `${url}/library/sections/${sectionKey}/all?type=${plexType}&includeGuids=1`,
    { headers },
    10000,
  );
  return (all?.MediaContainer?.Metadata ?? []).find(
    (r) => r.type === type && matchesLookup(r, lookup),
  );
}

// Episoadele brute dintr-un sezon.
async function findSeasonEpisodes(
  url: string,
  headers: Record<string, string>,
  show: PlexLookup,
  season: number,
): Promise<PlexMetadataItem[] | null> {
  const found = await findItem(url, headers, "show", show);
  if (!found) return null;

  const seasons = await fetchJson<PlexApiResponse>(
    `${url}/library/metadata/${found.ratingKey}/children`,
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
  show: PlexLookup,
  season: number,
): Promise<{ num: number; quality: string | null; watched: boolean }[]> {
  const episodesMd = await findSeasonEpisodes(url, headers, show, season);
  if (!episodesMd) return [];
  return episodesMd
    .filter((e: PlexMetadataItem) => Number(e.index) > 0)
    .map((e: PlexMetadataItem) => ({
      num: Number(e.index),
      quality: plexQualityFromMedia(e.Media?.[0]),
      watched: Number(e.viewCount ?? 0) > 0,
    }));
}

async function findWithQualities(
  url: string,
  headers: Record<string, string>,
  lookup: PlexLookup,
  mediaType: "movie" | "tv",
): Promise<{ found: boolean; qualities: string[] }> {
  const found = await findItem(url, headers, mediaType === "movie" ? "movie" : "show", lookup);
  if (!found) return { found: false, qualities: [] };
  // Toate versiunile (4K HDR și 1080p), ca wizard-ul să nu ofere ce ai deja.
  const full = found.ratingKey
    ? ((await fetchItemWithStreams(url, headers, String(found.ratingKey))) ?? found)
    : found;
  return { found: true, qualities: plexQualitiesFromItem(full) };
}

// Item-ul complet, cu stream-urile: `/search` nu întoarce `Part.Stream`, deci
// fără asta HDR-ul s-ar ghici din numele fișierului (un „DV” n-are „HDR” în
// nume). Plex e local, cererea costă milisecunde.
async function fetchItemWithStreams(
  url: string,
  headers: Record<string, string>,
  ratingKey: string,
): Promise<PlexMetadataItem | undefined> {
  const detail = await fetchJson<PlexApiResponse>(
    `${url}/library/metadata/${ratingKey}`,
    { headers },
    8000,
  );
  return detail?.MediaContainer?.Metadata?.[0];
}

// Item-ul cu toate versiunile, după ratingKey — recalcularea calității.
export async function fetchPlexItemVersions(
  ratingKey: string,
): Promise<PlexMetadataItem | undefined> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return undefined;
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const { url } = await discoverPlexUrl(token, base);
    return await fetchItemWithStreams(url, headers, ratingKey);
  } catch {
    return undefined;
  }
}

export interface PlexItemLink {
  ratingKey: string;
  quality: string | null;
  durationMs: number;
  // `null` la mai multe versiuni: `addedAt` e al item-ului (prima versiune), iar
  // un film abia descărcat sărea în josul Bibliotecii. Sortarea cade atunci pe
  // `added_at`.
  addedAt: number | null;
}

// Ce scriem în `media` despre un item Plex (versiunea noastră, calitate,
// durată, dată) — la prima legare și la recalcularea unui rând legat.
export function versionLinkFromItem(
  item: PlexMetadataItem,
  contentPath: string | null,
  torrentName: string | null,
): PlexItemLink | null {
  if (!item.ratingKey) return null;
  const ours = plexMediaForPath(item, contentPath, torrentName);
  return {
    ratingKey: String(item.ratingKey),
    quality: plexQualityFromMedia(ours),
    // Durata versiunii noastre, sau a item-ului (aceeași la un film).
    durationMs: Number(ours?.Part?.[0]?.duration ?? item.duration ?? 0),
    addedAt: (item.Media ?? []).length > 1 ? null : Number(item.addedAt ?? 0),
  };
}

// ratingKey-ul, calitatea și durata unui film din Plex, după ID-ul TMDB.
// `contentPath` (din qBittorrent) identifică versiunea NOASTRĂ; fără potrivire,
// legarea se face oricum, dar calitatea rămâne null — mai bine lipsă decât a
// altei versiuni.
export async function findPlexMovieLink(
  movie: PlexLookup,
  contentPath: string | null = null,
  torrentName: string | null = null,
): Promise<PlexItemLink | null> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return null;
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const { url } = await discoverPlexUrl(token, base);
    const found = await findItem(url, headers, "movie", movie);
    if (!found?.ratingKey) return null;
    const item = (await fetchItemWithStreams(url, headers, String(found.ratingKey))) ?? found;
    return versionLinkFromItem(item, contentPath, torrentName);
  } catch {
    return null;
  }
}

// Echivalentul pentru un episod.
export async function findPlexEpisodeLink(
  show: PlexLookup,
  season: number,
  episode: number,
): Promise<PlexItemLink | null> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return null;
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const { url } = await discoverPlexUrl(token, base);
    const episodesMd = await findSeasonEpisodes(url, headers, show, season);
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

// Un sezon întreg dintr-o cerere — pentru desfacerea pachetelor (media.ts).
export async function findPlexSeasonLinks(
  show: PlexLookup,
  season: number,
): Promise<Map<number, PlexItemLink> | null> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return null;
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const { url } = await discoverPlexUrl(token, base);
    const episodesMd = await findSeasonEpisodes(url, headers, show, season);
    if (!episodesMd) return null;
    const links = new Map<number, PlexItemLink>();
    for (const e of episodesMd) {
      const num = Number(e.index);
      if (!num || !e.ratingKey) continue;
      links.set(num, {
        ratingKey: String(e.ratingKey),
        quality: plexQualityFromMedia(e.Media?.[0]),
        durationMs: Number(e.duration ?? 0),
        addedAt: Number(e.addedAt ?? 0),
      });
    }
    return links;
  } catch {
    return null;
  }
}

// Verificările pentru wizard-check.functions.ts (o singură cerere per titlu).
// „Internal” e o rămășiță a vechilor server functions, șterse între timp.

export async function checkPlexHasTitleInternal(data: {
  tmdbId: number;
  title: string;
  originalTitle: string;
  mediaType: "movie" | "tv";
}): Promise<{ found: boolean; qualities: string[] } | null> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return null;
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const discovered = await discoverPlexUrl(token, base);
    return await findWithQualities(
      discovered.url,
      headers,
      { tmdbId: data.tmdbId, titles: [data.title, data.originalTitle] },
      data.mediaType,
    );
  } catch {
    return null;
  }
}

export async function getPlexEpisodesInSeasonInternal(data: {
  tmdbId: number;
  showTitle: string;
  season: number;
}): Promise<{ num: number; quality: string | null; watched: boolean }[]> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return [];
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const discovered = await discoverPlexUrl(token, base);
    return await episodesInSeason(
      discovered.url,
      headers,
      { tmdbId: data.tmdbId, titles: [data.showTitle] },
      data.season,
    );
  } catch {
    return [];
  }
}
