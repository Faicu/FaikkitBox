import { createServerFn } from "@tanstack/react-start";
import { randomUUID } from "node:crypto";

export type ErrorSource = "server-fn" | "ssr" | "client";

export interface ErrorLogEntry {
  id: string;
  timestamp: string;
  source: ErrorSource;
  message: string;
  stack?: string;
}

// Deduplicare: nu logăm aceeași eroare (sursă + mesaj) de mai multe ori în 10 secunde,
// util pentru buclele de retry care ar putea umple jurnalul rapid.
const recentKeys = new Map<string, number>();
const DEDUPE_MS = 10_000;

export function logError(source: ErrorSource, error: unknown): void {
  try {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    const key = `${source}|${message}`;
    const now = Date.now();
    const last = recentKeys.get(key);
    if (last && now - last < DEDUPE_MS) return;
    recentKeys.set(key, now);

    import("./db")
      .then(({ getDb }) => {
        getDb()
          .prepare(
            "INSERT INTO error_log (id, timestamp, source, message, stack) VALUES (?, ?, ?, ?, ?)",
          )
          .run(randomUUID(), new Date().toISOString(), source, message, stack ?? null);
      })
      .catch(() => {});
  } catch {
    // logare best-effort — nu trebuie să blocăm/arunce din handler-ul de erori
  }
}

export const getErrorLogs = createServerFn({ method: "GET" }).handler(
  async (): Promise<ErrorLogEntry[]> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();
    const { getDb } = await import("./db");
    const rows = getDb()
      .prepare(
        "SELECT id, timestamp, source, message, stack FROM error_log ORDER BY timestamp DESC LIMIT 500",
      )
      .all() as unknown as ErrorLogEntry[];
    return rows;
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
const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 8000;

export const logClientError = createServerFn({ method: "POST" })
  .validator((data: { message: string; stack?: string }) => data)
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
    logError("client", err);
  });
