import { createServerFn } from "@tanstack/react-start";
import { getDb } from "./db";

// Sursă unică pentru treptele de calitate — folosită la descărcare (wizard,
// carduri fixate) și la auto-download (watch settings, pinned-watcher).
export type WatchQuality = "720p" | "1080p" | "4K" | "4K HDR";

export interface PinnedItemDb {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  originalTitle: string;
  posterUrl: string | null;
}

export const getPinnedItems = createServerFn({ method: "GET" }).handler(
  async (): Promise<PinnedItemDb[]> => {
    const { requireAuth } = await import("./admin.server");
    const session = await requireAuth();
    const db = getDb();
    const rows = db
      .prepare(
        "SELECT id, media_type, title, original_title, poster_url FROM pinned_items WHERE user_id = ? ORDER BY sort_order ASC, added_at ASC",
      )
      .all(session.data.userId!) as Array<{
      id: number;
      media_type: string;
      title: string;
      original_title: string;
      poster_url: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      mediaType: r.media_type as "movie" | "tv",
      title: r.title,
      originalTitle: r.original_title,
      posterUrl: r.poster_url,
    }));
  },
);

export interface WatchSettings {
  id: number;
  mediaType: "movie" | "tv";
  watchFilelist: boolean;
  watchFilelistSeason: boolean;
  watchTmdb: boolean;
  autoDownload: boolean;
  autoDownloadQuality: WatchQuality;
}

export const getWatchSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<WatchSettings[]> => {
    const { requireAuth } = await import("./admin.server");
    await requireAuth();
    const db = getDb();
    const rows = db
      .prepare(
        "SELECT id, media_type, watch_filelist, watch_filelist_season, watch_tmdb, auto_download, auto_download_quality FROM pinned_watch_settings",
      )
      .all() as Array<{
      id: number;
      media_type: string;
      watch_filelist: number;
      watch_filelist_season: number;
      watch_tmdb: number;
      auto_download: number;
      auto_download_quality: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      mediaType: r.media_type as "movie" | "tv",
      watchFilelist: !!r.watch_filelist,
      watchFilelistSeason: !!r.watch_filelist_season,
      watchTmdb: !!r.watch_tmdb,
      autoDownload: !!r.auto_download,
      autoDownloadQuality: (r.auto_download_quality || "1080p") as WatchQuality,
    }));
  },
);

export const setWatchSettings = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id: number;
      mediaType: "movie" | "tv";
      watchFilelist: boolean;
      watchFilelistSeason: boolean;
      watchTmdb: boolean;
      autoDownload: boolean;
      autoDownloadQuality: string;
    }) => data,
  )
  .handler(async ({ data }): Promise<void> => {
    const { requireAuth } = await import("./admin.server");
    await requireAuth();
    const db = getDb();
    db.prepare(
      `INSERT INTO pinned_watch_settings (id, media_type, watch_filelist, watch_filelist_season, watch_tmdb, auto_download, auto_download_quality) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id, media_type) DO UPDATE SET
         watch_filelist = excluded.watch_filelist,
         watch_filelist_season = excluded.watch_filelist_season,
         watch_tmdb = excluded.watch_tmdb,
         auto_download = excluded.auto_download,
         auto_download_quality = excluded.auto_download_quality`,
    ).run(
      data.id,
      data.mediaType,
      data.watchFilelist ? 1 : 0,
      data.watchFilelistSeason ? 1 : 0,
      data.watchTmdb ? 1 : 0,
      data.autoDownload ? 1 : 0,
      data.autoDownloadQuality,
    );
    const anyEnabled = data.watchFilelist || data.watchTmdb;
    if (!anyEnabled) {
      db.prepare("DELETE FROM pinned_watch_state WHERE id = ? AND media_type = ?").run(
        data.id,
        data.mediaType,
      );
    }
  });

export const setPinnedItems = createServerFn({ method: "POST" })
  .validator((data: { items: PinnedItemDb[] }) => data)
  .handler(async ({ data }): Promise<void> => {
    const { requireAuth } = await import("./admin.server");
    const session = await requireAuth();
    const userId = session.data.userId!;
    const db = getDb();
    // Păstrăm added_at-ul original al fiecărei fixări existente — altfel,
    // fiindcă rescriem toată lista (delete + insert) la fiecare fixare nouă,
    // toate titlurile deja fixate ar primi added_at = acum, arătând ca fixate
    // chiar în acel moment (vezi Utilizatori > Titluri urmărite).
    const existingAddedAt = new Map(
      (
        db
          .prepare("SELECT id, media_type, added_at FROM pinned_items WHERE user_id = ?")
          .all(userId) as Array<{ id: number; media_type: string; added_at: string }>
      ).map((r) => [`${r.media_type}-${r.id}`, r.added_at]),
    );
    db.prepare("DELETE FROM pinned_items WHERE user_id = ?").run(userId);
    const stmt = db.prepare(
      `INSERT INTO pinned_items (user_id, id, media_type, title, original_title, poster_url, sort_order, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
    );
    data.items.forEach((item, i) => {
      stmt.run(
        userId,
        item.id,
        item.mediaType,
        item.title,
        item.originalTitle,
        item.posterUrl ?? null,
        i,
        existingAddedAt.get(`${item.mediaType}-${item.id}`) ?? null,
      );
    });
    // Curăță setările/starea de watch pentru itemele pe care NIMENI nu le
    // mai are fixate (watch settings sunt globale per titlu, nu per user).
    db.prepare(
      `DELETE FROM pinned_watch_settings WHERE NOT EXISTS (
         SELECT 1 FROM pinned_items pi WHERE pi.id = pinned_watch_settings.id AND pi.media_type = pinned_watch_settings.media_type
       )`,
    ).run();
    db.prepare(
      `DELETE FROM pinned_watch_state WHERE NOT EXISTS (
         SELECT 1 FROM pinned_items pi WHERE pi.id = pinned_watch_state.id AND pi.media_type = pinned_watch_state.media_type
       )`,
    ).run();
  });

// Scoate fixarea unui titlu pentru TOȚI utilizatorii, nu doar pentru cel
// curent — spre deosebire de setPinnedItems (user_id = ?), care gestionează
// doar propria listă. Necesar pentru toggle-ul de fixare din Bibliotecă:
// vizibilitatea unui titlu "doar fixat" în Bibliotecă e o stare comună
// (EXISTS pe pinned_items, indiferent de user — vezi getPlexLibraryBrowse),
// deci scoaterea trebuie să fie la fel de comună, altfel titlul rămâne
// vizibil pentru că altcineva încă îl are fixat (bug real, întâlnit direct:
// userul a scos fixarea, dar titlul a rămas în Bibliotecă fiindcă era fixat
// de alt cont).
export const unpinTitleEverywhere = createServerFn({ method: "POST" })
  .validator((data: { id: number; mediaType: "movie" | "tv" }) => data)
  .handler(async ({ data }): Promise<void> => {
    const { requireAuth } = await import("./admin.server");
    await requireAuth();
    const db = getDb();
    db.prepare("DELETE FROM pinned_items WHERE id = ? AND media_type = ?").run(
      data.id,
      data.mediaType,
    );
    db.prepare("DELETE FROM pinned_watch_settings WHERE id = ? AND media_type = ?").run(
      data.id,
      data.mediaType,
    );
    db.prepare("DELETE FROM pinned_watch_state WHERE id = ? AND media_type = ?").run(
      data.id,
      data.mediaType,
    );
  });

export const getPinnedWatcherStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin.server");
  await requireAdmin();
  const { getDb } = await import("./db");
  const db = getDb();

  const lastRow = db
    .prepare("SELECT MAX(last_checked_at) as last_run FROM pinned_watch_state")
    .get() as { last_run: string | null };
  const lastRun = lastRow?.last_run ?? null;

  // pinned-watcher verifică fiecare item la propria lui cadență de 3 ore
  // (vezi pinned-watcher.ts), nu pe toate simultan — deci "următoarea
  // rulare" reală e cea mai apropiată, adică primul item care devine
  // eligibil (MIN, nu MAX), și doar dintre itemele efectiv urmărite.
  const nextRow = db
    .prepare(
      `SELECT MIN(pws.last_checked_at) as earliest
       FROM pinned_watch_state pws
       JOIN pinned_watch_settings pw ON pw.id = pws.id AND pw.media_type = pws.media_type
       WHERE (pw.watch_filelist = 1 OR pw.watch_tmdb = 1)
         AND pws.last_checked_at IS NOT NULL`,
    )
    .get() as { earliest: string | null };
  const ITEM_INTERVAL_MS = 3 * 60 * 60 * 1000;
  const nextRun = nextRow?.earliest
    ? new Date(new Date(nextRow.earliest).getTime() + ITEM_INTERVAL_MS).toISOString()
    : null;

  return { lastRun, nextRun };
});

export const triggerPinnedWatcherCheck = createServerFn({ method: "POST" }).handler(async () => {
  const { requireAdmin } = await import("./admin.server");
  await requireAdmin();
  setTimeout(async () => {
    const { checkAll } = await import("../../server/plugins/pinned-watcher");
    await checkAll(true).catch((e) => console.warn("[trigger] checkAll eșuat:", e));
  }, 10_000);
  return { ok: true };
});
