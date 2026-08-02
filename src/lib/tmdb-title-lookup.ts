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
