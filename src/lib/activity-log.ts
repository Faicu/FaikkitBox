import { createServerFn } from "@tanstack/react-start";
import { randomUUID } from "node:crypto";

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
  | "qbit_action";

export interface ActivityEntry {
  id: string;
  timestamp: string; // ISO
  type: ActivityType;
  message: string;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Persistență: SQLite (node:sqlite nativ)
// ---------------------------------------------------------------------------

const PUSH_TITLES: Record<ActivityType, string> = {
  server_start: "🟢 Server",
  server_stop: "🔴 Server",
  plex_watch_start: "🎬 Plex",
  plex_watch_stop: "🎬 Plex",
  torrent_added: "⬇️ Torrent",
  torrent_complete: "✅ Torrent",
  immich_upload: "📷 Immich",
  service_restart: "🔄 Serviciu",
  service_update: "⬆️ Update",
  ubuntu_update: "🐧 Ubuntu",
  qbit_action: "⚙️ qBittorrent",
};

export async function logActivity(
  type: ActivityType,
  message: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    const { getDb } = await import("./db");
    const db = getDb();
    db.prepare(
      "INSERT INTO activity (id, timestamp, type, message, meta) VALUES (?, ?, ?, ?, ?)",
    ).run(
      randomUUID(),
      new Date().toISOString(),
      type,
      message,
      meta ? JSON.stringify(meta) : null,
    );
  } catch (e) {
    console.warn("[activity-log] Eroare la logActivity:", e);
  }

  // Trimite notificare push (fire and forget)
  import("./push")
    .then(({ sendPushToAll }) => sendPushToAll(PUSH_TITLES[type] ?? "FaikkitBox", message))
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Server function: citire log pentru UI
// ---------------------------------------------------------------------------

export const getActivityLog = createServerFn({ method: "GET" }).handler(
  async (): Promise<ActivityEntry[]> => {
    try {
      const { getDb } = await import("./db");
      const db = getDb();
      const rows = db
        .prepare(
          "SELECT id, timestamp, type, message, meta FROM activity ORDER BY timestamp DESC LIMIT 500",
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
  },
);

// ---------------------------------------------------------------------------
// Tracking sesiuni Plex active (in-memory, pentru detectie start/stop)
// ---------------------------------------------------------------------------

// Cheie: "user|title|grandparentTitle" → { startedAt, lastViewOffsetMs, durationMs }
type PlexSessionState = { startedAt: string; lastViewOffsetMs: number; durationMs: number };
const activePlexSessions = new Map<string, PlexSessionState>();
let plexSessionsInitialized = false;

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
  sessions: Array<{ user: string; title: string; grandparentTitle?: string; player?: string; viewOffsetMs?: number; durationMs?: number }>,
): Promise<void> {
  if (!plexSessionsInitialized) {
    // Prima citire după restart — salvăm baseline fără a loga
    for (const s of sessions) {
      const key = sessionKey(s.user, s.title, s.grandparentTitle);
      activePlexSessions.set(key, { startedAt: new Date().toISOString(), lastViewOffsetMs: s.viewOffsetMs ?? 0, durationMs: s.durationMs ?? 0 });
    }
    plexSessionsInitialized = true;
    return;
  }

  const currentKeys = new Set<string>();

  for (const s of sessions) {
    const key = sessionKey(s.user, s.title, s.grandparentTitle);
    currentKeys.add(key);

    if (!activePlexSessions.has(key)) {
      activePlexSessions.set(key, { startedAt: new Date().toISOString(), lastViewOffsetMs: s.viewOffsetMs ?? 0, durationMs: s.durationMs ?? 0 });
      const what = s.grandparentTitle ? `${s.grandparentTitle} — ${s.title}` : s.title;
      await logActivity("plex_watch_start", `${s.user} a început vizionarea: ${what}`, {
        user: s.user,
        title: s.title,
        grandparentTitle: s.grandparentTitle,
        player: s.player,
      });
    } else {
      // actualizăm progresul curent
      const state = activePlexSessions.get(key)!;
      state.lastViewOffsetMs = s.viewOffsetMs ?? state.lastViewOffsetMs;
      state.durationMs = s.durationMs ?? state.durationMs;
    }
  }

  // Sesiuni terminate — cele din activePlexSessions care nu mai sunt în currentKeys
  for (const [key, state] of activePlexSessions.entries()) {
    if (!currentKeys.has(key)) {
      activePlexSessions.delete(key);
      const [user, grandparent, title] = key.split("|");
      const what = grandparent ? `${grandparent} — ${title}` : title;
      const progress = fmtProgress(state.lastViewOffsetMs, state.durationMs);
      await logActivity(
        "plex_watch_stop",
        `${user} a terminat vizionarea: ${what}${progress}`,
        { user, title, grandparentTitle: grandparent || undefined },
      );
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
// Log pornire + oprire server
// ---------------------------------------------------------------------------

// Referință pre-încărcată la DB pentru shutdown handler (ESM nu are require sincron)
let dbModuleRef: typeof import("./db") | null = null;
let cryptoRef: typeof import("node:crypto") | null = null;

async function isCodeRestart(): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    // Calea spre build-ul curent — dacă a fost modificat în ultimele 3 minute, e un restart din cod
    const buildFile = new URL("../index.mjs", import.meta.url);
    const s = await stat(fileURLToPath(buildFile));
    return Date.now() - s.mtimeMs < 3 * 60_000;
  } catch {
    return false;
  }
}

async function logServerStartOnce(): Promise<void> {
  try {
    const dbModule = await import("./db");
    dbModuleRef = dbModule;
    cryptoRef = await import("node:crypto");
    const db = dbModule.getDb();
    // Deduplicare: modulul poate fi încărcat în mai multe chunk-uri de build.
    // Dacă există deja un server_start în ultimele 30 secunde, nu logăm din nou.
    const recent = db
      .prepare("SELECT COUNT(*) as c FROM activity WHERE type = 'server_start' AND timestamp > ?")
      .get(new Date(Date.now() - 30_000).toISOString()) as { c: number };
    if (recent.c > 0) return;
    // Nu logăm dacă e un restart cauzat de un build recent (modificare cod)
    if (await isCodeRestart()) return;
    await logActivity("server_start", "Serverul FaikkitBox a pornit");
  } catch {}
}

function logServerStopSync(): void {
  try {
    if (!dbModuleRef || !cryptoRef) return;
    // Nu logăm dacă e un restart cauzat de un build recent
    if (codeRestartDetected) return;
    const db = dbModuleRef.getDb();
    db.prepare(
      "INSERT INTO activity (id, timestamp, type, message, meta) VALUES (?, ?, ?, ?, ?)",
    ).run(
      cryptoRef.randomUUID(),
      new Date().toISOString(),
      "server_stop",
      "Serverul FaikkitBox s-a oprit",
      null,
    );
  } catch {}
}

declare global {
  var __faikkitboxActivityInit: boolean | undefined;
}

let codeRestartDetected = false;

if (typeof process !== "undefined" && process.env && !globalThis.__faikkitboxActivityInit) {
  globalThis.__faikkitboxActivityInit = true;
  // Detectăm înainte de logare dacă e restart din cod, pentru a suprima și server_stop
  isCodeRestart().then((isCode) => { codeRestartDetected = isCode; });
  logServerStartOnce();
  // "exit" rulează la orice ieșire normală — doar cod sincron (node:sqlite poate).
  let stopLogged = false;
  const logOnce = () => {
    if (!stopLogged) {
      stopLogged = true;
      logServerStopSync();
    }
  };
  process.on("exit", logOnce);
  // Backup: dacă SIGTERM nu duce la exit normal (proces omorât direct),
  // logăm imediat la semnal. NU facem process.exit() — lăsăm Nitro să-și
  // termine graceful shutdown-ul.
  process.on("SIGTERM", logOnce);
  process.on("SIGINT", logOnce);
}
