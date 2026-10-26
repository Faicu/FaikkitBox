import { randomUUID } from "node:crypto";
import {
  PUSH_TITLES,
  PUSH_URLS,
  buildServerStartMessage,
  buildServerStopMessage,
  buildPlexWatchStartMessage,
  buildPlexWatchStopMessage,
} from "./notifications/notifications";

// ---------------------------------------------------------------------------
// Tipuri
// ---------------------------------------------------------------------------

export type ActivityType =
  | "server_start"
  | "server_stop"
  | "plex_watch_start"
  | "plex_watch_stop"
  | "torrent_added"
  | "torrent_complete"
  | "immich_upload"
  | "service_restart"
  | "service_update"
  | "ubuntu_update"
  | "qbit_action"
  | "app_error"
  | "subtitle_fix"
  | "account_request"
  | "metadata_refresh"
  | "update_available"
  | "contribution"
  | "title_delete";

export type JsonValue = string | number | boolean | null | undefined;

// Meta acceptă și liste de obiecte plate (ex. meta.items la subtitle_fix) —
// blob-ul e serializat întreg cu JSON.
export type ActivityMetaValue = JsonValue | Record<string, JsonValue>[];

export interface ActivityEntry {
  id: string;
  timestamp: string; // ISO
  type: ActivityType;
  message: string;
  meta?: Record<string, ActivityMetaValue>;
  // La torrente: titlul din Bibliotecă, rezolvat la citire; lipsește dacă a
  // fost șters.
  mediaId?: number;
}

// ---------------------------------------------------------------------------
// Persistență: SQLite (node:sqlite nativ)
// ---------------------------------------------------------------------------

export async function logActivity(
  type: ActivityType,
  message: string,
  meta?: Record<string, ActivityMetaValue>,
  options?: {
    skipPush?: boolean;
    image?: string | null;
    url?: string;
    title?: string;
    // Tag-ul push: o notificare nouă cu același tag o înlocuiește pe cea veche
    // (torrent: inițiată → completă; Plex: început → încheiat).
    tag?: string;
    // Momentul real, când diferă de „acum” — opririle detectate retroactiv ar
    // apărea altfel ca fiind de adineauri.
    timestamp?: string;
  },
): Promise<void> {
  try {
    const { getDb } = await import("./db");
    const db = getDb();
    db.prepare(
      "INSERT INTO activity (id, timestamp, type, message, meta) VALUES (?, ?, ?, ?, ?)",
    ).run(
      randomUUID(),
      options?.timestamp ?? new Date().toISOString(),
      type,
      message,
      meta ? JSON.stringify(meta) : null,
    );
  } catch (e) {
    console.warn("[activity-log] Eroare la logActivity:", e);
  }

  // Push fire-and-forget; fără push la tipurile cu titlu gol și la skipPush.
  const pushTitle = options?.title ?? PUSH_TITLES[type];
  if (pushTitle && !options?.skipPush) {
    import("./notifications/push")
      .then(({ sendPushToAll }) =>
        sendPushToAll(pushTitle, message, {
          image: options?.image,
          url: options?.url ?? PUSH_URLS[type],
          tag: options?.tag,
        }),
      )
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Server function: citire log pentru UI
// ---------------------------------------------------------------------------

// getActivityLog e în activity-log.functions.ts — modulul ăsta are importuri
// server statice și târa db.ts în bundle-ul de client.

// `cursor` = cel mai mare rowid; clientul cere apoi doar ce e după el. După
// rowid, nu după timestamp: unele intrări au ora din trecut (oprirea unei
// vizionări, datată la ultimul heartbeat) și ar fi sărite.
export async function readActivityLog(
  afterRowid = 0,
): Promise<{ entries: ActivityEntry[]; cursor: number }> {
  try {
    const { getDb } = await import("./db");
    const cursor =
      (getDb().prepare("SELECT MAX(rowid) AS m FROM activity").get() as { m: number | null }).m ??
      0;
    const rows = getDb()
      .prepare(
        "SELECT id, timestamp, type, message, meta FROM activity WHERE rowid > ? AND rowid <= ? ORDER BY timestamp DESC, rowid DESC",
      )
      .all(afterRowid, cursor) as Array<{
      id: string;
      timestamp: string;
      type: string;
      message: string;
      meta: string | null;
    }>;
    const db = getDb();
    // Titlul din Bibliotecă pentru torrente, ca jurnalul să le poată deschide;
    // episoadele duc la serialul lor. Intrările vechi au doar torrentId.
    const byHash = db.prepare(
      "SELECT COALESCE(parent_id, id) AS id FROM media WHERE torrent_hash = ? ORDER BY id LIMIT 1",
    );
    const byFilelistId = db.prepare(
      "SELECT COALESCE(parent_id, id) AS id FROM media WHERE filelist_id = ? ORDER BY id LIMIT 1",
    );
    function resolveMediaId(meta: Record<string, ActivityMetaValue>): number | undefined {
      const row = (
        typeof meta.torrentHash === "string"
          ? byHash.get(meta.torrentHash)
          : typeof meta.torrentId === "number"
            ? byFilelistId.get(meta.torrentId)
            : undefined
      ) as { id: number } | undefined;
      return row?.id;
    }

    const entries = rows.map((r) => {
      const meta = r.meta ? (JSON.parse(r.meta) as Record<string, ActivityMetaValue>) : undefined;
      const mediaId =
        meta &&
        (r.type === "torrent_added" || r.type === "torrent_complete" || r.type === "title_delete")
          ? resolveMediaId(meta)
          : undefined;
      return {
        id: r.id,
        timestamp: r.timestamp,
        type: r.type as ActivityType,
        message: r.message,
        ...(meta ? { meta } : {}),
        ...(mediaId != null ? { mediaId } : {}),
      };
    });
    return { entries, cursor };
  } catch (e) {
    console.warn("[activity-log] Eroare la citire:", e);
    return { entries: [], cursor: afterRowid };
  }
}

// ---------------------------------------------------------------------------
// Sesiunile Plex active (în SQLite, supraviețuiesc restarturilor)
// ---------------------------------------------------------------------------

function sessionKey(user: string, title: string, grandparent?: string): string {
  return `${user}|${grandparent ?? ""}|${title}`;
}

function fmtProgress(viewOffsetMs: number, durationMs: number): string {
  if (durationMs <= 0) return "";
  const watched = Math.round(viewOffsetMs / 60_000);
  const total = Math.round(durationMs / 60_000);
  const pct = Math.round((viewOffsetMs / durationMs) * 100);
  return ` · ${watched}/${total} min (${pct}%)`;
}

const MISSES_TO_STOP = 2;

export async function trackPlexSessions(
  sessions: Array<{
    user: string;
    title: string;
    grandparentTitle?: string;
    ratingKey?: string;
    player?: string;
    viewOffsetMs?: number;
    durationMs?: number;
  }>,
): Promise<void> {
  const { getDb } = await import("./db");
  const db = getDb();

  // Sesiunile vin cu titlul din bibliotecă (original); afișăm titlul românesc
  // din `media`, după ratingKey, ca în Bibliotecă.
  function resolveDisplayTitle(ratingKey: string | undefined, isEpisode: boolean): string | null {
    if (!ratingKey) return null;
    const row = db
      .prepare("SELECT title FROM media WHERE plex_rating_key = ? AND media_type = ?")
      .get(ratingKey, isEpisode ? "episode" : "movie") as { title: string } | undefined;
    return row?.title || null;
  }

  const stored = db.prepare("SELECT * FROM plex_active_sessions").all() as Array<{
    key: string;
    started_at: string;
    last_view_offset_ms: number;
    duration_ms: number;
    user: string;
    title: string;
    grandparent_title: string | null;
    rating_key: string | null;
    missed: number;
  }>;
  const storedMap = new Map(stored.map((r) => [r.key, r]));

  const currentKeys = new Set<string>();

  for (const s of sessions) {
    const key = sessionKey(s.user, s.title, s.grandparentTitle);
    currentKeys.add(key);
    if (storedMap.has(key)) {
      // Progresul; sesiunea e din nou aici, deci lipsurile se resetează.
      const prev = storedMap.get(key)!;
      db.prepare(
        `UPDATE plex_active_sessions SET last_view_offset_ms = ?, duration_ms = ?, missed = 0
          WHERE key = ?`,
      ).run(s.viewOffsetMs ?? prev.last_view_offset_ms, s.durationMs ?? prev.duration_ms, key);
    }
  }

  // Opririle înaintea pornirilor — rowid-ul ține pornirile deasupra în UI.
  const MIN_PROGRESS_MS = 60_000;
  for (const [key, row] of storedMap.entries()) {
    if (!currentKeys.has(key)) {
      // Plex „pierde” uneori o sesiune o clipă (la derulare) — oprirea se
      // confirmă abia după MISSES_TO_STOP verificări la rând fără ea.
      if (row.missed + 1 < MISSES_TO_STOP) {
        db.prepare("UPDATE plex_active_sessions SET missed = missed + 1 WHERE key = ?").run(key);
        continue;
      }
      db.prepare("DELETE FROM plex_active_sessions WHERE key = ?").run(key);
      const what = row.grandparent_title ? `${row.grandparent_title} — ${row.title}` : row.title;
      const progress = fmtProgress(row.last_view_offset_ms, row.duration_ms);
      await logActivity(
        "plex_watch_stop",
        buildPlexWatchStopMessage(row.user, what, progress),
        {
          user: row.user,
          title: row.title,
          grandparentTitle: row.grandparent_title || undefined,
        },
        { tag: `plex-${key}` },
      );

      // Oprită înainte ca Plex s-o marcheze văzută: ținută minte cu progresul,
      // ca să apară în „Vizionări recente” (getRecentWatches poate s-o treacă
      // apoi la completed=1).
      if (row.rating_key && row.last_view_offset_ms >= MIN_PROGRESS_MS && row.duration_ms > 0) {
        try {
          const mediaRow = db
            .prepare("SELECT season, episode, poster_path FROM media WHERE plex_rating_key = ?")
            .get(row.rating_key) as
            | { season: number | null; episode: number | null; poster_path: string | null }
            | undefined;
          const { createRecentWatchUpserter } = await import("./services/recent-watch-cache");
          createRecentWatchUpserter(db)({
            ratingKey: row.rating_key,
            username: row.user,
            title: row.grandparent_title ? "" : row.title,
            show: row.grandparent_title || null,
            season: mediaRow?.season ?? null,
            episode: mediaRow?.episode ?? null,
            // Null la trailere — completat la citire din miniatura Plex.
            posterPath: mediaRow?.poster_path ?? null,
            viewedAt: Math.floor(Date.now() / 1000),
            viewOffsetMs: row.last_view_offset_ms,
            durationMs: row.duration_ms,
            completed: false,
          });
        } catch (e) {
          console.warn("[activity-log] Eroare la upsert recent_watch_cache:", e);
        }
      }
    }
  }

  for (const s of sessions) {
    const key = sessionKey(s.user, s.title, s.grandparentTitle);
    if (!storedMap.has(key)) {
      // Titlul românesc, stocat — oprirea îl citește din DB.
      const displayGrandparentTitle = s.grandparentTitle
        ? (resolveDisplayTitle(s.ratingKey, true) ?? s.grandparentTitle)
        : undefined;
      const displayTitle = !s.grandparentTitle
        ? (resolveDisplayTitle(s.ratingKey, false) ?? s.title)
        : s.title;

      db.prepare(
        `INSERT OR REPLACE INTO plex_active_sessions
         (key, started_at, last_view_offset_ms, duration_ms, user, title, grandparent_title, rating_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        key,
        new Date().toISOString(),
        s.viewOffsetMs ?? 0,
        s.durationMs ?? 0,
        s.user,
        displayTitle,
        displayGrandparentTitle ?? null,
        s.ratingKey ?? null,
      );

      const what = displayGrandparentTitle
        ? `${displayGrandparentTitle} — ${displayTitle}`
        : displayTitle;
      await logActivity(
        "plex_watch_start",
        buildPlexWatchStartMessage(s.user, what),
        {
          user: s.user,
          title: displayTitle,
          grandparentTitle: displayGrandparentTitle,
          player: s.player,
        },
        { tag: `plex-${key}` },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Pornirea și oprirea serverului. Procesul nu-și poate loga mereu oprirea
// (SIGKILL, OOM, pană de curent), deci `server_runtime` ține un heartbeat: la
// oprirea curată, clean_shutdown = 1; dacă la pornire e 0, oprirea se loghează
// retroactiv, datată la ultimul heartbeat (±30s).
// ---------------------------------------------------------------------------

// DB pre-încărcat pentru oprire (ESM n-are require sincron).
let dbModuleRef: typeof import("./db") | null = null;
let cryptoRef: typeof import("node:crypto") | null = null;

const HEARTBEAT_MS = 30_000;

// Retenția jurnalului — e o fereastră pe prezent, nu o arhivă.
const ACTIVITY_RETENTION_DAYS = 30;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function pruneActivityLog(): number {
  try {
    const db = dbModuleRef?.getDb();
    if (!db) return 0;
    const cutoff = new Date(
      Date.now() - ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const result = db.prepare("DELETE FROM activity WHERE timestamp < ?").run(cutoff);
    const removed = Number(result.changes ?? 0);
    if (removed > 0) {
      console.log(`[activity] Retenție ${ACTIVITY_RETENTION_DAYS}z: șterse ${removed} evenimente`);
    }
    return removed;
  } catch (e) {
    // O curățare ratată nu trebuie să oprească nimic — reîncearcă peste 24h.
    console.warn("[activity] Curățarea jurnalului a eșuat:", e);
    return 0;
  }
}

// Marcaj scris de `npm run build`, consumat la prima pornire de după. Euristica
// veche pe mtime-ul build-ului era greșită (stop → build → start lăsa fiecare
// deploy cu o oprire fără pereche).
function deployMarkerPath(): string {
  return process.env.FAIKKITBOX_DEPLOY_MARKER ?? "/opt/faikkitbox/data/.deploy-marker";
}

function consumeDeployMarker(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { existsSync, unlinkSync } = require("node:fs") as typeof import("node:fs");
    const p = deployMarkerPath();
    if (!existsSync(p)) return false;
    unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}

function nowHM(iso?: string): string {
  return (iso ? new Date(iso) : new Date()).toLocaleTimeString("ro-RO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Bucharest",
  });
}

// Setat de uncaughtException/unhandledRejection — singura cauză de oprire
// știută exact.
let crashCause: string | null = null;

// ---------------------------------------------------------------------------
// Starea de rulare (o singură linie, id = 1)
// ---------------------------------------------------------------------------

interface RuntimeRow {
  started_at: string;
  last_heartbeat: string;
  clean_shutdown: number;
  pid: number;
}

function readPreviousRuntime(db: import("node:sqlite").DatabaseSync): RuntimeRow | null {
  const row = db.prepare("SELECT * FROM server_runtime WHERE id = 1").get() as
    RuntimeRow | undefined;
  return row ?? null;
}

function writeRuntimeStart(db: import("node:sqlite").DatabaseSync): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO server_runtime (id, started_at, last_heartbeat, clean_shutdown, pid)
     VALUES (1, ?, ?, 0, ?)
     ON CONFLICT(id) DO UPDATE SET
       started_at = excluded.started_at,
       last_heartbeat = excluded.last_heartbeat,
       clean_shutdown = 0,
       pid = excluded.pid`,
  ).run(now, now, process.pid);
}

// ---------------------------------------------------------------------------
// Pornire
// ---------------------------------------------------------------------------

async function logServerStart(): Promise<void> {
  try {
    const dbModule = await import("./db");
    dbModuleRef = dbModule;
    cryptoRef = await import("node:crypto");
    // Conexiunea și migrările acum: la oprire avem doar ~300ms.
    const db = dbModule.getDb();

    // 1. Rularea anterioară s-a încheiat brutal? Oprirea ei se loghează ÎNAINTE
    //    de pornire, în ordine cronologică.
    const prev = readPreviousRuntime(db);
    if (prev && prev.clean_shutdown === 0) {
      await logActivity(
        "server_stop",
        buildServerStopMessage(
          "oprire necurată (proces terminat forțat, fără shutdown)",
          nowHM(prev.last_heartbeat),
        ),
        { unclean: true, detectedAt: "next_boot", previousPid: prev.pid },
        // Datată la ultimul heartbeat, nu acum. Fără push: ar sosi acum pentru
        // ceva petrecut înainte, iar pornirea anunță oricum revenirea.
        { skipPush: true, timestamp: prev.last_heartbeat },
      );
      console.warn(
        `[activity-log] Rularea anterioară (pid ${prev.pid}) s-a terminat necurat — ultimul semn de viață: ${prev.last_heartbeat}`,
      );
    }

    // 2. Cauza pornirii curente.
    const isDeploy = consumeDeployMarker();
    const os = await import("node:os");
    const cause = isDeploy
      ? "actualizare de cod (deploy)"
      : os.uptime() < 120
        ? "după repornirea sistemului"
        : "pornire manuală a serviciului";

    writeRuntimeStart(db);

    // Push la fiecare pornire, inclusiv la deploy. Suprimarea pentru deploy-uri
    // (5–12 sept.) lăsa doar oprirea anunțată — marcajul de deploy apare abia
    // după stop. Pornirea e și informația utilă („e din nou sus”), și singura
    // trimisă sigur: push-ul de la oprire are doar ~300ms.
    await logActivity("server_start", buildServerStartMessage(cause, nowHM()), {
      deploy: isDeploy,
      pid: process.pid,
    });
  } catch (e) {
    console.warn("[activity-log] Logarea pornirii a eșuat:", e);
  }
}

// ---------------------------------------------------------------------------
// Oprire (sincron — rulează din handlere de semnal / "exit")
// ---------------------------------------------------------------------------

function logServerStopSync(): void {
  try {
    if (!dbModuleRef || !cryptoRef) return;
    const db = dbModuleRef.getDb();
    const cause = crashCause ?? "oprire manuală / redeploy";
    const message = buildServerStopMessage(cause, nowHM());
    db.prepare(
      "INSERT INTO activity (id, timestamp, type, message, meta) VALUES (?, ?, ?, ?, ?)",
    ).run(
      cryptoRef.randomUUID(),
      new Date().toISOString(),
      "server_stop",
      message,
      JSON.stringify({ crash: crashCause != null, pid: process.pid }),
    );
    // Oprire curată — altfel pornirea următoare ar raporta un kill inexistent.
    db.prepare("UPDATE server_runtime SET clean_shutdown = 1 WHERE id = 1").run();

    // Push best-effort, fără await — ~300ms până la ieșirea forțată.
    import("./notifications/push")
      .then(({ sendPushToAll }) =>
        sendPushToAll(PUSH_TITLES.server_stop, message, { url: PUSH_URLS.server_stop }),
      )
      .catch(() => {});
  } catch (e) {
    // Nu blocăm oprirea serverului pentru o problemă de logare.
    console.warn("[activity-log] Logarea opririi a eșuat:", e);
  }
}

declare global {
  var __faikkitboxActivityInit: boolean | undefined;
}

// Doar din build-ul real, nu din sursă — un script ad-hoc ar loga fals
// pornirea și oprirea.
const isRealServerBuild = import.meta.url.includes("/.output/");

// Apelată din server/plugins/server-lifecycle.ts. Ca efect de modul rula abia
// la prima cerere HTTP: ora și cauza pornirii ieșeau greșite.
export async function initServerLifecycleLogging(): Promise<void> {
  if (!isRealServerBuild || typeof process === "undefined" || !process.env) return;
  if (globalThis.__faikkitboxActivityInit) return;
  globalThis.__faikkitboxActivityInit = true;

  // Așteptat: handlerele de mai jos au nevoie de dbModuleRef, altfel un SIGTERM
  // timpuriu n-ar putea fi logat.
  await logServerStart();

  // Heartbeat: ultima lui oră aproximează momentul unei opriri brutale (±30s).
  const beat = setInterval(() => {
    try {
      dbModuleRef
        ?.getDb()
        .prepare("UPDATE server_runtime SET last_heartbeat = ? WHERE id = 1")
        .run(new Date().toISOString());
    } catch {
      // O bătaie pierdută nu contează — următoarea corectează ora.
    }
  }, HEARTBEAT_MS);
  // Nu ține procesul în viață doar pentru heartbeat.
  beat.unref?.();

  // Curățarea jurnalului: la pornire și zilnic (procese care rulează săptămâni).
  pruneActivityLog();
  const prune = setInterval(pruneActivityLog, PRUNE_INTERVAL_MS);
  prune.unref?.();

  let stopLogged = false;
  const logOnce = () => {
    if (stopLogged) return;
    stopLogged = true;
    clearInterval(beat);
    logServerStopSync();
  };

  // „exit” rulează la orice ieșire normală — doar cod sincron (node:sqlite e).
  process.on("exit", logOnce);
  // Rezervă: dacă SIGTERM nu duce la un exit normal, logăm la semnal. Fără
  // process.exit() — Nitro și server-lifecycle își termină treaba.
  process.on("SIGTERM", logOnce);
  process.on("SIGINT", logOnce);

  // Un listener pe uncaughtException dezactivează crash-ul implicit — ieșim
  // explicit, ca systemd să repornească procesul. console-capture prinde deja
  // eroarea pentru „Erori aplicație”.
  process.on("uncaughtException", (e) => {
    crashCause = `eroare neașteptată (${e.message})`;
    console.error("[activity-log] uncaughtException:", e);
    process.exit(1);
  });
  process.on("unhandledRejection", (e) => {
    crashCause = `promisiune neprinsă (${e instanceof Error ? e.message : String(e)})`;
    console.error("[activity-log] unhandledRejection:", e);
    process.exit(1);
  });
}
