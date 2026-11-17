// ---------------------------------------------------------------------------
// „Vizionări recente” și statisticile de sub ele (Acasă). Sursa e
// `recent_watch_cache`, păstrat fără limită de timp și completat din tot
// istoricul Plex, inclusiv titlurile șterse.
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";
import { isGenericEpisodeName } from "../media/title-label";
import type { RecentWatch, RecentWatchStats, RecentWatchTotals } from "./recent-watch-types";
import { mergeConsecutiveEpisodes } from "./recent-watch-merge";

const RECENT_WATCH_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const RECENT_TITLES_LIMIT = 200;
// Cheia rândurilor din istoricul Plex fără ratingKey: titlurile șterse îl pierd.
const HISTORY_KEY_PREFIX = "h:";

// Până unde e copiat istoricul Plex în cache, în procesul ăsta. La pornire 0:
// o trecere completă, apoi doar intrările noi.
let historySyncedUpTo = 0;

async function syncRecentWatchCache(db: import("node:sqlite").DatabaseSync): Promise<void> {
  const rows = db
    .prepare(
      `SELECT plex_rating_key, media_type, title, original_title, season, episode, poster_path
       FROM media
       WHERE media_type IN ('movie', 'episode')
         AND plex_rating_key IS NOT NULL
       ORDER BY added_at DESC
       LIMIT ?`,
    )
    .all(RECENT_TITLES_LIMIT) as unknown as Array<{
    plex_rating_key: string | null;
    media_type: string;
    title: string;
    original_title: string | null;
    season: number | null;
    episode: number | null;
    poster_path: string | null;
  }>;

  const { getAllPlexWatchedIndexes, getWatchedAt, getAllPlexHistoryEntries } =
    await import("./plex");
  const { createRecentWatchUpserter } = await import("./recent-watch-cache");
  const upsert = createRecentWatchUpserter(db);

  // Întâi titlurile din `media`, potrivite și după titlu (ratingKey-ul se
  // schimbă la redescărcare), ca numele și posterul lor să câștige mai jos.
  if (rows.length > 0) {
    const allWatchedIndexes = await getAllPlexWatchedIndexes();
    for (const row of rows) {
      const isEpisode = row.media_type === "episode";
      const titleForMatch = row.original_title || row.title;
      for (const [username, index] of Object.entries(allWatchedIndexes)) {
        const viewedAt = getWatchedAt(index, {
          ratingKey: row.plex_rating_key,
          title: titleForMatch,
          show: isEpisode ? titleForMatch : null,
          season: row.season,
          episode: row.episode,
        });
        if (viewedAt == null) continue;
        upsert({
          ratingKey: row.plex_rating_key!,
          username,
          title: isEpisode ? "" : row.title,
          show: isEpisode ? row.title : null,
          season: row.season,
          episode: row.episode,
          posterPath: row.poster_path,
          viewedAt,
          viewOffsetMs: null,
          durationMs: null,
          completed: true,
        });
      }
    }
  }

  // Apoi restul istoricului Plex. O zi de rezervă: o intrare poate apărea în
  // istoric cu ora începutului.
  const since = historySyncedUpTo - 86_400;
  const entries = (await getAllPlexHistoryEntries()).filter(
    (e) => e.viewedAt > since && (e.type === "movie" || e.type === "episode") && e.user,
  );
  if (entries.length === 0) return;

  const mediaByKey = new Map(
    (
      db
        .prepare(
          `SELECT plex_rating_key, title, poster_path FROM media
           WHERE plex_rating_key IS NOT NULL AND media_type IN ('movie', 'episode')`,
        )
        .all() as unknown as Array<{
        plex_rating_key: string;
        title: string;
        poster_path: string | null;
      }>
    ).map((m) => [m.plex_rating_key, m]),
  );
  // Un titlu șters apare în istoric fără ratingKey, dar rândul lui poate fi
  // deja în cache sub cheia veche, cu ora opririi (minute după cea din Plex)
  // și alt titlu (originalul în loc de cel românesc) — deci după oră și
  // episod, nu după titlu.
  const alreadyCached = db.prepare(
    `SELECT 1 FROM recent_watch_cache
     WHERE username = ? AND plex_rating_key NOT LIKE '${HISTORY_KEY_PREFIX}%'
       AND ((? IS NULL AND season IS NULL AND abs(viewed_at - ?) < 1200)
         OR (season = ? AND episode = ? AND abs(viewed_at - ?) < 21600))
     LIMIT 1`,
  );

  let maxViewedAt = historySyncedUpTo;
  db.exec("BEGIN");
  try {
    // Rândurile fără ratingKey vin doar de aici — la prima trecere se refac
    // de la zero, ca o regulă de potrivire schimbată să se aplice și lor.
    if (historySyncedUpTo === 0) {
      db.prepare(`DELETE FROM recent_watch_cache WHERE plex_rating_key LIKE ?`).run(
        `${HISTORY_KEY_PREFIX}%`,
      );
    }
    for (const e of entries) {
      maxViewedAt = Math.max(maxViewedAt, e.viewedAt);
      const isEpisode = e.type === "episode";
      let key = e.ratingKey;
      if (!key) {
        if (!e.historyId) continue;
        const season = e.season ?? null;
        const episode = e.episode ?? null;
        if (alreadyCached.get(e.user!, season, e.viewedAt, season, episode, e.viewedAt) != null) {
          continue;
        }
        key = HISTORY_KEY_PREFIX + e.historyId;
      }
      const m = mediaByKey.get(key);
      upsert({
        ratingKey: key,
        username: e.user!,
        // La episoade, numele episodului din Plex — rezervă pentru cele fără rând în `media`.
        title: isEpisode ? e.title : (m?.title ?? e.title),
        show: isEpisode ? (m?.title ?? e.show ?? null) : null,
        season: e.season ?? null,
        episode: e.episode ?? null,
        posterPath: m?.poster_path ?? null,
        viewedAt: e.viewedAt,
        viewOffsetMs: null,
        durationMs: null,
        completed: true,
      });
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  historySyncedUpTo = maxViewedAt;
}

export const getRecentWatches = createServerFn({ method: "GET" })
  // Fără `data` din taburile deschise înainte de paginare.
  .validator((data?: { limit?: number }) => ({ limit: data?.limit ?? 10 }))
  .handler(
    async ({
      data,
    }): Promise<
      | { status: "ok"; items: RecentWatch[]; totalCards: number; totals: RecentWatchTotals }
      | { status: "error"; error: string }
    > => {
      await (await import("../auth/admin.server")).requireAuth();
      try {
        const { getDb } = await import("../db");
        const db = getDb();
        await syncRecentWatchCache(db);

        const { plexThumbUrl } = await import("./recent-watch-cache");
        const { countInLastDays } = await import("./recent-watch-stats");
        const nowSec = Math.floor(Date.now() / 1000);

        const totalsRow = db
          .prepare(`SELECT COUNT(*) AS total, MIN(viewed_at) AS since FROM recent_watch_cache`)
          .get() as { total: number; since: number | null };
        // O zi în plus față de fereastră; countInLastDays taie la miezul nopții.
        const recentTimes = (
          db
            .prepare("SELECT viewed_at FROM recent_watch_cache WHERE viewed_at >= ?")
            .all(nowSec - RECENT_WATCH_WINDOW_SECONDS - 86_400) as unknown as Array<{
            viewed_at: number;
          }>
        ).map((r) => r.viewed_at);

        // Tot istoricul: unirea episoadelor consecutive trebuie făcută înainte
        // de tăiere, altfel un maraton s-ar rupe la marginea paginii.
        const cached = db
          .prepare(
            `SELECT plex_rating_key, username, title, show, season, episode, poster_path, viewed_at,
                    view_offset_ms, duration_ms, completed
             FROM recent_watch_cache
             ORDER BY viewed_at DESC`,
          )
          .all() as unknown as Array<{
          plex_rating_key: string;
          username: string;
          title: string;
          show: string | null;
          season: number | null;
          episode: number | null;
          poster_path: string | null;
          viewed_at: number;
          view_offset_ms: number | null;
          duration_ms: number | null;
          completed: number;
        }>;

        const items: RecentWatch[] = cached.map((row) => ({
          ratingKey: row.plex_rating_key,
          // La episoade, numele vine din `media`, după tăiere; intervalele
          // unite îl pierd în mergeConsecutiveEpisodes.
          title: row.title,
          show: row.show,
          season: row.season,
          episode: row.episode,
          episodeEnd: null,
          completed: !!row.completed,
          progressMinutes:
            !row.completed && row.view_offset_ms != null
              ? Math.round(row.view_offset_ms / 60_000)
              : null,
          durationMinutes:
            !row.completed && row.duration_ms != null ? Math.round(row.duration_ms / 60_000) : null,
          // Trailerele n-au rând în `media` — miniatura din Plex, prin proxy-ul
          // autentificat. Titlurile șterse din Plex n-au nici atât.
          thumbUrl:
            row.poster_path ??
            (row.plex_rating_key.startsWith(HISTORY_KEY_PREFIX)
              ? null
              : plexThumbUrl(row.plex_rating_key)),
          username: row.username,
          viewedAt: row.viewed_at,
        }));
        const merged = mergeConsecutiveEpisodes(items);
        merged.sort((a, b) => b.viewedAt - a.viewedAt);
        const page = merged.slice(0, Math.max(1, data.limit));

        const episodeTitle = db.prepare(
          `SELECT episode_title FROM media
           WHERE plex_rating_key = ? AND media_type = 'episode' LIMIT 1`,
        );
        for (const it of page) {
          if (!it.show) continue;
          if (it.episodeEnd != null) {
            it.title = "";
            continue;
          }
          const fromMedia = (episodeTitle.get(it.ratingKey) as { episode_title: string | null })
            ?.episode_title;
          const name = fromMedia ?? it.title;
          it.title = isGenericEpisodeName(name) ? "" : name;
        }

        return {
          status: "ok",
          items: page,
          totalCards: merged.length,
          totals: {
            all: totalsRow.total,
            last30Days: countInLastDays(recentTimes, nowSec, 30),
            since: totalsRow.since,
          },
        };
      } catch (e) {
        return { status: "error", error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

// Statisticile de sub „Vizionări recente”: fiecare episod e o vizionare.
export const getWatchStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<
    { status: "ok"; stats: RecentWatchStats } | { status: "error"; error: string }
  > => {
    await (await import("../auth/admin.server")).requireAuth();
    try {
      const { getDb } = await import("../db");
      const { computeWatchStats } = await import("./recent-watch-stats");
      // Fereastra cea mai lungă e de 12 luni; 400 de zile o acoperă.
      const from = Math.floor(Date.now() / 1000) - 400 * 86_400;
      const rows = getDb()
        .prepare("SELECT viewed_at, username FROM recent_watch_cache WHERE viewed_at >= ?")
        .all(from) as unknown as Array<{ viewed_at: number; username: string }>;
      return { status: "ok", stats: computeWatchStats(rows, Math.floor(Date.now() / 1000)) };
    } catch (e) {
      return { status: "error", error: e instanceof Error ? e.message : String(e) };
    }
  },
);
