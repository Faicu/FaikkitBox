// ---------------------------------------------------------------------------
// Bază de date SQLite (node:sqlite — nativ în Node 22.5+, zero dependențe)
// Un singur fișier: /opt/faikkitbox/data/faikkitbox.db
// ---------------------------------------------------------------------------

import { DatabaseSync } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

function dbPath(): string {
  return process.env.FAIKKITBOX_DB_PATH ?? "/opt/faikkitbox/data/faikkitbox.db";
}

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;

  const file = dbPath();
  mkdirSync(dirname(file), { recursive: true });

  db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");

  // Schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      meta TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity(timestamp DESC);

    CREATE TABLE IF NOT EXISTS downloads (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      category INTEGER NOT NULL DEFAULT 0,
      category_name TEXT NOT NULL DEFAULT '',
      freeleech INTEGER NOT NULL DEFAULT 0,
      internal INTEGER NOT NULL DEFAULT 0,
      save_path TEXT NOT NULL DEFAULT '',
      downloaded_at TEXT NOT NULL,
      completed_at TEXT,
      torrent_hash TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_downloads_downloaded_at ON downloads(downloaded_at DESC);

    CREATE TABLE IF NOT EXISTS commits (
      sha TEXT PRIMARY KEY,
      short_sha TEXT NOT NULL,
      message TEXT NOT NULL,
      author TEXT NOT NULL,
      date TEXT NOT NULL,
      url TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_commits_date ON commits(date DESC);

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS speedtest_history (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      download REAL NOT NULL,
      upload REAL NOT NULL,
      ping REAL NOT NULL,
      jitter REAL,
      isp TEXT,
      server_name TEXT,
      result_url TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_speedtest_ts ON speedtest_history(timestamp DESC);

    CREATE TABLE IF NOT EXISTS pinned_items (
      id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      title TEXT NOT NULL,
      original_title TEXT NOT NULL,
      poster_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id, media_type)
    );

    CREATE TABLE IF NOT EXISTS plex_active_sessions (
      key TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      last_view_offset_ms INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      user TEXT NOT NULL,
      title TEXT NOT NULL,
      grandparent_title TEXT
    );

    CREATE TABLE IF NOT EXISTS pinned_watch_settings (
      id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      watch_filelist INTEGER NOT NULL DEFAULT 0,
      watch_tmdb INTEGER NOT NULL DEFAULT 0,
      watch_filelist_season INTEGER NOT NULL DEFAULT 0,
      auto_download INTEGER NOT NULL DEFAULT 0,
      auto_download_quality TEXT NOT NULL DEFAULT '1080p',
      PRIMARY KEY (id, media_type)
    );

    CREATE TABLE IF NOT EXISTS pinned_watch_state (
      id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      last_checked_at TEXT,
      seen_torrent_ids TEXT NOT NULL DEFAULT '[]',
      last_aired_key TEXT,
      PRIMARY KEY (id, media_type)
    );

    CREATE TABLE IF NOT EXISTS error_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      stack TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_error_log_timestamp ON error_log(timestamp DESC);
  `);

  // Curățări one-time, versionate cu PRAGMA user_version
  runCleanups(db);

  return db;
}

function runCleanups(database: DatabaseSync): void {
  try {
    const row = database.prepare("PRAGMA user_version").get() as { user_version: number };
    const version = row?.user_version ?? 0;

    if (version < 1) {
      // v1: elimină duplicatele server_start (păstrează unul per minut)
      const result = database
        .prepare(
          `
        DELETE FROM activity
        WHERE type = 'server_start'
          AND id NOT IN (
            SELECT MIN(id) FROM activity
            WHERE type = 'server_start'
            GROUP BY substr(timestamp, 1, 16)
          )
      `,
        )
        .run();
      console.log(`[db] Curățare v1: eliminate ${result.changes} duplicate server_start`);
      database.exec("PRAGMA user_version = 1");
    }

    if (version < 2) {
      // v2: adaugă coloana watch_filelist_season la pinned_watch_settings (dacă nu există)
      try {
        database.exec(
          "ALTER TABLE pinned_watch_settings ADD COLUMN watch_filelist_season INTEGER NOT NULL DEFAULT 0",
        );
        console.log("[db] Migrare v2: adăugat watch_filelist_season");
      } catch {
        // coloana există deja — ignorăm
      }
      database.exec("PRAGMA user_version = 2");
    }

    if (version < 3) {
      try {
        database.exec(
          "ALTER TABLE pinned_watch_settings ADD COLUMN auto_download INTEGER NOT NULL DEFAULT 0",
        );
        console.log("[db] Migrare v3: adăugat auto_download");
      } catch {
        // coloana există deja dintr-o rulare anterioară
      }
      try {
        database.exec(
          "ALTER TABLE pinned_watch_settings ADD COLUMN auto_download_quality TEXT NOT NULL DEFAULT '1080p'",
        );
        console.log("[db] Migrare v3: adăugat auto_download_quality");
      } catch {
        // coloana există deja dintr-o rulare anterioară
      }
      database.exec("PRAGMA user_version = 3");
    }

    if (version < 4) {
      // v4: error_log capătă grupare (count/last_seen) și nivel (warn/error)
      try {
        database.exec("ALTER TABLE error_log ADD COLUMN level TEXT NOT NULL DEFAULT 'error'");
        console.log("[db] Migrare v4: adăugat error_log.level");
      } catch {
        // coloana există deja dintr-o rulare anterioară
      }
      try {
        database.exec("ALTER TABLE error_log ADD COLUMN count INTEGER NOT NULL DEFAULT 1");
        console.log("[db] Migrare v4: adăugat error_log.count");
      } catch {
        // coloana există deja dintr-o rulare anterioară
      }
      try {
        database.exec("ALTER TABLE error_log ADD COLUMN last_seen TEXT");
        database.exec("UPDATE error_log SET last_seen = timestamp WHERE last_seen IS NULL");
        console.log("[db] Migrare v4: adăugat error_log.last_seen");
      } catch {
        // coloana există deja dintr-o rulare anterioară
      }
      try {
        database.exec(
          "CREATE INDEX IF NOT EXISTS idx_error_log_group ON error_log(source, level, message)",
        );
      } catch {
        // există deja
      }
      database.exec("PRAGMA user_version = 4");
    }

    if (version < 5) {
      // v5: downloads capătă coloana imdb — folosită pentru potrivirea
      // subtitrărilor OpenSubtitles la finalul descărcării
      try {
        database.exec("ALTER TABLE downloads ADD COLUMN imdb TEXT");
        console.log("[db] Migrare v5: adăugat downloads.imdb");
      } catch {
        // coloana există deja dintr-o rulare anterioară
      }
      database.exec("PRAGMA user_version = 5");
    }

    if (version < 6) {
      // v6: elimină watch_plex (pinned_watch_settings) și plex_episode_keys/
      // plex_movie_found (pinned_watch_state) — funcția "apariție în Plex" a
      // fost eliminată din aplicație (scenariu inexistent în fluxul real de
      // lucru, tot ce ajunge în Plex trece deja prin Filelist).
      try {
        database.exec("ALTER TABLE pinned_watch_settings DROP COLUMN watch_plex");
        console.log("[db] Migrare v6: eliminat pinned_watch_settings.watch_plex");
      } catch {
        // coloana nu există (deja eliminată sau tabel nou)
      }
      try {
        database.exec("ALTER TABLE pinned_watch_state DROP COLUMN plex_episode_keys");
        console.log("[db] Migrare v6: eliminat pinned_watch_state.plex_episode_keys");
      } catch {
        // coloana nu există
      }
      try {
        database.exec("ALTER TABLE pinned_watch_state DROP COLUMN plex_movie_found");
        console.log("[db] Migrare v6: eliminat pinned_watch_state.plex_movie_found");
      } catch {
        // coloana nu există
      }
      database.exec("PRAGMA user_version = 6");
    }
  } catch (e) {
    console.warn("[db] Curățare eșuată:", e);
  }
}
