// Bază de date SQLite (node:sqlite, nativ), un singur fișier: data/faikkitbox.db

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { hashPassword } from "./auth/password";

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
      grandparent_title TEXT,
      rating_key TEXT,
      -- Verificări la rând în care sesiunea a lipsit (vezi trackPlexSessions).
      missed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS error_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      stack TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_error_log_timestamp ON error_log(timestamp DESC);

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
      -- ID-ul torrentului pe Filelist (details.php?id=…), doar de la v36 încolo.
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
      -- legat deja de episoade. Prima implementare ținea urmărirea într-o tabelă
      -- paralelă (pinned_items, ștearsă în v14), sursa tuturor bug-urilor ei.
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
    -- Joburi de rulat o singură dată care fac cereri de rețea (deci nu pot sta
    -- într-o migrare); marcajul se scrie după reușită.
    CREATE TABLE IF NOT EXISTS one_time_jobs (
      name TEXT PRIMARY KEY,
      done_at TEXT NOT NULL
    );

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

function applyCleanups(database: DatabaseSync): void {
  {
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
      // v6: scoate „apariția în Plex” din urmărirea veche (scenariu inexistent).
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

    if (version < 7) {
      // v7: conturile de admin trec din variabile de mediu în DB; contul din env
      // e migrat automat la prima rulare, ca nimeni să nu rămână blocat.
      try {
        database.exec(`
          CREATE TABLE IF NOT EXISTS admin_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `);
        const count = database.prepare("SELECT COUNT(*) as c FROM admin_users").get() as {
          c: number;
        };
        const envUser = process.env.ADMIN_USER;
        const envPass = process.env.ADMIN_PASS;
        if (count.c === 0 && envUser && envPass) {
          database
            .prepare("INSERT INTO admin_users (username, password_hash) VALUES (?, ?)")
            .run(envUser, hashPassword(envPass));
          console.log(`[db] Migrare v7: cont admin migrat din .env → DB ("${envUser}")`);
        }
      } catch (e) {
        console.warn("[db] Migrare v7 eșuată:", e);
      }
      database.exec("PRAGMA user_version = 7");
    }

    if (version < 8) {
      // v8: admin_users → users (role + status), pentru conturi publice cu
      // aprobare; adminii existenți devin approved.
      try {
        database.exec(
          `INSERT INTO users (username, password_hash, role, status, created_at)
           SELECT username, password_hash, 'admin', 'approved', created_at FROM admin_users
           WHERE username NOT IN (SELECT username FROM users)`,
        );
        database.exec("DROP TABLE IF EXISTS admin_users");
        console.log("[db] Migrare v8: admin_users → users (role=admin, status=approved)");
      } catch (e) {
        console.warn("[db] Migrare v8 eșuată:", e);
      }
      database.exec("PRAGMA user_version = 8");
    }

    if (version < 9) {
      // v9: pinned_items per utilizator (urmărirea veche).
      try {
        const cols = database.prepare("PRAGMA table_info(pinned_items)").all() as Array<{
          name: string;
        }>;
        // Pe o bază nouă pinned_items nu există (v14) — fără verificare, v9
        // lăsa în urmă tabela orfană pinned_items_new.
        const hasUserId = cols.some((c) => c.name === "user_id");
        if (cols.length > 0 && !hasUserId) {
          const admin = database
            .prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1")
            .get() as { id: number } | undefined;

          database.exec(`
            CREATE TABLE pinned_items_new (
              user_id INTEGER NOT NULL,
              id INTEGER NOT NULL,
              media_type TEXT NOT NULL,
              title TEXT NOT NULL,
              original_title TEXT NOT NULL,
              poster_url TEXT,
              sort_order INTEGER NOT NULL DEFAULT 0,
              added_at TEXT NOT NULL DEFAULT (datetime('now')),
              PRIMARY KEY (user_id, id, media_type)
            );
          `);
          if (admin) {
            database
              .prepare(
                `INSERT INTO pinned_items_new (user_id, id, media_type, title, original_title, poster_url, sort_order, added_at)
                 SELECT ?, id, media_type, title, original_title, poster_url, sort_order, added_at FROM pinned_items`,
              )
              .run(admin.id);
          }
          database.exec("DROP TABLE pinned_items");
          database.exec("ALTER TABLE pinned_items_new RENAME TO pinned_items");
          console.log(
            `[db] Migrare v9: pinned_items devine per-utilizator (fixările existente → admin id=${admin?.id ?? "necunoscut"})`,
          );
        }
      } catch (e) {
        console.warn("[db] Migrare v9 eșuată:", e);
      }
      database.exec("PRAGMA user_version = 9");
    }

    if (version < 10) {
      // v10: istoricul autentificărilor per cont.
      try {
        database.exec("ALTER TABLE users ADD COLUMN last_login_at TEXT");
        console.log("[db] Migrare v10: adăugat users.last_login_at");
      } catch {
        // coloana există deja dintr-o rulare anterioară
      }
      // user_logins e creată deja de blocul de schemă de mai sus (rulează la
      // fiecare pornire, indiferent de versiune) — nimic de migrat aici.
      database.exec("PRAGMA user_version = 10");
    }

    if (version < 11) {
      // v11: descărcările atribuite contului care le-a pornit (doar de acum).
      try {
        database.exec("ALTER TABLE downloads ADD COLUMN requested_by_user_id INTEGER");
        console.log("[db] Migrare v11: adăugat downloads.requested_by_user_id");
      } catch {
        // coloana există deja dintr-o rulare anterioară
      }
      database.exec("PRAGMA user_version = 11");
    }

    if (version < 12) {
      // v12: plex_added_at — data reală a indexării Plex, pentru ordinea din
      // Bibliotecă.
      try {
        database.exec("ALTER TABLE media ADD COLUMN plex_added_at INTEGER");
        console.log("[db] Migrare v12: adăugat media.plex_added_at");
      } catch {
        // coloana există deja dintr-o rulare anterioară
      }
      database.exec("PRAGMA user_version = 12");
    }

    if (version < 13) {
      // v13: torrent_hash nu mai e UNIQUE — un pachet are mai multe rânduri.
      try {
        database.exec("DROP INDEX IF EXISTS idx_media_torrent_hash");
        database.exec(
          "CREATE INDEX IF NOT EXISTS idx_media_torrent_hash ON media(torrent_hash) WHERE torrent_hash IS NOT NULL",
        );
        console.log("[db] Migrare v13: torrent_hash nu mai e UNIQUE în media");
      } catch {
        // deja migrat
      }
      database.exec("PRAGMA user_version = 13");
    }

    if (version < 14) {
      // v14: scoate complet urmărirea veche (pinned_*).
      database.exec("DROP TABLE IF EXISTS pinned_items");
      database.exec("DROP TABLE IF EXISTS pinned_watch_settings");
      database.exec("DROP TABLE IF EXISTS pinned_watch_state");
      console.log(
        "[db] Migrare v14: eliminate tabelele pinned_items/pinned_watch_settings/pinned_watch_state",
      );
      database.exec("PRAGMA user_version = 14");
    }

    if (version < 15) {
      try {
        database.exec("ALTER TABLE media ADD COLUMN has_romanian_audio INTEGER NOT NULL DEFAULT 0");
        console.log("[db] Migrare v15: adăugat media.has_romanian_audio");
      } catch {
        // coloana există deja dintr-o rulare anterioară
      }
      database.exec("PRAGMA user_version = 15");
    }

    if (version < 16) {
      // v16: progresul în recent_watch_cache, pentru vizionările neterminate.
      try {
        database.exec("ALTER TABLE recent_watch_cache ADD COLUMN view_offset_ms INTEGER");
        database.exec("ALTER TABLE recent_watch_cache ADD COLUMN duration_ms INTEGER");
        database.exec(
          "ALTER TABLE recent_watch_cache ADD COLUMN completed INTEGER NOT NULL DEFAULT 1",
        );
        database.exec("ALTER TABLE plex_active_sessions ADD COLUMN rating_key TEXT");
        console.log("[db] Migrare v16: adăugat progres pe recent_watch_cache");
      } catch {
        // coloanele există deja dintr-o rulare anterioară
      }
      database.exec("PRAGMA user_version = 16");
    }

    if (version < 17) {
      // v17: curăță pinned_items_new lăsată de v9 pe bazele mai vechi.
      database.exec("DROP TABLE IF EXISTS pinned_items_new");
      database.exec("PRAGMA user_version = 17");
    }

    if (version < 18) {
      // v18: identitate pentru abonamentele push; `display_mode` separă PWA-ul
      // de browser (pe Android au același user-agent).
      try {
        database.exec("ALTER TABLE push_subscriptions ADD COLUMN user_agent TEXT");
        database.exec("ALTER TABLE push_subscriptions ADD COLUMN display_mode TEXT");
        database.exec("ALTER TABLE push_subscriptions ADD COLUMN last_seen_at TEXT");
        console.log("[db] Migrare v18: push_subscriptions capătă user_agent/display_mode");
      } catch {
        // coloanele există deja dintr-o rulare anterioară
      }
      database.exec("PRAGMA user_version = 18");
    }

    if (version < 19) {
      // v19: urmărirea episoadelor revine, ca coloane pe rândul 'tv_show'.
      for (const sql of [
        "ALTER TABLE media ADD COLUMN auto_download INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE media ADD COLUMN auto_download_quality TEXT",
        "ALTER TABLE media ADD COLUMN auto_download_from TEXT",
        "ALTER TABLE media ADD COLUMN watch_last_checked_at TEXT",
      ]) {
        try {
          database.exec(sql);
        } catch {
          // coloana există deja dintr-o rulare anterioară
        }
      }

      // Seriale fără niciun episod, lăsate de backfill (2 găsite pe 6 sept. 2026).
      const orphans = database
        .prepare(
          `DELETE FROM media
             WHERE media_type = 'tv_show'
               AND torrent_hash IS NULL
               AND id NOT IN (SELECT parent_id FROM media WHERE parent_id IS NOT NULL)`,
        )
        .run();
      if (orphans.changes > 0) {
        console.log(`[db] Migrare v19: eliminate ${orphans.changes} seriale fără episoade`);
      }
      database.exec("PRAGMA user_version = 19");
    }

    if (version < 20) {
      // v20: numele episoadelor (completate de syncEpisodeDetails).
      try {
        database.exec("ALTER TABLE media ADD COLUMN episode_title TEXT");
        console.log("[db] Migrare v20: adăugat media.episode_title");
      } catch {
        // coloana există deja dintr-o rulare anterioară
      }
      database.exec("PRAGMA user_version = 20");
    }

    if (version < 21) {
      // v21: watch_last_checked_at adus la formatul SQLite — ISO-ul ieșea din
      // comparația lexicografică de scadență.
      const fixed = database
        .prepare(
          `UPDATE media
              SET watch_last_checked_at =
                    replace(substr(watch_last_checked_at, 1, 19), 'T', ' ')
            WHERE watch_last_checked_at LIKE '%T%'`,
        )
        .run();
      if (fixed.changes > 0) {
        console.log(`[db] Migrare v21: normalizate ${fixed.changes} watch_last_checked_at`);
      }
      database.exec("PRAGMA user_version = 21");
    }

    if (version < 22) {
      // v22: următorul episod anunțat și reîmprospătarea metadatelor de serial.
      for (const sql of [
        "ALTER TABLE media ADD COLUMN next_episode TEXT",
        "ALTER TABLE media ADD COLUMN next_episode_air_date TEXT",
        "ALTER TABLE media ADD COLUMN next_episode_airstamp TEXT",
        "ALTER TABLE media ADD COLUMN meta_refreshed_at TEXT",
      ]) {
        try {
          database.exec(sql);
        } catch {
          // coloana există deja dintr-o rulare anterioară
        }
      }
      database.exec("PRAGMA user_version = 22");
    }

    if (version < 23) {
      // v23: retenția de 30 de zile a jurnalului (curățarea recurentă e în
      // activity-log.ts).
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const removed = database.prepare("DELETE FROM activity WHERE timestamp < ?").run(cutoff);
      console.log(`[db] Migrare v23: șterse ${removed.changes} evenimente mai vechi de 30 de zile`);
      database.exec("PRAGMA user_version = 23");
    }

    if (version < 24) {
      // v24: „completed_at NULL = chiar se descarcă acum” — backfill-ul din 15
      // aug. lăsase 77 de rânduri fără completed_at, deși erau demult în Plex.
      const fixed = database
        .prepare(
          // plex_added_at e Unix, completed_at text — copierea directă a stricat
          // 53 de rânduri, reparate în v38.
          `UPDATE media SET completed_at = COALESCE(datetime(plex_added_at, 'unixepoch'), added_at)
            WHERE completed_at IS NULL AND plex_rating_key IS NOT NULL`,
        )
        .run();
      if (fixed.changes > 0) {
        console.log(`[db] Migrare v24: ${fixed.changes} rânduri marcate complete (deja în Plex)`);
      }
      database.exec("PRAGMA user_version = 24");
    }

    if (version < 25) {
      // v25: `downloads` dispare — dublura lui `media`, necitită de nimeni.
      database.exec("DROP TABLE IF EXISTS downloads");
      console.log("[db] Migrare v25: tabela downloads eliminată");
      database.exec("PRAGMA user_version = 25");
    }

    if (version < 26) {
      // v26: posterele salvate la w92 (miniaturile din wizard) urcă la w342 —
      // în drawer erau vizibil moi. Sursa e reparată în normalizeStoredPoster.
      for (const table of ["media", "recent_watch_cache"]) {
        const res = database
          .prepare(
            `UPDATE ${table} SET poster_path = replace(poster_path, '/t/p/w92/', '/t/p/w342/')
              WHERE poster_path LIKE '%/t/p/w92/%'`,
          )
          .run();
        if (res.changes > 0) {
          console.log(`[db] Migrare v26: ${res.changes} postere urcate la w342 în ${table}`);
        }
      }
      database.exec("PRAGMA user_version = 26");
    }

    if (version < 27) {
      // v27: indexul unic pe plex_rating_key doar pentru episoade — versiunile
      // unui film au același ratingKey, iar a doua rămânea pe „se procesează”.
      database.exec("DROP INDEX IF EXISTS idx_media_plex_key");
      database.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_media_plex_key_episode ON media(plex_rating_key)
           WHERE plex_rating_key IS NOT NULL AND media_type = 'episode'`,
      );
      database.exec(
        `CREATE INDEX IF NOT EXISTS idx_media_plex_key ON media(plex_rating_key)
           WHERE plex_rating_key IS NOT NULL`,
      );
      console.log("[db] Migrare v27: unicitatea plex_rating_key restrânsă la episoade");
      database.exec("PRAGMA user_version = 27");
    }

    if (version < 28) {
      // v28: plex_added_at doar pe versiunea care a adus-o — altfel un film abia
      // descărcat lua data versiunii vechi și sărea în josul Bibliotecii.
      const res = database
        .prepare(
          `UPDATE media SET plex_added_at = NULL
            WHERE media_type = 'movie'
              AND plex_rating_key IS NOT NULL
              AND id NOT IN (
                SELECT MIN(id) FROM media
                 WHERE media_type = 'movie' AND plex_rating_key IS NOT NULL
                 GROUP BY plex_rating_key
              )`,
        )
        .run();
      if (res.changes > 0) {
        console.log(`[db] Migrare v28: ${res.changes} versiuni suplimentare de film redatate`);
      }
      database.exec("PRAGMA user_version = 28");
    }

    if (version < 29) {
      // v29: outcome-urile de descărcare nu mai pretind sursa
      // (`downloaded_opensubtitles` → `downloaded`, sursa e câmp separat);
      // jurnalul anunța OpenSubtitles peste descărcări de pe subs.ro.
      const renamed = database
        .prepare(
          `UPDATE activity SET meta = REPLACE(meta, 'downloaded_opensubtitles', 'downloaded')
            WHERE type = 'subtitle_fix' AND meta LIKE '%downloaded_opensubtitles%'`,
        )
        .run();
      if (renamed.changes > 0) {
        console.log(`[db] Migrare v29: ${renamed.changes} intrări de jurnal cu outcome redenumit`);
      }

      // Titlurile deja scrise în jurnal, corectate unde detaliul confirmă subs.ro.
      const retitled = database
        .prepare(
          `UPDATE activity
              SET message = REPLACE(message, 'descărcată de pe OpenSubtitles', 'descărcată de pe subs.ro')
            WHERE type = 'subtitle_fix'
              AND message LIKE '%descărcată de pe OpenSubtitles%'
              AND meta LIKE '%de pe subs.ro%'`,
        )
        .run();
      if (retitled.changes > 0) {
        console.log(`[db] Migrare v29: ${retitled.changes} titluri de jurnal corectate la subs.ro`);
      }

      // La fel `media.subtitle_source`, recuperată din `subtitle_detail`.
      const fixed = database
        .prepare(
          `UPDATE media SET subtitle_source = 'subsro'
            WHERE subtitle_source = 'opensubtitles' AND subtitle_detail LIKE '%de pe subs.ro%'`,
        )
        .run();
      if (fixed.changes > 0) {
        console.log(`[db] Migrare v29: ${fixed.changes} titluri cu sursa corectată la subs.ro`);
      }
      database.exec("PRAGMA user_version = 29");
    }

    if (version < 30) {
      // v30: calitatea de rezervă a urmăririi (vezi definiția tabelei).
      for (const sql of [
        "ALTER TABLE media ADD COLUMN auto_download_fallback_quality TEXT",
        "ALTER TABLE media ADD COLUMN watch_fallback_seen TEXT",
      ]) {
        try {
          database.exec(sql);
        } catch {
          // coloana există deja (bază nouă, creată direct cu schema curentă)
        }
      }
      database.exec("PRAGMA user_version = 30");
    }

    if (version < 31) {
      // v31: descrierea și imaginea per episod (vezi definiția tabelei).
      for (const sql of [
        "ALTER TABLE media ADD COLUMN episode_overview TEXT",
        "ALTER TABLE media ADD COLUMN episode_still TEXT",
      ]) {
        try {
          database.exec(sql);
        } catch {
          // coloana există deja (bază nouă, creată direct cu schema curentă)
        }
      }
      // Serialele devin scadente la reîmprospătare, ca episoadele existente să
      // primească detaliile la prima rulare a plugin-ului, nu peste 12 ore.
      database.exec("UPDATE media SET meta_refreshed_at = NULL WHERE media_type = 'tv_show'");
      database.exec("PRAGMA user_version = 31");
    }

    if (version < 32) {
      // v32: cadrele episoadelor la rezoluția originală — w300 era neclar pe
      // lățimea unui telefon. Același fișier TMDB, doar altă mărime în URL.
      database.exec(
        `UPDATE media SET episode_still = REPLACE(episode_still, '/t/p/w300/', '/t/p/original/')
          WHERE episode_still LIKE '%/t/p/w300/%'`,
      );
      database.exec("PRAGMA user_version = 32");
    }

    if (version < 33) {
      // v33: data difuzării per episod (vezi definiția tabelei).
      try {
        database.exec("ALTER TABLE media ADD COLUMN episode_air_date TEXT");
      } catch {
        // coloana există deja (bază nouă, creată direct cu schema curentă)
      }
      // Ca la v31: episoadele existente primesc data la prima rulare a
      // plugin-ului, nu peste 12 ore.
      database.exec("UPDATE media SET meta_refreshed_at = NULL WHERE media_type = 'tv_show'");
      database.exec("PRAGMA user_version = 33");
    }

    if (version < 34) {
      // v34: fără schimbări de schemă (numărul rămâne ocupat).
      database.exec("PRAGMA user_version = 34");
    }

    if (version < 35) {
      // v35: users.session_version — incrementat la resetarea parolei, ca
      // sesiunile emise înainte (cookie semnat, 7 zile) să nu mai fie valide.
      try {
        database.exec("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0");
        console.log("[db] Migrare v35: adăugat users.session_version");
      } catch {
        // coloana există deja (tabel creat cu schema nouă)
      }
      database.exec("PRAGMA user_version = 35");
    }

    if (version < 36) {
      // v36: media.filelist_id, fără completare pentru rândurile existente.
      try {
        database.exec("ALTER TABLE media ADD COLUMN filelist_id INTEGER");
        console.log("[db] Migrare v36: adăugat media.filelist_id");
      } catch {
        // coloana există deja (bază nouă, creată direct cu schema curentă)
      }
      database.exec("PRAGMA user_version = 36");
    }

    if (version < 37) {
      // v37: media.subtitle_approximate, din detaliul existent.
      try {
        database.exec(
          "ALTER TABLE media ADD COLUMN subtitle_approximate INTEGER NOT NULL DEFAULT 0",
        );
        console.log("[db] Migrare v37: adăugat media.subtitle_approximate");
      } catch {
        // coloana există deja (bază nouă, creată direct cu schema curentă)
      }
      database.exec(
        `UPDATE media SET subtitle_approximate = 1
          WHERE has_romanian_subtitle = 1 AND subtitle_detail LIKE 'subtitrare aproximativă%'`,
      );
      database.exec("PRAGMA user_version = 37");
    }

    if (version < 38) {
      // v38: completed_at scris de v24 ca timestamp Unix, adus la data SQLite.
      const fixed = database
        .prepare(
          `UPDATE media SET completed_at = datetime(CAST(completed_at AS INTEGER), 'unixepoch')
            WHERE completed_at GLOB '[0-9]*' AND completed_at NOT GLOB '*[^0-9]*'`,
        )
        .run();
      console.log(
        `[db] Migrare v38: ${fixed.changes} date de finalizare convertite din timestamp Unix`,
      );
      database.exec("PRAGMA user_version = 38");
    }

    if (version < 39) {
      // v39: media.subtitle_report și detaliul pe episod la pachete (fiecare
      // rând păstrează doar bucata lui din agregatul sezonului).
      try {
        database.exec("ALTER TABLE media ADD COLUMN subtitle_report TEXT");
        console.log("[db] Migrare v39: adăugat media.subtitle_report");
      } catch {
        // coloana există deja (bază nouă, creată direct cu schema curentă)
      }
      const rows = database
        .prepare(
          `SELECT id, season, episode, subtitle_detail FROM media
            WHERE media_type = 'episode' AND subtitle_source = 'season_aggregate'
              AND season IS NOT NULL AND episode IS NOT NULL AND subtitle_detail IS NOT NULL`,
        )
        .all() as unknown as Array<{
        id: number;
        season: number;
        episode: number;
        subtitle_detail: string;
      }>;
      const update = database.prepare(
        "UPDATE media SET subtitle_detail = ?, subtitle_source = ? WHERE id = ?",
      );
      let split = 0;
      for (const r of rows) {
        const own = episodeSegment(r.subtitle_detail, r.season, r.episode);
        if (!own) continue;
        const source = own.includes("descărcată de pe subs.ro")
          ? "subsro"
          : own.includes("descărcată de pe OpenSubtitles")
            ? "opensubtitles"
            : "season_aggregate";
        update.run(own, source, r.id);
        split++;
      }
      console.log(`[db] Migrare v39: detaliul subtitrării separat pe ${split} episoade`);
      database.exec("PRAGMA user_version = 39");
    }

    if (version < 40) {
      // v40: utilizatorii scutiți de contribuția lunară (tabelele
      // contribution_* se creează direct în schemă, cu IF NOT EXISTS).
      try {
        database.exec(
          "ALTER TABLE users ADD COLUMN contribution_exempt INTEGER NOT NULL DEFAULT 0",
        );
        console.log("[db] Migrare v40: adăugat users.contribution_exempt");
      } catch {
        // coloana există deja (bază nouă, creată direct cu schema curentă)
      }
      database.exec("PRAGMA user_version = 40");
    }

    if (version < 41) {
      // v41: ștergerea programată (vezi CREATE TABLE și scheduled-delete.ts).
      for (const sql of [
        "ALTER TABLE media ADD COLUMN delete_scheduled_at TEXT",
        "ALTER TABLE media ADD COLUMN delete_scheduled_by INTEGER",
      ]) {
        try {
          database.exec(sql);
        } catch {
          // coloana există deja (bază nouă, creată direct cu schema curentă)
        }
      }
      console.log("[db] Migrare v41: adăugat media.delete_scheduled_at/_by");
      database.exec("PRAGMA user_version = 41");
    }

    if (version < 42) {
      // v42: data ultimului episod difuzat — fereastra orară a urmăririi
      // (vezi checkDueShows în show-watch.ts).
      try {
        database.exec("ALTER TABLE media ADD COLUMN last_episode_air_date TEXT");
      } catch {
        // coloana există deja (bază nouă, creată direct cu schema curentă)
      }
      console.log("[db] Migrare v42: adăugat media.last_episode_air_date");
      database.exec("PRAGMA user_version = 42");
    }

    if (version < 43) {
      // v43: subtitle_retry_state scos — starea e în Watcher.
      database.exec("DROP TABLE IF EXISTS subtitle_retry_state");
      console.log("[db] Migrare v43: subtitle_retry_state eliminat (starea e în Watcher)");
      database.exec("PRAGMA user_version = 43");
    }

    if (version < 44) {
      // v44: șterge reîmprospătările „nimic nou” (nu se mai scriu) și rezumatele
      // vechi „N filme împrospătate”.
      const removed = database
        .prepare(
          "DELETE FROM activity WHERE type = 'metadata_refresh' AND message LIKE '%· nimic nou'",
        )
        .run();
      database
        .prepare(
          "DELETE FROM watcher_runs WHERE task_id = 'show-watch' AND summary LIKE '%împrospăt%'",
        )
        .run();
      console.log(`[db] Migrare v44: ${removed.changes} reîmprospătări „nimic nou” șterse`);
      database.exec("PRAGMA user_version = 44");
    }

    if (version < 45) {
      // v45: sesiunile Plex se verifică la 10s, iar o vizionare e oprită abia
      // după două verificări la rând fără ea — câte a lipsit stă aici.
      try {
        database.exec(
          "ALTER TABLE plex_active_sessions ADD COLUMN missed INTEGER NOT NULL DEFAULT 0",
        );
      } catch {
        // coloana există deja (bază nouă, creată direct cu schema curentă)
      }
      console.log("[db] Migrare v45: adăugat plex_active_sessions.missed");
      database.exec("PRAGMA user_version = 45");
    }

    if (version < 46) {
      // v46: watcher_tasks fără last_started_at/last_summary, necitite.
      for (const col of ["last_started_at", "last_summary"]) {
        try {
          database.exec(`ALTER TABLE watcher_tasks DROP COLUMN ${col}`);
        } catch {
          // coloana nu există (bază nouă, creată direct cu schema curentă)
        }
      }
      console.log("[db] Migrare v46: watcher_tasks fără last_started_at/last_summary");
      database.exec("PRAGMA user_version = 46");
    }

    if (version < 47) {
      // v47: termenul ștergerii programate = finalizarea descărcării + 48 h
      // (era adăugarea + 24 h); cererea separată de termen, care poate lipsi.
      try {
        database.exec("ALTER TABLE media ADD COLUMN delete_requested_at TEXT");
      } catch {
        // coloana există deja (bază nouă, creată direct cu schema curentă)
      }
      database.exec(
        `UPDATE media SET delete_requested_at = datetime('now'),
                delete_scheduled_at = (
                  SELECT datetime(MIN(c.completed_at), '+48 hours') FROM media c
                   WHERE c.torrent_hash = media.torrent_hash)
          WHERE delete_scheduled_at IS NOT NULL AND torrent_hash IS NOT NULL`,
      );
      console.log("[db] Migrare v47: ștergerea programată la 48 h de la finalizare");
      database.exec("PRAGMA user_version = 47");
    }
  }
}

// Bucata unui episod din detaliul agregat al unui pachet: „… — S01E01: …;
// S01E02: …" → textul de după „S01E02: ", până la următorul „; SxxEyy: ".
export function episodeSegment(detail: string, season: number, episode: number): string | null {
  const pad = (n: number) => String(n).padStart(2, "0");
  const key = `S${pad(season)}E${pad(episode)}: `;
  const start = detail.indexOf(key);
  if (start < 0) return null;
  const rest = detail.slice(start + key.length);
  const end = rest.search(/; S\d{2,}E\d{2,}: /);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}
