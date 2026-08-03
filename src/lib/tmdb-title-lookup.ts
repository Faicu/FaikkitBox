// ---------------------------------------------------------------------------
// Lookup titlu film/serial pornind de la un IMDb id — folosit ca să afișăm
// în jurnal/notificări titlul real ("The Death of Robin Hood"), nu numele
// tehnic al lansării ("The.Death.of.Robin.Hood.2026.1080p.AMZN.WEB-DL...").
// Vezi src/lib/filelist/subtitles.ts pentru contextul de utilizare.
// ---------------------------------------------------------------------------

import { tmdbFetch } from "./tmdb-client";

interface TmdbFindResponse {
  movie_results?: Array<{ title?: string }>;
  tv_results?: Array<{ name?: string }>;
}

const titleCache = new Map<string, { expiresAt: number; title: string | null }>();
const TITLE_CACHE_TTL = 60 * 60_000; // titlurile nu se schimbă — cache lung

// Fail-soft: null la orice eroare (lipsă TMDB_API_KEY, IMDb id necunoscut pe
// TMDB, timeout etc.) — apelantul cade pe numele tehnic al lansării.
export async function lookupTitleByImdbId(imdbId: string): Promise<string | null> {
  const key = imdbId.trim();
  if (!key) return null;

  const cached = titleCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.title;

  let title: string | null = null;
  try {
    const data = await tmdbFetch<TmdbFindResponse>(
      `/find/${encodeURIComponent(key)}?external_source=imdb_id`,
    );
    title = data.movie_results?.[0]?.title || data.tv_results?.[0]?.name || null;
  } catch {
    title = null;
  }

  titleCache.set(key, { expiresAt: Date.now() + TITLE_CACHE_TTL, title });
  return title;
}

// ---------------------------------------------------------------------------
// Căutare IMDb id pornind de la numele tehnic al unei lansări — folosită
// când torrentul n-a fost descărcat prin site (deci n-avem IMDb id salvat în
// jurnalul propriu). Extrage un titlu + an aproximativ din numele lansării,
// caută pe TMDB, și confirmă rezultatul citind IMDb id-ul lui — dacă TMDB nu
// găsește nimic sigur, întoarce null (nu ghicim, mai bine sărim peste decât
// să asociem greșit un IMDb id).
// ---------------------------------------------------------------------------

const SEARCH_TAG_CUTOFF =
  /\b(2160p|1080p|720p|480p|WEB-?DL|WEBRip|BluRay|BDRip|BRRip|HDTV|DVDRip|S\d{2}E\d{2}|S\d{2})\b/i;

function parseReleaseTitle(releaseName: string): { query: string; year?: string } {
  const base = releaseName.replace(/\.(mkv|mp4|avi|ts|m2ts|wmv|mov)$/i, "");
  const normalized = base.replace(/[._]/g, " ").replace(/\s+/g, " ").trim();

  const yearMatch = normalized.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch?.index !== undefined) {
    return { query: normalized.slice(0, yearMatch.index).trim(), year: yearMatch[0] };
  }

  const tagMatch = normalized.match(SEARCH_TAG_CUTOFF);
  if (tagMatch?.index !== undefined) {
    return { query: normalized.slice(0, tagMatch.index).trim() };
  }

  return { query: normalized };
}

interface TmdbSearchItem {
  id: number;
  title?: string;
  name?: string;
}
interface TmdbSearchResponse {
  results?: TmdbSearchItem[];
}
interface TmdbMovieDetails {
  imdb_id?: string;
  title?: string;
}
interface TmdbExternalIds {
  imdb_id?: string;
}

interface ImdbSearchResult {
  imdbId: string;
  title: string;
}

const searchCache = new Map<string, { expiresAt: number; value: ImdbSearchResult | null }>();

// Fail-soft: null la orice eroare sau lipsă rezultat — apelantul rămâne fără
// IMDb id (cade pe numele tehnic al lansării, fără căutare pe OpenSubtitles).
export async function searchImdbIdByReleaseName(
  releaseName: string,
  mediaType?: "movie" | "tv",
): Promise<ImdbSearchResult | null> {
  const { query, year } = parseReleaseTitle(releaseName);
  if (!query) return null;

  const cacheKey = `${mediaType ?? "any"}|${query.toLowerCase()}|${year ?? ""}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let result: ImdbSearchResult | null = null;
  try {
    const typesToTry: Array<"movie" | "tv"> = mediaType ? [mediaType] : ["movie", "tv"];
    for (const type of typesToTry) {
      const params = new URLSearchParams({ query });
      if (year) params.set(type === "movie" ? "year" : "first_air_date_year", year);

      const search = await tmdbFetch<TmdbSearchResponse>(`/search/${type}?${params.toString()}`);
      const top = search.results?.[0];
      if (!top) continue;

      if (type === "movie") {
        const details = await tmdbFetch<TmdbMovieDetails>(`/movie/${top.id}`);
        if (details.imdb_id) {
          result = { imdbId: details.imdb_id, title: details.title || top.title || query };
          break;
        }
      } else {
        const ext = await tmdbFetch<TmdbExternalIds>(`/tv/${top.id}/external_ids`);
        if (ext.imdb_id) {
          result = { imdbId: ext.imdb_id, title: top.name || query };
          break;
        }
      }
    }
  } catch {
    result = null;
  }

  searchCache.set(cacheKey, { expiresAt: Date.now() + TITLE_CACHE_TTL, value: result });
  return result;
}
