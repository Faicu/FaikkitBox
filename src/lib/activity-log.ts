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
  | "account_request";

export type JsonValue = string | number | boolean | null | undefined;

// Valorile din meta acceptă și array de obiecte plate (ex. subtitle_fix
// atașează lista per-torrent ca meta.items) — logActivity/getActivityLog
// serializează/deserializează tot blob-ul cu JSON.stringify/parse dintr-o
// dată, deci runtime-ul suportă deja structuri nested; doar tipul era
// restricționat la primitive.
export type ActivityMetaValue = JsonValue | Record<string, JsonValue>[];

export interface ActivityEntry {
  id: string;
  timestamp: string; // ISO
  type: ActivityType;
  message: string;
  meta?: Record<string, ActivityMetaValue>;
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
    // Momentul real al evenimentului, când diferă de "acum" — folosit pentru
    // opririle detectate retroactiv la pornirea următoare (SIGKILL, pană de
    // curent). Fără el, o oprire de acum două zile ar apărea în jurnal ca
    // fiind de adineauri.
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

  // Trimite notificare push (fire and forget) — tipurile cu titlu gol nu
  // trimit push, la fel ca apelurile care cer explicit skipPush (ex.
  // subtitle_fix pentru o descărcare unde n-a fost nevoie de nicio corecție)
  const pushTitle = options?.title ?? PUSH_TITLES[type];
  if (pushTitle && !options?.skipPush) {
    import("./notifications/push")
      .then(({ sendPushToAll }) =>
        sendPushToAll(pushTitle, message, {
          image: options?.image,
          url: options?.url ?? PUSH_URLS[type],
        }),
      )
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Server function: citire log pentru UI
// ---------------------------------------------------------------------------

// getActivityLog trăiește acum în activity-log.functions.ts — vezi comentariul
// de acolo: modulul ăsta are importuri server statice (node:crypto) și e
// rădăcina care târa db.ts în bundle-ul de client.

export async function readActivityLog(): Promise<ActivityEntry[]> {
  try {
    const { getDb } = await import("./db");
    const rows = getDb()
      .prepare(
        "SELECT id, timestamp, type, message, meta FROM activity ORDER BY timestamp DESC, rowid DESC LIMIT 500",
      )
      .all() as Array<{
      id: string;
      timestamp: string;
      type: string;
      message: string;
      meta: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      type: r.type as ActivityType,
      message: r.message,
      ...(r.meta ? { meta: JSON.parse(r.meta) } : {}),
    }));
  } catch (e) {
    console.warn("[activity-log] Eroare la citire:", e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tracking sesiuni Plex active (persistat în SQLite, supraviețuiește restarturilor)
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

  // Sesiunile Plex vin cu titlul original (limba din bibliotecă), nu cel
  // tradus RO folosit peste tot în restul aplicației (Bibliotecă etc.) —
  // căutăm rândul din `media` după ratingKey-ul item-ului redat, ca să
  // afișăm în jurnal același titlu ca în Bibliotecă. Pentru episoade,
  // `media.title` conține deja numele serialului (nu se ține titlu
  // separat per episod — vezi media.ts).
  function resolveDisplayTitle(ratingKey: string | undefined, isEpisode: boolean): string | null {
    if (!ratingKey) return null;
    const row = db
      .prepare("SELECT title FROM media WHERE plex_rating_key = ? AND media_type = ?")
      .get(ratingKey, isEpisode ? "episode" : "movie") as { title: string } | undefined;
    return row?.title || null;
  }

  // Citește sesiunile active din SQLite (supraviețuiesc restarturilor)
  const stored = db.prepare("SELECT * FROM plex_active_sessions").all() as Array<{
    key: string;
    started_at: string;
    last_view_offset_ms: number;
    duration_ms: number;
    user: string;
    title: string;
    grandparent_title: string | null;
    rating_key: string | null;
  }>;
  const storedMap = new Map(stored.map((r) => [r.key, r]));

  const currentKeys = new Set<string>();

  for (const s of sessions) {
    const key = sessionKey(s.user, s.title, s.grandparentTitle);
    currentKeys.add(key);
    if (storedMap.has(key)) {
      // Actualizăm progresul în DB
      const prev = storedMap.get(key)!;
      db.prepare(
        `UPDATE plex_active_sessions SET last_view_offset_ms = ?, duration_ms = ? WHERE key = ?`,
      ).run(s.viewOffsetMs ?? prev.last_view_offset_ms, s.durationMs ?? prev.duration_ms, key);
    }
  }

  // STOPs înainte de STARTs — astfel rowid-ul stop < rowid start,
  // iar cu ORDER BY timestamp DESC, rowid DESC starts apar deasupra stops în UI
  const MIN_PROGRESS_MS = 60_000;
  for (const [key, row] of storedMap.entries()) {
    if (!currentKeys.has(key)) {
      db.prepare("DELETE FROM plex_active_sessions WHERE key = ?").run(key);
      const what = row.grandparent_title ? `${row.grandparent_title} — ${row.title}` : row.title;
      const progress = fmtProgress(row.last_view_offset_ms, row.duration_ms);
      await logActivity("plex_watch_stop", buildPlexWatchStopMessage(row.user, what, progress), {
        user: row.user,
        title: row.title,
        grandparentTitle: row.grandparent_title || undefined,
      });

      // Vizionare oprită/întreruptă înainte ca Plex să o marcheze "văzută" în
      // istoric (sub pragul lui de completare) — o ținem minte aici, cu
      // progresul exact, ca să apară totuși în "Vizionări recente" (nu doar
      // titlurile terminate complet). Vezi getRecentWatches din plex-browse.ts,
      // care poate ulterior să suprascrie cu completed=1 dacă istoricul Plex
      // confirmă vizionarea completă.
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
      // Titlul afișat/stocat e cel tradus RO (dacă titlul redat e cunoscut
      // local) — atât aici cât și la stop (care citește din DB, nu recalculează).
      const displayGrandparentTitle = s.grandparentTitle
        ? (resolveDisplayTitle(s.ratingKey, true) ?? s.grandparentTitle)
        : undefined;
      const displayTitle = !s.grandparentTitle
        ? (resolveDisplayTitle(s.ratingKey, false) ?? s.title)
        : s.title;

      // Sesiune nouă — inserăm în DB și logăm start
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
      await logActivity("plex_watch_start", buildPlexWatchStartMessage(s.user, what), {
        user: s.user,
        title: displayTitle,
        grandparentTitle: displayGrandparentTitle,
        player: s.player,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Tracking uploads Immich (in-memory, per user)
// ---------------------------------------------------------------------------

type ImmichUserSnapshot = { photos: number; videos: number };
const lastImmichByUser = new Map<string, ImmichUserSnapshot>();
let immichInitialized = false;

// Debounce: acumulăm modificările per user și logăm după 2 minute de inactivitate
const IMMICH_DEBOUNCE_MS = 2 * 60_000;
type ImmichPending = { photos: number; videos: number; timer: ReturnType<typeof setTimeout> };
const immichPending = new Map<string, ImmichPending>();

async function flushImmichUser(userName: string): Promise<void> {
  const pending = immichPending.get(userName);
  if (!pending) return;
  immichPending.delete(userName);

  const { photos: newPhotos, videos: newVideos } = pending;
  const parts: string[] = [];
  if (newPhotos > 0) parts.push(`${newPhotos} ${newPhotos === 1 ? "fotografie" : "fotografii"}`);
  if (newVideos > 0) parts.push(`${newVideos} ${newVideos === 1 ? "videoclip" : "videoclipuri"}`);
  const ora = new Date().toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
  await logActivity("immich_upload", `${userName} a încărcat ${parts.join(" și ")} la ora ${ora}`, {
    user: userName,
    newPhotos,
    newVideos,
  });
}

export async function trackImmichUploads(
  usageByUser: Array<{ userName: string; photos: number; videos: number }>,
): Promise<void> {
  if (!immichInitialized) {
    for (const u of usageByUser) {
      lastImmichByUser.set(u.userName, { photos: u.photos, videos: u.videos });
    }
    immichInitialized = true;
    return;
  }

  for (const u of usageByUser) {
    const prev = lastImmichByUser.get(u.userName) ?? { photos: 0, videos: 0 };
    const newPhotos = Math.max(0, u.photos - prev.photos);
    const newVideos = Math.max(0, u.videos - prev.videos);

    if (newPhotos > 0 || newVideos > 0) {
      lastImmichByUser.set(u.userName, { photos: u.photos, videos: u.videos });

      // Acumulăm în buffer debounce
      const existing = immichPending.get(u.userName);
      if (existing) {
        clearTimeout(existing.timer);
        existing.photos += newPhotos;
        existing.videos += newVideos;
        existing.timer = setTimeout(() => flushImmichUser(u.userName), IMMICH_DEBOUNCE_MS);
      } else {
        immichPending.set(u.userName, {
          photos: newPhotos,
          videos: newVideos,
          timer: setTimeout(() => flushImmichUser(u.userName), IMMICH_DEBOUNCE_MS),
        });
      }
    }

    if (!lastImmichByUser.has(u.userName)) {
      lastImmichByUser.set(u.userName, { photos: u.photos, videos: u.videos });
    }
  }
}

// ---------------------------------------------------------------------------
// Ciclul de viață al serverului: pornire, oprire, cauză
//
// Proiectat în jurul unei singure idei: procesul NU poate loga întotdeauna
// propria oprire. Un SIGKILL (systemd după TimeoutStopSec), un OOM kill sau o
// pană de curent nu rulează niciun cod al nostru. Versiunea anterioară se baza
// exclusiv pe handlere de semnal, deci acele opriri lipseau pur și simplu din
// jurnal, iar pornirea următoare apărea nemotivat, fără pereche.
//
// Soluția: un rând de stare în DB (`server_runtime`) cu un heartbeat periodic.
// La oprirea curată îl marcăm `clean_shutdown = 1`. Dacă la pornire găsim un
// rând rămas cu 0, știm că rularea anterioară s-a terminat brutal — și logăm
// RETROACTIV oprirea, datată la ultimul heartbeat (adică ±30s de momentul
// real). Jurnalul devine astfel complet în toate scenariile, nu doar în cele
// în care apucăm să ne executăm codul.
// ---------------------------------------------------------------------------

// Referință pre-încărcată la DB pentru shutdown handler (ESM nu are require sincron)
let dbModuleRef: typeof import("./db") | null = null;
let cryptoRef: typeof import("node:crypto") | null = null;

const HEARTBEAT_MS = 30_000;

// Marcaj scris de `npm run build` (vezi package.json) și consumat o singură
// dată, la prima pornire de după. Înlocuiește o euristică veche pe mtime-ul
// lui .output/server/index.mjs, care era greșită prin construcție: workflow-ul
// e stop → build → start, deci la oprire mtime-ul era vechi (oprirea se loga)
// iar la pornire proaspăt (pornirea se suprima) — fiecare deploy lăsa o oprire
// fără pereche.
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

// Setat de handlerele uncaughtException/unhandledRejection — singura cauză de
// oprire pe care o putem numi exact în momentul în care se întâmplă.
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
    // Deschide conexiunea (și rulează migrările) acum, la pornire — la oprire
    // avem doar ~300ms până la ieșirea forțată din fast-shutdown.ts, prea
    // puțin ca să deschidem DB-ul de la zero acolo.
    const db = dbModule.getDb();

    // 1. Rularea anterioară s-a încheiat brutal? Logăm oprirea ei ÎNAINTE de
    //    pornirea curentă, ca jurnalul să rămână în ordine cronologică.
    const prev = readPreviousRuntime(db);
    if (prev && prev.clean_shutdown === 0) {
      await logActivity(
        "server_stop",
        buildServerStopMessage(
          "oprire necurată (proces terminat forțat, fără shutdown)",
          nowHM(prev.last_heartbeat),
        ),
        { unclean: true, detectedAt: "next_boot", previousPid: prev.pid },
        // Datat la ultimul heartbeat, nu la momentul detectării: dacă serverul
        // a stat picat două zile, oprirea trebuie să apară în jurnal acolo
        // unde s-a întâmplat, nu acum.
        // Fără push: notificarea ar sosi acum, pentru ceva petrecut înainte.
        // Pornirea de mai jos anunță oricum că serverul e din nou sus.
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

    // Deploy-urile se loghează, dar fără push — altfel primești o notificare
    // la fiecare `npm run build`. Înainte erau suprimate complet, ceea ce
    // lăsa găuri în jurnal.
    await logActivity(
      "server_start",
      buildServerStartMessage(cause, nowHM()),
      {
        deploy: isDeploy,
        pid: process.pid,
      },
      { skipPush: isDeploy },
    );
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
    // Marcăm oprirea ca fiind curată — altfel pornirea următoare ar raporta
    // retroactiv un kill care nu s-a întâmplat.
    db.prepare("UPDATE server_runtime SET clean_shutdown = 1 WHERE id = 1").run();

    // Push best-effort, fără await — la oprire avem doar ~300ms
    // (fast-shutdown.ts) înainte de ieșirea forțată, insuficient garantat
    // pentru un round-trip web-push, dar merită încercat când apucă.
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

// Rulează doar când modulul e încărcat din build-ul real (.output/server/...),
// nu din sursă (ex. un script ad-hoc peste src/lib/*.ts) — altfel un script
// efemer ar loga fals "Serverul a pornit / s-a oprit" la fiecare rulare; asta
// a poluat jurnalul în timpul testării manuale a acestui fișier.
const isRealServerBuild = import.meta.url.includes("/.output/");

// Apelată explicit (și AȘTEPTATĂ) din server/plugins/activity-boot.ts.
//
// Înainte, blocul rula ca side-effect la încărcarea modulului — dar nimic nu
// importa activity-log la boot, deci se executa abia la PRIMA CERERE HTTP.
// Măsurat: după `systemctl restart`, jurnalul rămânea gol până când cineva
// deschidea aplicația; un singur curl declanșa imediat "Serverul a pornit", cu
// ora cererii în loc de ora pornirii, și cu `os.uptime()` deja mare, deci un
// reboot real apărea ca "pornire manuală".
export async function initServerLifecycleLogging(): Promise<void> {
  if (!isRealServerBuild || typeof process === "undefined" || !process.env) return;
  if (globalThis.__faikkitboxActivityInit) return;
  globalThis.__faikkitboxActivityInit = true;

  // Așteptat, nu fire-and-forget: handlerele de mai jos au nevoie de
  // dbModuleRef populat, iar un SIGTERM sosit între timp ar găsi altfel
  // shutdown-ul nelogabil.
  await logServerStart();

  // Heartbeat: cât timp procesul trăiește, își actualizează ora. Dacă e
  // omorât brutal, ultimul heartbeat rămâne cea mai bună aproximare a
  // momentului morții (±30s), folosită de logServerStart la pornirea
  // următoare.
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

  let stopLogged = false;
  const logOnce = () => {
    if (stopLogged) return;
    stopLogged = true;
    clearInterval(beat);
    logServerStopSync();
  };

  // "exit" rulează la orice ieșire normală — doar cod sincron (node:sqlite
  // e sincron, deci merge).
  process.on("exit", logOnce);
  // Backup: dacă SIGTERM nu duce la un exit normal, logăm direct la semnal.
  // NU apelăm process.exit() aici — lăsăm Nitro (și fast-shutdown.ts) să-și
  // termine treaba.
  process.on("SIGTERM", logOnce);
  process.on("SIGINT", logOnce);

  // Un listener pe uncaughtException/unhandledRejection dezactivează crash-ul
  // implicit al Node, deci trebuie să ieșim noi explicit — altfel procesul
  // rămâne agățat în loc să pice curat (și systemd să-l repornească).
  // console-capture.ts prinde deja console.error pentru Jurnalul de erori,
  // deci eroarea se loghează o singură dată aici, nu duplicat.
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
