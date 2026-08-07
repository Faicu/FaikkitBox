// ---------------------------------------------------------------------------
// Bază de date SQLite proprie pentru portalul Plex (clienți), separată de
// faikkitbox.db. Pattern identic cu /opt/faikkitbox/src/lib/db.ts.
// ---------------------------------------------------------------------------

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

function dbPath(): string {
  return process.env.PLEX_DB_PATH ?? "/opt/faikkitbox/plex/data/plex.db";
}

let db: DatabaseSync | null = null;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export function getPlexDb(): DatabaseSync {
  if (db) return db;

  const file = dbPath();
  mkdirSync(dirname(file), { recursive: true });

  db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT NOT NULL,
      whatsapp TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'client',
      status TEXT NOT NULL DEFAULT 'pending',
      blocked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      approved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS media_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      tmdb_id INTEGER NOT NULL,
      imdb_id TEXT,
      media_type TEXT NOT NULL,
      title TEXT NOT NULL,
      season INTEGER,
      quality TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS media_ownership (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      tmdb_id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      title TEXT NOT NULL,
      season INTEGER,
      is_owner INTEGER NOT NULL DEFAULT 0,
      added_at TEXT NOT NULL,
      UNIQUE(user_id, tmdb_id, media_type, season)
    );

    CREATE TABLE IF NOT EXISTS media_qualities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ownership_id INTEGER NOT NULL REFERENCES media_ownership(id),
      quality TEXT NOT NULL,
      subtitle_source TEXT,
      torrent_name TEXT,
      torrent_hash TEXT,
      added_at TEXT NOT NULL,
      UNIQUE(ownership_id, quality)
    );

    CREATE TABLE IF NOT EXISTS alert_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      min_seeders INTEGER NOT NULL DEFAULT 3,
      ambiguous_seeders_pct REAL NOT NULL DEFAULT 0.2,
      max_titles_per_user INTEGER NOT NULL DEFAULT 10,
      default_quality TEXT NOT NULL DEFAULT '1080p',
      default_season_mode TEXT NOT NULL DEFAULT 'season',
      library_sync_interval_min INTEGER NOT NULL DEFAULT 60,
      push_enabled INTEGER NOT NULL DEFAULT 1,
      require_approval INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS user_push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, endpoint)
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      tmdb_id INTEGER,
      title TEXT,
      detail TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);

    CREATE TABLE IF NOT EXISTS admin_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_request_id INTEGER NOT NULL REFERENCES media_requests(id),
      reason TEXT NOT NULL,
      options_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      resolution TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS error_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      source TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'error',
      message TEXT NOT NULL,
      stack TEXT,
      count INTEGER NOT NULL DEFAULT 1,
      last_seen TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_plex_error_log_ts ON error_log(timestamp DESC);
  `);

  seedAdmin(db);
  migrateColumns(db);

  return db;
}

// Migrări incrementale simple pentru coloane adăugate după prima rulare —
// ALTER TABLE ADD COLUMN nu are IF NOT EXISTS în SQLite, deci verificăm
// pragma table_info înainte de a adăuga.
function migrateColumns(database: DatabaseSync): void {
  const qualityCols = database.prepare("PRAGMA table_info(media_qualities)").all() as Array<{
    name: string;
  }>;
  if (!qualityCols.some((c) => c.name === "torrent_hash")) {
    database.exec("ALTER TABLE media_qualities ADD COLUMN torrent_hash TEXT");
  }

  // plex_username/plex_email — contul Plex real care s-a potrivit la
  // înregistrare (match pe username SAU email introdus de user contra
  // plex.tv/api/v2/user + /friends). Necesare pentru a lega corect userul din
  // portal de sesiunile/istoricul Plex (ex. "cine a vizionat", "cine redă
  // acum") — nu putem presupune că username-ul din portal e identic cu cel
  // din Plex, userul poate fi găsit doar prin email.
  const userCols = database.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (!userCols.some((c) => c.name === "plex_username")) {
    database.exec("ALTER TABLE users ADD COLUMN plex_username TEXT");
  }
  if (!userCols.some((c) => c.name === "plex_email")) {
    database.exec("ALTER TABLE users ADD COLUMN plex_email TEXT");
  }
}

function seedAdmin(database: DatabaseSync): void {
  const row = database.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!row) {
    database
      .prepare(
        `INSERT INTO users (username, password_hash, email, whatsapp, role, status, created_at, approved_at)
         VALUES (?, ?, ?, ?, 'admin', 'approved', datetime('now'), datetime('now'))`,
      )
      .run("Faicu", hashPassword("Faikkit9!"), "faicuro@gmail.com", "-");
    console.log("[plex-db] Cont admin 'Faicu' creat (seed inițial).");
  }

  const settingsRow = database.prepare("SELECT id FROM alert_settings WHERE id = 1").get();
  if (!settingsRow) {
    database.prepare("INSERT INTO alert_settings (id) VALUES (1)").run();
  }
}

export function getAlertSettings() {
  const db = getPlexDb();
  return db.prepare("SELECT * FROM alert_settings WHERE id = 1").get() as {
    id: number;
    min_seeders: number;
    ambiguous_seeders_pct: number;
    max_titles_per_user: number;
    default_quality: string;
    default_season_mode: string;
    library_sync_interval_min: number;
    push_enabled: number;
    require_approval: number;
  };
}

export function updateAlertSettings(patch: Partial<{
  min_seeders: number;
  ambiguous_seeders_pct: number;
  max_titles_per_user: number;
  default_quality: string;
  default_season_mode: string;
  library_sync_interval_min: number;
  push_enabled: number;
  require_approval: number;
}>): void {
  const db = getPlexDb();
  const allowed = [
    "min_seeders",
    "ambiguous_seeders_pct",
    "max_titles_per_user",
    "default_quality",
    "default_season_mode",
    "library_sync_interval_min",
    "push_enabled",
    "require_approval",
  ] as const;
  const entries = Object.entries(patch).filter(([k]) => (allowed as readonly string[]).includes(k));
  if (entries.length === 0) return;
  const setClause = entries.map(([k]) => `${k} = ?`).join(", ");
  const values = entries.map(([, v]) => v);
  db.prepare(`UPDATE alert_settings SET ${setClause} WHERE id = 1`).run(...values);
}

export function logActivity(entry: {
  userId?: number | null;
  action: string;
  tmdbId?: number | null;
  title?: string | null;
  detail?: string | null;
}): void {
  const db = getPlexDb();
  db.prepare(
    `INSERT INTO activity_log (user_id, action, tmdb_id, title, detail, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    entry.userId ?? null,
    entry.action,
    entry.tmdbId ?? null,
    entry.title ?? null,
    entry.detail ?? null,
  );
}
