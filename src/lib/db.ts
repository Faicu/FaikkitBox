// Bază de date SQLite (node:sqlite, nativ), un singur fișier: data/faikkitbox.db

import { DatabaseSync } from "node:sqlite";
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
      created_at TEXT NOT NULL,
      -- display_mode separă PWA-ul de browser (pe Android au același user-agent).
      user_agent TEXT,
      display_mode TEXT,
      last_seen_at TEXT
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
      grandparent_title TEXT,
      rating_key TEXT,
      -- 'trailer' / 'extra' la clipurile Plex (title-label.ts), altfel NULL.
      clip TEXT,
      -- Verificări la rând în care sesiunea a lipsit (vezi trackPlexSessions).
      missed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS error_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      stack TEXT,
      level TEXT NOT NULL DEFAULT 'error',
      count INTEGER NOT NULL DEFAULT 1,
      last_seen TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_error_log_timestamp ON error_log(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_error_log_group ON error_log(source, level, message);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'pending',
      plex_account_id INTEGER,
      plex_username TEXT,
      plex_email TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT,
      session_version INTEGER NOT NULL DEFAULT 0,
      contribution_exempt INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS user_logins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      logged_in_at TEXT NOT NULL DEFAULT (datetime('now')),
      ip TEXT,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_user_logins_user ON user_logins(user_id, logged_in_at DESC);

    -- Sursă unică pentru datele unui titlu (film/serial/episod) — Biblioteca nu
    -- reconstituie prin TMDB ce se știe de la adăugare. 'tv_show' e rândul-părinte
    -- cu metadatele serialului; episoadele țin de el prin parent_id.
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_type TEXT NOT NULL CHECK(media_type IN ('movie','tv_show','episode')),
      parent_id INTEGER REFERENCES media(id) ON DELETE CASCADE,
      imdb_id TEXT,
      tmdb_id INTEGER,
      title TEXT NOT NULL,
      original_title TEXT,
      literal_title TEXT,
      -- Titlul englez, doar când originalul nu e în alfabet latin — atunci se
      -- afișează el sub nume (title-label.ts).
      english_title TEXT,
      year INTEGER,
      season INTEGER,
      episode INTEGER,
      overview_ro TEXT,
      genres TEXT NOT NULL DEFAULT '[]',
      poster_path TEXT,
      tv_status TEXT,
      plex_rating_key TEXT,
      plex_added_at INTEGER,
      torrent_name TEXT,
      torrent_hash TEXT,
      -- ID-ul torrentului pe Filelist (details.php?id=…); lipsește pe rândurile vechi.
      filelist_id INTEGER,
      category INTEGER,
      category_name TEXT,
      size INTEGER NOT NULL DEFAULT 0,
      freeleech INTEGER NOT NULL DEFAULT 0,
      internal INTEGER NOT NULL DEFAULT 0,
      save_path TEXT,
      is_season_pack INTEGER NOT NULL DEFAULT 0,
      added_via TEXT,
      requested_by_user_id INTEGER,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      has_romanian_subtitle INTEGER NOT NULL DEFAULT 0,
      has_romanian_audio INTEGER NOT NULL DEFAULT 0,
      subtitle_source TEXT,
      subtitle_detail TEXT,
      subtitle_checked_at TEXT,
      -- 1 = subtitrare „aproximativă”, reverificată zilnic 14 zile (subtitle-retry.ts).
      subtitle_approximate INTEGER NOT NULL DEFAULT 0,
      -- Raportul ultimei verificări de subtitrare pentru ACEST rând (JSON:
      -- varianta aleasă și cele respinse), pentru drawer-ul din Bibliotecă.
      subtitle_report TEXT,
      -- Ștergere programată — hit and run pe Filelist, vezi scheduled-delete.ts.
      -- Pe toate rândurile torrentului. requested_at = cererea; scheduled_at =
      -- termenul (SQLite, UTC), NULL cât torrentul încă se descarcă.
      delete_requested_at TEXT,
      delete_scheduled_at TEXT,
      delete_scheduled_by INTEGER,
      quality TEXT,
      duration_ms INTEGER,
      -- Titlul episodului (pe episoade, title ține titlul serialului), completat
      -- din TMDB de syncEpisodeDetails — Biblioteca rămâne doar SELECT-uri.
      episode_title TEXT,
      -- Descrierea și cadrul episodului (overview_ro e, pe episoade, a serialului,
      -- iar poster_path e posterul sezonului). Tot de syncEpisodeDetails.
      episode_overview TEXT,
      episode_still TEXT,
      -- Data difuzării (TMDB); year e, pe episoade, anul premierei serialului.
      episode_air_date TEXT,
      -- Urmărirea episoadelor noi — doar pe rândul 'tv_show', unic per serial și
      -- legat deja de episoade. Nu într-o tabelă paralelă: prima implementare
      -- așa era, și de acolo veneau toate bug-urile ei.
      auto_download INTEGER NOT NULL DEFAULT 0,
      auto_download_quality TEXT,
      -- Poziția de la care se descarcă ('S03E05') — activarea nu trage tot
      -- istoricul unui serial.
      auto_download_from TEXT,
      watch_last_checked_at TEXT,
      -- Calitatea de rezervă (fallback-quality.ts). NULL = fără.
      auto_download_fallback_quality TEXT,
      -- JSON { țintă: momentul ISO al primei găsiri DOAR a rezervei } — pe rând,
      -- ca așteptarea să supraviețuiască unei reporniri.
      watch_fallback_seen TEXT,
      -- Rezultatul ultimei verificări („niciun torrent 1080p · lipsă S10E15”),
      -- afișat în Watcher.
      watch_last_result TEXT,
      -- Metadate de serial reîmprospătate din TMDB (refreshShowMetadata):
      -- tv_status decide dacă apare butonul de urmărire.
      next_episode TEXT,
      -- Data de la TMDB (fără oră) și instantul exact de la TVmaze — separat,
      -- fiindcă airstamp lipsește des, iar data tot o vrem.
      next_episode_air_date TEXT,
      next_episode_airstamp TEXT,
      -- Ultimul episod difuzat — fereastra orară a urmăririi și în ziua de DUPĂ
      -- lansare, când TMDB a mutat deja next_episode.
      last_episode_air_date TEXT,
      meta_refreshed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_media_imdb ON media(imdb_id);
    CREATE INDEX IF NOT EXISTS idx_media_parent ON media(parent_id);
    CREATE INDEX IF NOT EXISTS idx_media_torrent_hash ON media(torrent_hash) WHERE torrent_hash IS NOT NULL;
    -- Unicitate DOAR pentru episoade (resolveSeasonPackPlexLinks se bazează pe
    -- ea ca să nu dubleze episoade). Un film poate avea mai multe versiuni sub
    -- același ratingKey Plex — cu index unic, a doua nu se lega niciodată.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_media_plex_key_episode ON media(plex_rating_key)
      WHERE plex_rating_key IS NOT NULL AND media_type = 'episode';
    -- Nesortat/neunic, pentru căutările după ratingKey (activity-log, legare).
    CREATE INDEX IF NOT EXISTS idx_media_plex_key ON media(plex_rating_key) WHERE plex_rating_key IS NOT NULL;

    CREATE TABLE IF NOT EXISTS recent_watch_cache (
      plex_rating_key TEXT NOT NULL,
      username TEXT NOT NULL,
      title TEXT NOT NULL,
      show TEXT,
      season INTEGER,
      episode INTEGER,
      poster_path TEXT,
      viewed_at INTEGER NOT NULL,
      view_offset_ms INTEGER,
      duration_ms INTEGER,
      completed INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (plex_rating_key, username)
    );
    CREATE INDEX IF NOT EXISTS idx_recent_watch_cache_viewed_at ON recent_watch_cache(viewed_at DESC);

    -- Rularea curentă (id = 1): clean_shutdown = 0 la pornire înseamnă că
    -- rularea anterioară s-a terminat brutal (SIGKILL, OOM, curent), iar
    -- last_heartbeat dă momentul aproximativ.
    CREATE TABLE IF NOT EXISTS server_runtime (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      started_at TEXT NOT NULL,
      last_heartbeat TEXT NOT NULL,
      clean_shutdown INTEGER NOT NULL DEFAULT 0,
      pid INTEGER
    );

    -- Încărcările Immich (immich-uploads): checked_until = până unde s-a
    -- verificat; pending = încărcările încă în desfășurare, scrise în jurnal
    -- când nu mai apare nimic nou.
    -- Acțiunile pe servicii (service-jobs.ts), în fundal — pagina doar citește
    -- starea, deci o cerere tăiată sau un tab închis nu pierde rezultatul.
    CREATE TABLE IF NOT EXISTS service_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      exit_code INTEGER,
      output TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_service_jobs_service ON service_jobs(service, id DESC);

    -- Ultima verificare a actualizărilor — în DB, fiindcă un timer de 24h s-ar
    -- reseta la fiecare repornire.
    CREATE TABLE IF NOT EXISTS update_check (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      checked_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS immich_upload_tracker (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      checked_until TEXT NOT NULL,
      pending TEXT NOT NULL DEFAULT '{}'
    );

    -- Starea sarcinilor Watcher-ului. next_run_at (ms) rămâne peste un deploy;
    -- pauza și „Rulează acum” vin din Tehnic, citite de tact la fiecare secundă
    -- (plugin-ul și server functions rulează în copii separate ale modulelor).
    -- running_since setat la pornire = rulare întreruptă de restart.
    CREATE TABLE IF NOT EXISTS watcher_tasks (
      id TEXT PRIMARY KEY,
      next_run_at INTEGER,
      paused INTEGER NOT NULL DEFAULT 0,
      run_requested_at INTEGER,
      running_since INTEGER,
      running_manual INTEGER NOT NULL DEFAULT 0,
      last_finished_at INTEGER,
      last_duration_ms INTEGER,
      last_ok INTEGER,
      last_error TEXT
    );

    -- Istoricul rulărilor: ultimele 20 per sarcină care au făcut ceva, au
    -- eșuat sau au fost manuale.
    CREATE TABLE IF NOT EXISTS watcher_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      ok INTEGER NOT NULL,
      manual INTEGER NOT NULL DEFAULT 0,
      summary TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_watcher_runs_task ON watcher_runs(task_id, id DESC);

    -- Contribuțiile lunare: o plată declarată de utilizator (pending →
    -- confirmată/respinsă) sau adăugată de admin. Sume în lei întregi.
    CREATE TABLE IF NOT EXISTS contribution_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      months_count INTEGER NOT NULL,
      per_month INTEGER NOT NULL,
      total INTEGER NOT NULL,
      method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      note TEXT,
      declared_at TEXT NOT NULL DEFAULT (datetime('now')),
      decided_at TEXT,
      decided_by TEXT,
      added_by_admin INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_contribution_payments_user
      ON contribution_payments(user_id, declared_at DESC);

    -- Lunile acoperite de fiecare plată; ale unei plăți respinse se șterg, ca
    -- luna să redevină neplătită. UNIQUE: o lună, o singură plată.
    CREATE TABLE IF NOT EXISTS contribution_months (
      payment_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      amount INTEGER NOT NULL,
      UNIQUE (user_id, month)
    );
    CREATE INDEX IF NOT EXISTS idx_contribution_months_month ON contribution_months(month);

    -- Ținta lunară: valabilă de la luna din rând înainte, până la următorul rând.
    -- Fără niciun rând, ținta e DEFAULT_TARGET (250 lei).
    CREATE TABLE IF NOT EXISTS contribution_targets (
      month TEXT PRIMARY KEY,
      target INTEGER NOT NULL
    );

    -- Pragul „utilizator activ" (DEFAULT_ACTIVITY din months.ts când lipsește
    -- rândul): cine trece de el vede cardul de plată evidențiat pe Acasă.
    CREATE TABLE IF NOT EXISTS contribution_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      min_movies INTEGER NOT NULL,
      min_episodes INTEGER NOT NULL,
      window_days INTEGER NOT NULL
    );

    -- HDR-ul unui dispozitiv Plex (clientIdentifier): modelul, ultima redare
    -- directă a unui fișier HDR și confirmarea manuală (1/0/NULL).
    CREATE TABLE IF NOT EXISTS device_hdr (
      client_id TEXT PRIMARY KEY,
      model TEXT,
      product TEXT,
      hdr_direct_at INTEGER,
      user_answer INTEGER,
      answered_by_user_id INTEGER,
      answered_at INTEGER
    );
  `);

  // Curățări one-time, versionate cu PRAGMA user_version
  runCleanups(db);

  return db;
}

function runCleanups(database: DatabaseSync): void {
  // Migrările rulează într-o tranzacție (unele fac CREATE → INSERT → DROP →
  // RENAME), iar eșecul e fatal intenționat: înainte, o migrare picată era
  // doar un warn, iar aplicația pornea cu schemă parțială.
  database.exec("BEGIN");
  try {
    applyCleanups(database);
    database.exec("COMMIT");
  } catch (e) {
    database.exec("ROLLBACK");
    console.error("[db] Migrare eșuată — pornirea e oprită:", e);
    throw e;
  }
}

// Versiunea curentă a schemei. O bază nouă primește direct schema de mai sus;
// migrările v1–v52 au fost scoase pe 3 nov 2026, după ce producția și toate
// backup-urile trecuseră de ele (sunt în istoricul git al fișierului).
const SCHEMA_VERSION = 55;

function applyCleanups(database: DatabaseSync): void {
  const row = database.prepare("PRAGMA user_version").get() as { user_version: number };
  const version = row?.user_version ?? 0;

  if (version === 0) {
    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    return;
  }
  if (version < 52) {
    throw new Error(
      `Baza e la v${version}, iar migrările de dinainte de v52 au fost scoase — ` +
        "rulează-le dintr-o versiune mai veche a db.ts (git log src/lib/db.ts).",
    );
  }

  if (version < 53) {
    // v53: one_time_jobs scoasă — ultimul job (redetect-qualities-1080p-hdr)
    // a rulat pe 17 sept 2026, iar codul care o citea nu mai există.
    database.exec("DROP TABLE IF EXISTS one_time_jobs");
    console.log("[db] Migrare v53: tabela one_time_jobs eliminată");
    database.exec("PRAGMA user_version = 53");
  }

  if (version < 54) {
    // v54: media.english_title. Reîmprospătarea metadatelor o completează;
    // marcajul șters ca să treacă acum prin toate titlurile, nu peste 12h.
    database.exec("ALTER TABLE media ADD COLUMN english_title TEXT");
    database.exec(
      "UPDATE media SET meta_refreshed_at = NULL WHERE media_type IN ('movie', 'tv_show')",
    );
    console.log("[db] Migrare v54: coloana media.english_title");
    database.exec("PRAGMA user_version = 54");
  }

  if (version < 55) {
    database.exec("ALTER TABLE plex_active_sessions ADD COLUMN clip TEXT");
    console.log("[db] Migrare v55: plex_active_sessions.clip");
    database.exec("PRAGMA user_version = 55");
  }
}
