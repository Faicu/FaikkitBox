// Server functions pentru pagina /vw, separate de vw-log.ts (importuri server
// statice) — vezi regula din STRUCTURE.md despre *.functions.ts.

import { createServerFn } from "@tanstack/react-start";

export type { VwLogEntry } from "./vw-log";
import type { VwLogEntry } from "./vw-log";

export const getVwLog = createServerFn({ method: "GET" }).handler(
  async (): Promise<VwLogEntry[]> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { readVwLog } = await import("./vw-log");
    return readVwLog();
  },
);

export const clearVwLog = createServerFn({ method: "POST" }).handler(async () => {
  const { requireAdmin } = await import("../auth/admin.server");
  await requireAdmin();
  const { clearVwLogCore } = await import("./vw-log");
  clearVwLogCore();
});
