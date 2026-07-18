import { createServerFn } from "@tanstack/react-start";
import { getDb } from "./db";

export interface PinnedItemDb {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  originalTitle: string;
  posterUrl: string | null;
}

export const getPinnedItems = createServerFn({ method: "GET" })
  .handler(async (): Promise<PinnedItemDb[]> => {
    const db = getDb();
    const rows = db
      .prepare("SELECT id, media_type, title, original_title, poster_url FROM pinned_items ORDER BY sort_order ASC, added_at ASC")
      .all() as Array<{ id: number; media_type: string; title: string; original_title: string; poster_url: string | null }>;
    return rows.map((r) => ({
      id: r.id,
      mediaType: r.media_type as "movie" | "tv",
      title: r.title,
      originalTitle: r.original_title,
      posterUrl: r.poster_url,
    }));
  });

export interface WatchSettings {
  id: number;
  mediaType: "movie" | "tv";
  watchFilelist: boolean;
  watchFilelistSeason: boolean;
  watchTmdb: boolean;
  watchPlex: boolean;
}

export const getWatchSettings = createServerFn({ method: "GET" })
  .handler(async (): Promise<WatchSettings[]> => {
    const db = getDb();
    const rows = db
      .prepare("SELECT id, media_type, watch_filelist, watch_filelist_season, watch_tmdb, watch_plex FROM pinned_watch_settings")
      .all() as Array<{ id: number; media_type: string; watch_filelist: number; watch_filelist_season: number; watch_tmdb: number; watch_plex: number }>;
    return rows.map((r) => ({
      id: r.id,
      mediaType: r.media_type as "movie" | "tv",
      watchFilelist: !!r.watch_filelist,
      watchFilelistSeason: !!r.watch_filelist_season,
      watchTmdb: !!r.watch_tmdb,
      watchPlex: !!r.watch_plex,
    }));
  });

export const setWatchSettings = createServerFn({ method: "POST" })
  .validator((data: { id: number; mediaType: "movie" | "tv"; watchFilelist: boolean; watchFilelistSeason: boolean; watchTmdb: boolean; watchPlex: boolean }) => data)
  .handler(async ({ data }): Promise<void> => {
    const db = getDb();
    db.prepare(
      `INSERT INTO pinned_watch_settings (id, media_type, watch_filelist, watch_filelist_season, watch_tmdb, watch_plex) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id, media_type) DO UPDATE SET
         watch_filelist = excluded.watch_filelist,
         watch_filelist_season = excluded.watch_filelist_season,
         watch_tmdb = excluded.watch_tmdb,
         watch_plex = excluded.watch_plex`
    ).run(data.id, data.mediaType, data.watchFilelist ? 1 : 0, data.watchFilelistSeason ? 1 : 0, data.watchTmdb ? 1 : 0, data.watchPlex ? 1 : 0);
    const anyEnabled = data.watchFilelist || data.watchTmdb || data.watchPlex;
    if (!anyEnabled) {
      db.prepare("DELETE FROM pinned_watch_state WHERE id = ? AND media_type = ?").run(data.id, data.mediaType);
    }
  });

export const setPinnedItems = createServerFn({ method: "POST" })
  .validator((data: { items: PinnedItemDb[] }) => data)
  .handler(async ({ data }): Promise<void> => {
    const db = getDb();
    db.prepare("DELETE FROM pinned_items").run();
    const stmt = db.prepare(
      `INSERT INTO pinned_items (id, media_type, title, original_title, poster_url, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    data.items.forEach((item, i) => {
      stmt.run(item.id, item.mediaType, item.title, item.originalTitle, item.posterUrl ?? null, i);
    });
    // Curăță setările/starea de watch pentru itemele care nu mai sunt fixate
    db.prepare(
      `DELETE FROM pinned_watch_settings WHERE NOT EXISTS (
         SELECT 1 FROM pinned_items pi WHERE pi.id = pinned_watch_settings.id AND pi.media_type = pinned_watch_settings.media_type
       )`
    ).run();
    db.prepare(
      `DELETE FROM pinned_watch_state WHERE NOT EXISTS (
         SELECT 1 FROM pinned_items pi WHERE pi.id = pinned_watch_state.id AND pi.media_type = pinned_watch_state.media_type
       )`
    ).run();
  });
