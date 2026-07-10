import { createServerFn } from "@tanstack/react-start";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Tipuri
// ---------------------------------------------------------------------------

export type ActivityType =
  | "server_start"
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
// Fișier log
// ---------------------------------------------------------------------------

function logPath(): string {
  return process.env.ACTIVITY_LOG_PATH ?? "/opt/faikkitbox/data/activity-log.json";
}

async function readLog(): Promise<ActivityEntry[]> {
  try {
    const raw = await readFile(logPath(), "utf8");
    return JSON.parse(raw) as ActivityEntry[];
  } catch {
    return [];
  }
}

async function writeLog(entries: ActivityEntry[]): Promise<void> {
  try {
    const file = logPath();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(entries, null, 2), "utf8");
  } catch (e) {
    console.warn("[activity-log] Eroare la scriere:", e);
  }
}

// ---------------------------------------------------------------------------
// Funcție publică: adaugă eveniment în log
// ---------------------------------------------------------------------------

export async function logActivity(
  type: ActivityType,
  message: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    const entries = await readLog();
    const entry: ActivityEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type,
      message,
      ...(meta ? { meta } : {}),
    };
    // Cel mai recent primul
    entries.unshift(entry);
    await writeLog(entries);
  } catch (e) {
    console.warn("[activity-log] Eroare la logActivity:", e);
  }
}

// ---------------------------------------------------------------------------
// Server function: citire log pentru UI
// ---------------------------------------------------------------------------

export const getActivityLog = createServerFn({ method: "GET" }).handler(
  async (): Promise<ActivityEntry[]> => {
    return readLog();
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
// Log pornire server
// ---------------------------------------------------------------------------

if (typeof process !== "undefined" && process.env) {
  // La pornirea modulului = server pornit
  logActivity("server_start", "Serverul FaikkitBox a pornit").catch(() => {});
}
