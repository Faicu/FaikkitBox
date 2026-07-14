import { createServerFn } from "@tanstack/react-start";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Tipuri
// ---------------------------------------------------------------------------

export type ActivityType =
  | "server_start"
  | "server_stop"
  | "deploy"
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

export async function logActivity(
  type: ActivityType,
  message: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    const { getDb } = await import("./db");
    const db = getDb();
    db.prepare("INSERT INTO activity (id, timestamp, type, message, meta) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), new Date().toISOString(), type, message, meta ? JSON.stringify(meta) : null);
  } catch (e) {
    console.warn("[activity-log] Eroare la logActivity:", e);
  }
}

// ---------------------------------------------------------------------------
// Server function: citire log pentru UI
// ---------------------------------------------------------------------------

export const getActivityLog = createServerFn({ method: "GET" }).handler(
  async (): Promise<ActivityEntry[]> => {
    try {
      const { getDb } = await import("./db");
      const db = getDb();
      const rows = db.prepare(
        "SELECT id, timestamp, type, message, meta FROM activity ORDER BY timestamp DESC LIMIT 500"
      ).all() as Array<{ id: string; timestamp: string; type: string; message: string; meta: string | null }>;
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

// Cheie: "user|title|grandparentTitle" → timestamp start
const activePlexSessions = new Map<string, string>();

function sessionKey(user: string, title: string, grandparent?: string): string {
  return `${user}|${grandparent ?? ""}|${title}`;
}

export async function trackPlexSessions(
  sessions: Array<{ user: string; title: string; grandparentTitle?: string; player?: string }>,
): Promise<void> {
  const currentKeys = new Set<string>();

  for (const s of sessions) {
    const key = sessionKey(s.user, s.title, s.grandparentTitle);
    currentKeys.add(key);

    if (!activePlexSessions.has(key)) {
      // Sesiune nouă — loghez start
      activePlexSessions.set(key, new Date().toISOString());
      const what = s.grandparentTitle
        ? `${s.grandparentTitle} — ${s.title}`
        : s.title;
      await logActivity(
        "plex_watch_start",
        `${s.user} a început vizionarea: ${what}`,
        { user: s.user, title: s.title, grandparentTitle: s.grandparentTitle, player: s.player },
      );
    }
  }

  // Sesiuni terminate — cele din activePlexSessions care nu mai sunt în currentKeys
  for (const [key, startedAt] of activePlexSessions.entries()) {
    if (!currentKeys.has(key)) {
      activePlexSessions.delete(key);
      const [user, grandparent, title] = key.split("|");
      const what = grandparent ? `${grandparent} — ${title}` : title;
      const durationMs = Date.now() - new Date(startedAt).getTime();
      const mins = Math.round(durationMs / 60_000);
      await logActivity(
        "plex_watch_stop",
        `${user} a terminat vizionarea: ${what}${mins > 0 ? ` (${mins} min)` : ""}`,
        { user, title, grandparentTitle: grandparent || undefined },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Tracking uploads Immich (in-memory)
// ---------------------------------------------------------------------------

let lastImmichUploadsToday = -1;
let lastImmichUploadsThisWeek = -1;

export async function trackImmichUploads(
  uploadsToday: number,
  uploadsThisWeek: number,
): Promise<void> {
  if (lastImmichUploadsToday === -1) {
    // Prima citire — doar salvăm baseline, nu logăm
    lastImmichUploadsToday = uploadsToday;
    lastImmichUploadsThisWeek = uploadsThisWeek;
    return;
  }

  if (uploadsToday > lastImmichUploadsToday) {
    const diff = uploadsToday - lastImmichUploadsToday;
    await logActivity(
      "immich_upload",
      `${diff} fișier${diff === 1 ? "" : "e"} noi încărcate pe Immich astăzi (total: ${uploadsToday})`,
      { count: diff, totalToday: uploadsToday },
    );
    lastImmichUploadsToday = uploadsToday;
  }
  if (uploadsThisWeek > lastImmichUploadsThisWeek) {
    lastImmichUploadsThisWeek = uploadsThisWeek;
  }
}

// ---------------------------------------------------------------------------
// Tracking deploy (in-memory)
// ---------------------------------------------------------------------------

let lastKnownSha: string | null = null;

export async function trackDeploy(localSha: string, message: string): Promise<void> {
  if (lastKnownSha === null) {
    lastKnownSha = localSha;
    return;
  }
  if (localSha !== lastKnownSha) {
    lastKnownSha = localSha;
    await logActivity(
      "deploy",
      `Deploy reușit: ${localSha.slice(0, 7)} — ${message}`,
      { sha: localSha, commitMessage: message },
    );
  }
}

// ---------------------------------------------------------------------------
// Log pornire + oprire server
// ---------------------------------------------------------------------------

// Referință pre-încărcată la DB pentru shutdown handler (ESM nu are require sincron)
let dbModuleRef: typeof import("./db") | null = null;
let cryptoRef: typeof import("node:crypto") | null = null;

async function logServerStartOnce(): Promise<void> {
  try {
    const dbModule = await import("./db");
    dbModuleRef = dbModule;
    cryptoRef = await import("node:crypto");
    const db = dbModule.getDb();
    // Deduplicare: modulul poate fi încărcat în mai multe chunk-uri de build.
    // Dacă există deja un server_start în ultimele 30 secunde, nu logăm din nou.
    const recent = db.prepare(
      "SELECT COUNT(*) as c FROM activity WHERE type = 'server_start' AND timestamp > ?"
    ).get(new Date(Date.now() - 30_000).toISOString()) as { c: number };
    if (recent.c > 0) return;
    await logActivity("server_start", "Serverul FaikkitBox a pornit");
  } catch {}
}

function logServerStopSync(): void {
  try {
    if (!dbModuleRef || !cryptoRef) return;
    const db = dbModuleRef.getDb();
    db.prepare("INSERT INTO activity (id, timestamp, type, message, meta) VALUES (?, ?, ?, ?, ?)")
      .run(cryptoRef.randomUUID(), new Date().toISOString(), "server_stop", "Serverul FaikkitBox s-a oprit", null);
  } catch {}
}

declare global {
  // Guard global împotriva înregistrării duplicate a handler-elor
  var __faikkitboxActivityInit: boolean | undefined;
}

if (typeof process !== "undefined" && process.env && !globalThis.__faikkitboxActivityInit) {
  globalThis.__faikkitboxActivityInit = true;
  logServerStartOnce();
  // "exit" rulează la orice ieșire normală — doar cod sincron (node:sqlite poate).
  let stopLogged = false;
  const logOnce = () => { if (!stopLogged) { stopLogged = true; logServerStopSync(); } };
  process.on("exit", logOnce);
  // Backup: dacă SIGTERM nu duce la exit normal (proces omorât direct),
  // logăm imediat la semnal. NU facem process.exit() — lăsăm Nitro să-și
  // termine graceful shutdown-ul.
  process.on("SIGTERM", logOnce);
  process.on("SIGINT", logOnce);
}
