import { createServerFn } from "@tanstack/react-start";
import { randomUUID } from "node:crypto";
import { getPlexDb } from "./plex-db";

export type ErrorSource = "server-fn" | "ssr" | "client";
export type ErrorLevel = "warn" | "error";

export function logError(source: ErrorSource, error: unknown, level: ErrorLevel = "error"): void {
  try {
    const db = getPlexDb();
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? (error.stack ?? null) : null;
    const existing = db
      .prepare("SELECT id, count FROM error_log WHERE source = ? AND level = ? AND message = ?")
      .get(source, level, message) as { id: string; count: number } | undefined;
    if (existing) {
      db.prepare(
        "UPDATE error_log SET count = ?, last_seen = datetime('now'), timestamp = datetime('now') WHERE id = ?",
      ).run(existing.count + 1, existing.id);
    } else {
      db.prepare(
        `INSERT INTO error_log (id, timestamp, source, level, message, stack, count, last_seen)
         VALUES (?, datetime('now'), ?, ?, ?, ?, 1, datetime('now'))`,
      ).run(randomUUID(), source, level, message, stack);
    }
  } catch (e) {
    console.warn("[plex/error-log] eșuat:", e);
  }
}

export const getErrorLogs = createServerFn({ method: "GET" }).handler(async () => {
  const db = getPlexDb();
  return db.prepare("SELECT * FROM error_log ORDER BY timestamp DESC LIMIT 200").all();
});

export const clearErrorLogs = createServerFn({ method: "POST" }).handler(async () => {
  const db = getPlexDb();
  db.prepare("DELETE FROM error_log").run();
  return { status: "ok" as const };
});

export const logClientError = createServerFn({ method: "POST" })
  .validator((data: { message: string; stack?: string }) => data)
  .handler(async ({ data }) => {
    logError("client", new Error(data.message));
    return { status: "ok" as const };
  });
