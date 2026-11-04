// Server functions pentru verificarea trackerelor qBittorrent, separate de
// qbit-tracker-check.ts (importă db) — vezi regula din STRUCTURE.md.

import { createServerFn } from "@tanstack/react-start";

import type { TrackerCheckStatus } from "./qbit-tracker-check";

export type {
  TrackerCheckItem,
  TrackerCheckStatus,
  TrackerLine,
  TrackerVerdict,
} from "./qbit-tracker-check";

export const getTrackerCheck = createServerFn({ method: "GET" }).handler(
  async (): Promise<TrackerCheckStatus> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { getTrackerCheckStatus } = await import("./qbit-tracker-check");
    return getTrackerCheckStatus();
  },
);

export const startTrackerCheck = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: boolean; error?: string }> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { startTrackerCheck, TrackerCheckRejected } = await import("./qbit-tracker-check");
    try {
      startTrackerCheck();
      return { ok: true };
    } catch (e) {
      if (e instanceof TrackerCheckRejected || e instanceof Error)
        return { ok: false, error: e.message };
      throw e;
    }
  },
);
