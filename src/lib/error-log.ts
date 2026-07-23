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
      .all() as ErrorLogEntry[];
    return rows;
  },
);

export const clearErrorLogs = createServerFn({ method: "POST" }).handler(async () => {
  const { requireAdmin } = await import("./admin.server");
  await requireAdmin();
  const { getDb } = await import("./db");
  getDb().exec("DELETE FROM error_log");
});

export const logClientError = createServerFn({ method: "POST" })
  .validator((data: { message: string; stack?: string }) => data)
  .handler(async ({ data }) => {
    const err = new Error(data.message);
    if (data.stack) err.stack = data.stack;
    logError("client", err);
  });
