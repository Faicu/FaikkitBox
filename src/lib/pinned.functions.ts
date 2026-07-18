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
  });
