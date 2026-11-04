// Numele unei vizionări Plex, din `media` după ratingKey — același în jurnal,
// pe cardul „în redare” și în „Vizionate azi”. Trailerele și extra-urile n-au
// rând în `media` (ratingKey-ul lor e al clipului): rămân cu numele din Plex.

import { getDb } from "../db";
import { clipKindOf, type ClipKind } from "./title-label";

export interface WatchInput {
  ratingKey?: string | null;
  type?: string | null;
  subtype?: string | null;
  // Numele din Plex; `show` = grandparentTitle.
  title: string;
  show?: string | null;
  season?: number | null;
  episode?: number | null;
}

export interface WatchResolved {
  clip: ClipKind | null;
  show: string | null;
  title: string;
  year: number | null;
  season: number | null;
  episode: number | null;
}

export function resolveWatches(items: WatchInput[]): WatchResolved[] {
  const stmt = getDb().prepare(
    `SELECT media_type, title, episode_title, year, season, episode FROM media
      WHERE plex_rating_key = ? AND media_type IN ('movie', 'episode') LIMIT 1`,
  );
  const cache = new Map<string, Record<string, unknown> | undefined>();
  return items.map((w) => {
    const clip = clipKindOf(w.type, w.subtype);
    const raw: WatchResolved = {
      clip,
      show: w.show ?? null,
      title: w.title,
      year: null,
      season: w.season ?? null,
      episode: w.episode ?? null,
    };
    if (clip || !w.ratingKey) return raw;
    if (!cache.has(w.ratingKey))
      cache.set(w.ratingKey, stmt.get(w.ratingKey) as Record<string, unknown> | undefined);
    const row = cache.get(w.ratingKey);
    if (!row) return raw;
    if (row.media_type === "movie")
      return { ...raw, show: null, title: String(row.title), year: row.year as number | null };
    return {
      ...raw,
      show: String(row.title),
      title: String(row.episode_title || w.title),
      season: row.season as number | null,
      episode: row.episode as number | null,
    };
  });
}

export const resolveWatch = (w: WatchInput): WatchResolved => resolveWatches([w])[0];
