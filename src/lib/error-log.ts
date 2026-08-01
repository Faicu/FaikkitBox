import { createServerFn } from "@tanstack/react-start";
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
// Rate limit global: protejează scrierea sincronă în SQLite de o buclă care
// ar loga erori cu mesaj mereu diferit (dedup-ul pe grup n-ar ajuta în acel
// caz, fiindcă fiecare mesaj ar forma un grup nou).
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

export function logError(source: ErrorSource, error: unknown, level: ErrorLevel = "error"): void {
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
    // logare best-effort — nu trebuie să blocăm/arunce din handler-ul de erori
  }
}

// Grupare: erori identice (sursă + nivel + mesaj) incrementează un contor pe
// același rând, în loc să umple jurnalul cu duplicate — utilă mai ales acum
// că orice console.warn/error din toată aplicația e captat automat.
function writeGroupedRow(
  source: ErrorSource,
  level: ErrorLevel,
  message: string,
  stack: string | undefined,
): void {
  import("./db")
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

      // Doar la apariția unui tip NOU de eroare, nu la repetări — altfel o
      // eroare care se repetă des ar inunda jurnalul de activitate și push.
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

// Notificare (Jurnal de activitate + push) la apariția unui tip nou de
// eroare — rate-limitată separat de scrierea în DB, ca o cascadă de erori
// diferite (ex. la un incident real) să nu trimită zeci de push-uri deodată.
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
  import("./activity-log")
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

export const getErrorLogs = createServerFn({ method: "GET" }).handler(
  async (): Promise<ErrorLogEntry[]> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();
    const { getDb } = await import("./db");
    const rows = getDb()
      .prepare(
        `SELECT id, timestamp, last_seen, source, level, message, stack, count
         FROM error_log ORDER BY last_seen DESC LIMIT 500`,
      )
      .all() as unknown as Parameters<typeof rowToEntry>[0][];
    return rows.map(rowToEntry);
  },
);

export const clearErrorLogs = createServerFn({ method: "POST" }).handler(async () => {
  const { requireAdmin } = await import("./admin.server");
  await requireAdmin();
  const { getDb } = await import("./db");
  getDb().exec("DELETE FROM error_log");
});

// Limitare per-IP: max 20 rapoarte de eroare client pe minut, indiferent de mesaj
// — logError are deja o dedublare per (sursă+mesaj), dar aceea poate fi ocolită
// variind mesajul; asta limitează volumul total de la o singură sursă.
const clientErrorHits = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

export const logClientError = createServerFn({ method: "POST" })
  .validator((data: { message: string; stack?: string; level?: ErrorLevel }) => data)
  .handler(async ({ data }) => {
    const { getRequestIP } = await import("@tanstack/react-start/server");
    const ip = getRequestIP() ?? "unknown";
    const now = Date.now();
    const hit = clientErrorHits.get(ip);
    if (!hit || now - hit.windowStart > RATE_LIMIT_WINDOW_MS) {
      clientErrorHits.set(ip, { count: 1, windowStart: now });
    } else {
      hit.count++;
      if (hit.count > RATE_LIMIT_MAX) return;
    }

    const err = new Error(data.message.slice(0, MAX_MESSAGE_LEN));
    if (data.stack) err.stack = data.stack.slice(0, MAX_STACK_LEN);
    logError("client", err, data.level ?? "error");
  });
