import type { DatabaseSync } from "node:sqlite";

// Scrie/actualizează o intrare din `recent_watch_cache` — sursa unică pentru
// widgetul "Vizionări recente" de pe Acasă. Există doi scriitori posibili
// pentru același rând (plex_rating_key, username): plex-browse.ts (confirmă
// vizionarea completă din istoricul Plex) și activity-log.ts (progres
// parțial, la oprirea unei sesiuni) — logica de conflict e comună aici ca să
// nu diverge între ele.
//
// O vizionare completă (completed=1) câștigă mereu în fața uneia parțiale,
// indiferent de ordinea în care ajung scrierile (istoricul Plex poate avea
// un viewedAt mai vechi decât momentul la care am detectat noi oprirea
// sesiunii, din cauza intervalului de polling) — altfel rândul ar putea
// rămâne blocat la "X/Y min" deși titlul a fost de fapt terminat.
export interface RecentWatchCacheEntry {
  ratingKey: string;
  username: string;
  title: string;
  show: string | null;
  season: number | null;
  episode: number | null;
  posterPath: string | null;
  viewedAt: number;
  viewOffsetMs: number | null;
  durationMs: number | null;
  completed: boolean;
}

export function createRecentWatchUpserter(
  db: DatabaseSync,
): (entry: RecentWatchCacheEntry) => void {
  const stmt = db.prepare(
    `INSERT INTO recent_watch_cache
       (plex_rating_key, username, title, show, season, episode, poster_path, viewed_at, view_offset_ms, duration_ms, completed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (plex_rating_key, username) DO UPDATE SET
       title = excluded.title, show = excluded.show, season = excluded.season,
       episode = excluded.episode, poster_path = excluded.poster_path,
       viewed_at = max(excluded.viewed_at, recent_watch_cache.viewed_at),
       view_offset_ms = excluded.view_offset_ms, duration_ms = excluded.duration_ms,
       completed = excluded.completed
     WHERE excluded.completed > recent_watch_cache.completed
        OR (excluded.completed = recent_watch_cache.completed AND excluded.viewed_at > recent_watch_cache.viewed_at)`,
  );
  return (entry: RecentWatchCacheEntry) => {
    stmt.run(
      entry.ratingKey,
      entry.username,
      entry.title,
      entry.show,
      entry.season,
      entry.episode,
      entry.posterPath,
      entry.viewedAt,
      entry.viewOffsetMs,
      entry.durationMs,
      entry.completed ? 1 : 0,
    );
  };
}
