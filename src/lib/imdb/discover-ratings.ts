// ---------------------------------------------------------------------------
// Atașează rating-ul IMDb titlurilor din Descoperă. Titlurile TMDB nu vin cu
// IMDb id, deci îl aflăm din /external_ids (o cerere per titlu, ținută în
// cache: legătura TMDB → IMDb nu se schimbă practic niciodată). Top Filelist
// are deja IMDb id-ul din torrent și sare peste pasul ăsta.
//
// Server-only — importat dinamic din handler-ele server fn.
// ---------------------------------------------------------------------------

import { tmdbFetch } from "../tmdb/tmdb-client";
import type { DiscoverMediaType, DiscoverTitle } from "../tmdb/tmdb.discover.functions";
import { getImdbRatings } from "./imdb-ratings";

const FOUND_TTL = 7 * 24 * 60 * 60 * 1000;
// Un titlu fără IMDb id pe TMDB (des la cele foarte noi) îl poate primi
// curând — reîntrebăm după câteva ore.
const MISSING_TTL = 6 * 60 * 60 * 1000;

const imdbIdCache = new Map<string, { expiresAt: number; value: string | null }>();

async function tmdbImdbId(mediaType: DiscoverMediaType, id: number): Promise<string | null> {
  const key = `${mediaType}-${id}`;
  const cached = imdbIdCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const json = await tmdbFetch<{ imdb_id?: string | null }>(`/${mediaType}/${id}/external_ids`);
    const value = json.imdb_id?.trim() || null;
    imdbIdCache.set(key, { expiresAt: Date.now() + (value ? FOUND_TTL : MISSING_TTL), value });
    return value;
  } catch {
    // Eroare de rețea: fără cache, se reîncearcă la următoarea pagină.
    return null;
  }
}

// Completează imdbRating/imdbVotes pe loc. `imdbIdOf` dă id-ul când e deja
// cunoscut (Top Filelist); altfel e cerut de la TMDB.
export async function attachImdbRatings<T extends DiscoverTitle>(
  items: T[],
  imdbIdOf?: (item: T) => string | null,
): Promise<T[]> {
  const ids = await Promise.all(
    items.map((item) => (imdbIdOf ? imdbIdOf(item) : tmdbImdbId(item.mediaType, item.id))),
  );
  const ratings = getImdbRatings(ids.filter((i): i is string => i !== null));
  items.forEach((item, i) => {
    const r = ids[i] ? ratings.get(ids[i] as string) : undefined;
    item.imdbRating = r?.rating ?? null;
    item.imdbVotes = r?.votes ?? null;
  });
  return items;
}
