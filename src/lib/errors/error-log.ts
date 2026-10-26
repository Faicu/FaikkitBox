import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type ErrorSource = "server-fn" | "ssr" | "client";
export type ErrorLevel = "warn" | "error";

export interface ErrorLogEntry {
  id: string;
  timestamp: string; // prima apariție a acestui grup (sursă+nivel+mesaj identic)
  lastSeen: string;
  source: ErrorSource;
  level: ErrorLevel;
  message: string;
  stack?: string;
  count: number;
}

const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 8000;
const MAX_ROWS = 1000;
const RETENTION_DAYS = 30;

// ---------------------------------------------------------------------------
// Limită globală: o buclă cu mesaje mereu diferite ar ocoli gruparea și ar
// bloca scrierea sincronă în SQLite.
// ---------------------------------------------------------------------------

const GLOBAL_WINDOW_MS = 60_000;
const GLOBAL_MAX_WRITES = 60;
let globalWindowStart = Date.now();
let globalWriteCount = 0;
let globalLimitNotified = false;

function globalRateLimitExceeded(): boolean {
  const now = Date.now();
  if (now - globalWindowStart > GLOBAL_WINDOW_MS) {
    globalWindowStart = now;
    globalWriteCount = 0;
    globalLimitNotified = false;
  }
  globalWriteCount++;
  return globalWriteCount > GLOBAL_MAX_WRITES;
}

// Clientul a închis conexiunea (tab închis, PWA reluată, rețea schimbată) — nu
// e o eroare a aplicației, dar din Node 26 ajunge la console.error ca `aborted`
// și trimitea push-uri degeaba.
export function isClientAbort(error: unknown): boolean {
  for (let e = error, depth = 0; e && typeof e === "object" && depth < 3; depth++) {
    const err = e as { message?: unknown; code?: unknown; cause?: unknown };
    if (err.message === "aborted" && err.code === "ECONNRESET") return true;
    e = err.cause;
  }
  return false;
}

export function logError(source: ErrorSource, error: unknown, level: ErrorLevel = "error"): void {
  if (isClientAbort(error)) return;
  try {
    const message = (error instanceof Error ? error.message : String(error)).slice(
      0,
      MAX_MESSAGE_LEN,
    );
    const stack = error instanceof Error ? error.stack?.slice(0, MAX_STACK_LEN) : undefined;

    if (globalRateLimitExceeded()) {
      if (!globalLimitNotified) {
        globalLimitNotified = true;
        writeGroupedRow(
          "server-fn",
          "error",
          "Prea multe erori în ultimul minut — logarea a fost suspendată temporar (protecție anti-flood).",
          undefined,
        );
      }
      return;
    }

    writeGroupedRow(source, level, message, stack);
  } catch {
    // Best-effort — handler-ul de erori nu are voie să arunce.
  }
}

// Erorile identice (sursă + nivel + mesaj) incrementează un contor pe același
// rând.
function writeGroupedRow(
  source: ErrorSource,
  level: ErrorLevel,
  message: string,
  stack: string | undefined,
): void {
  import("../db")
    .then(({ getDb }) => {
      const db = getDb();
      const now = new Date().toISOString();
      const existing = db
        .prepare("SELECT id FROM error_log WHERE source = ? AND level = ? AND message = ?")
        .get(source, level, message) as { id: string } | undefined;

      if (existing) {
        db.prepare(
          "UPDATE error_log SET count = count + 1, last_seen = ?, stack = COALESCE(?, stack) WHERE id = ?",
        ).run(now, stack ?? null, existing.id);
        return;
      }

      db.prepare(
        `INSERT INTO error_log (id, timestamp, last_seen, source, level, message, stack, count)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      ).run(randomUUID(), now, now, source, level, message, stack ?? null);

      sweepOldEntries(db);

      // Doar la un tip NOU de eroare, nu la repetări.
      notifyNewErrorGroup(source, level, message);
    })
    .catch(() => {});
}

let lastSweep = 0;
function sweepOldEntries(db: DatabaseSync): void {
  const now = Date.now();
  if (now - lastSweep < 10 * 60_000) return; // cel mult o dată la 10 minute
  lastSweep = now;
  try {
    db.prepare(
      `DELETE FROM error_log WHERE last_seen < datetime('now', '-${RETENTION_DAYS} days')`,
    ).run();
    db.prepare(
      `DELETE FROM error_log WHERE id NOT IN (
         SELECT id FROM error_log ORDER BY last_seen DESC LIMIT ${MAX_ROWS}
       )`,
    ).run();
  } catch {
    // best-effort
  }
}

// Jurnal + push la un tip nou de eroare, limitat separat — un incident cu multe
// erori diferite nu trimite zeci de push-uri.
const NOTIFY_WINDOW_MS = 10 * 60_000;
const NOTIFY_MAX = 5;
let notifyWindowStart = Date.now();
let notifyCount = 0;

function notifyNewErrorGroup(source: ErrorSource, level: ErrorLevel, message: string): void {
  const now = Date.now();
  if (now - notifyWindowStart > NOTIFY_WINDOW_MS) {
    notifyWindowStart = now;
    notifyCount = 0;
  }
  notifyCount++;
  if (notifyCount > NOTIFY_MAX) return;

  const sourceLabel = source === "ssr" ? "SSR" : source === "client" ? "Browser" : "Server";
  const levelLabel = level === "warn" ? "Avertisment" : "Eroare";
  import("../activity-log")
    .then(({ logActivity }) =>
      logActivity("app_error", `${levelLabel} [${sourceLabel}]: ${message}`, { source, level }),
    )
    .catch(() => {});
}

function rowToEntry(r: {
  id: string;
  timestamp: string;
  last_seen: string;
  source: string;
  level: string;
  message: string;
  stack: string | null;
  count: number;
}): ErrorLogEntry {
  return {
    id: r.id,
    timestamp: r.timestamp,
    lastSeen: r.last_seen,
    source: r.source as ErrorSource,
    level: r.level as ErrorLevel,
    message: r.message,
    stack: r.stack ?? undefined,
    count: r.count,
  };
}

// Server functions sunt în error-log.functions.ts — aici rămân funcțiile
// simple, cu importuri server statice.

export async function readErrorLogs(): Promise<ErrorLogEntry[]> {
  const { getDb } = await import("../db");
  const rows = getDb()
    .prepare(
      `SELECT id, timestamp, last_seen, source, level, message, stack, count
       FROM error_log ORDER BY last_seen DESC LIMIT 500`,
    )
    .all() as unknown as Parameters<typeof rowToEntry>[0][];
  return rows.map(rowToEntry);
}

export async function clearErrorLogsCore(): Promise<void> {
  const { getDb } = await import("../db");
  getDb().exec("DELETE FROM error_log");
}

// Max 20 de rapoarte de eroare client pe minut per IP — gruparea pe mesaj se
// ocolește variind mesajul.
const clientErrorHits = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

export function recordClientError(
  ip: string,
  message: string,
  stack: string | undefined,
  level: ErrorLevel,
): void {
  const now = Date.now();
  const hit = clientErrorHits.get(ip);
  if (!hit || now - hit.windowStart > RATE_LIMIT_WINDOW_MS) {
    clientErrorHits.set(ip, { count: 1, windowStart: now });
  } else {
    hit.count++;
    if (hit.count > RATE_LIMIT_MAX) return;
  }

  const err = new Error(message.slice(0, MAX_MESSAGE_LEN));
  if (stack) err.stack = stack.slice(0, MAX_STACK_LEN);
  logError("client", err, level);
}
