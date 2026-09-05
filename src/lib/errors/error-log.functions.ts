// ---------------------------------------------------------------------------
// Server functions pentru Erori aplicație, separate de error-log.ts.
//
// error-log.ts are importuri server statice (node:crypto, node:sqlite) și era
// una dintre rădăcinile care târau cod server în bundle-ul public — __root.tsx
// (deci FIECARE pagină) importa logClientError direct din el.
//
// Corpul unui handler de server function e eliminat din bundle-ul de client,
// deci importurile dinamice de aici rămân exclusiv pe server.
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";

export type { ErrorLogEntry, ErrorSource, ErrorLevel } from "./error-log";
import type { ErrorLogEntry, ErrorLevel } from "./error-log";

export const getErrorLogs = createServerFn({ method: "GET" }).handler(
  async (): Promise<ErrorLogEntry[]> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { readErrorLogs } = await import("./error-log");
    return readErrorLogs();
  },
);

export const clearErrorLogs = createServerFn({ method: "POST" }).handler(async () => {
  const { requireAdmin } = await import("../auth/admin.server");
  await requireAdmin();
  const { clearErrorLogsCore } = await import("./error-log");
  await clearErrorLogsCore();
});

// Fără gard de autentificare, intenționat: raportează erorile de JS din
// browser, inclusiv de pe paginile publice. Limitarea per IP (20/minut) e în
// recordClientError.
export const logClientError = createServerFn({ method: "POST" })
  .validator((data: { message: string; stack?: string; level?: ErrorLevel }) => data)
  .handler(async ({ data }) => {
    const { getRequestIP } = await import("@tanstack/react-start/server");
    const { recordClientError } = await import("./error-log");
    recordClientError(
      getRequestIP() ?? "unknown",
      data.message,
      data.stack,
      data.level ?? "error",
    );
  });
