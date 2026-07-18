// ---------------------------------------------------------------------------
// Bază de date SQLite (node:sqlite — nativ în Node 22.5+, zero dependențe)
// Un singur fișier: /opt/faikkitbox/data/faikkitbox.db
// Migrare automată din fișierele JSON vechi la prima pornire.
// ---------------------------------------------------------------------------

import { DatabaseSync } from "node:sqlite";
import { readFile, mkdir, rename } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
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

    CREATE TABLE IF NOT EXISTS plex_active_sessions (
      key TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      last_view_offset_ms INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      user TEXT NOT NULL,
      title TEXT NOT NULL,
      grandparent_title TEXT
    );
  `);

  // Migrare din JSON (o singură dată, la prima pornire cu SQLite)
  migrateFromJson(db).catch((e) => console.warn("[db] Migrare JSON eșuată:", e));

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
  } catch (e) {
    console.warn("[db] Curățare eșuată:", e);
  }
}

async function migrateFromJson(database: DatabaseSync): Promise<void> {
  // Activity log
  const activityJson = process.env.ACTIVITY_LOG_PATH ?? "/opt/faikkitbox/data/activity-log.json";
  if (existsSync(activityJson)) {
    try {
      const raw = await readFile(activityJson, "utf8");
      const entries = JSON.parse(raw) as Array<{
        id: string;
        timestamp: string;
        type: string;
        message: string;
        meta?: unknown;
      }>;
      const insert = database.prepare(
        "INSERT OR IGNORE INTO activity (id, timestamp, type, message, meta) VALUES (?, ?, ?, ?, ?)",
      );
      let count = 0;
      for (const e of entries) {
        insert.run(e.id, e.timestamp, e.type, e.message, e.meta ? JSON.stringify(e.meta) : null);
        count++;
      }
      await rename(activityJson, activityJson + ".migrated");
      console.log(`[db] Migrat ${count} intrări activity din JSON → SQLite`);
    } catch (e) {
      console.warn("[db] Migrare activity-log.json eșuată:", e);
    }
  }

  // Filelist downloads
  const downloadsJson =
    process.env.FILELIST_LOG_PATH ?? "/opt/faikkitbox/data/filelist-downloads.json";
  if (existsSync(downloadsJson)) {
    try {
      const raw = await readFile(downloadsJson, "utf8");
      const entries = JSON.parse(raw) as Array<{
        id: number;
        name: string;
        size: number;
        category: number;
        categoryName: string;
        freeleech: boolean;
        internal: boolean;
        savePath: string;
        downloadedAt: string;
        completedAt: string | null;
        torrentHash?: string;
      }>;
      const insert = database.prepare(
        `INSERT OR IGNORE INTO downloads
         (id, name, size, category, category_name, freeleech, internal, save_path, downloaded_at, completed_at, torrent_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      let count = 0;
      for (const e of entries) {
        insert.run(
          e.id,
          e.name,
          e.size ?? 0,
          e.category ?? 0,
          e.categoryName ?? "",
          e.freeleech ? 1 : 0,
          e.internal ? 1 : 0,
          e.savePath ?? "",
          e.downloadedAt,
          e.completedAt ?? null,
          e.torrentHash ?? null,
        );
        count++;
      }
      await rename(downloadsJson, downloadsJson + ".migrated");
      console.log(`[db] Migrat ${count} intrări downloads din JSON → SQLite`);
    } catch (e) {
      console.warn("[db] Migrare filelist-downloads.json eșuată:", e);
    }
  }
}
