// Titlurile din Descoperă care sunt deja în bibliotecă primesc numele din
// `media` — acolo poate fi titlul alternativ românesc, pe care listele TMDB
// nu-l au.

import { getDb } from "../db";
import { secondaryTitle } from "../media/title-label";
import type { DiscoverTitle } from "./tmdb.discover.functions";

export function applyLibraryTitles<T extends DiscoverTitle>(items: T[]): T[] {
  if (items.length === 0) return items;
  const ids = [...new Set(items.map((i) => i.id))];
  const rows = getDb()
    .prepare(
      `SELECT media_type, tmdb_id, title, original_title, english_title FROM media
        WHERE parent_id IS NULL AND media_type IN ('movie', 'tv_show')
          AND tmdb_id IN (${ids.map(() => "?").join(", ")})`,
    )
    .all(...ids) as Array<{
    media_type: string;
    tmdb_id: number;
    title: string;
    original_title: string | null;
    english_title: string | null;
  }>;
  const byKey = new Map(
    rows.map((r) => [`${r.media_type === "movie" ? "movie" : "tv"}:${r.tmdb_id}`, r]),
  );
  return items.map((item) => {
    const r = byKey.get(`${item.mediaType}:${item.id}`);
    if (!r) return item;
    return {
      ...item,
      title: r.title,
      secondaryTitle: secondaryTitle(r.title, r.original_title, r.english_title),
    };
  });
}
