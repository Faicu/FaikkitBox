// Server functions pentru Watcher (Tehnic). Doar importuri leneșe în
// handlere — vezi regula din STRUCTURE.md despre *.functions.ts.

import { createServerFn } from "@tanstack/react-start";

import type { WatcherRun, WatcherTaskStatus } from "./types";

export type { WatcherRun, WatcherTaskStatus } from "./types";

export const getWatcherStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<WatcherTaskStatus[]> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { readWatcherStatus } = await import("./watcher.server");
    return readWatcherStatus();
  },
);

export const getWatcherHistory = createServerFn({ method: "GET" })
  .validator((data: { taskId: string }) => data)
  .handler(async ({ data }): Promise<WatcherRun[]> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { readWatcherHistory } = await import("./watcher.server");
    return readWatcherHistory(data.taskId);
  });

export const runWatcherTaskNow = createServerFn({ method: "POST" })
  .validator((data: { taskId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { requestWatcherRun } = await import("./watcher.server");
    requestWatcherRun(data.taskId);
    return { ok: true };
  });

export const setWatcherTaskPaused = createServerFn({ method: "POST" })
  .validator((data: { taskId: string; paused: boolean }) => data)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { setWatcherPaused } = await import("./watcher.server");
    setWatcherPaused(data.taskId, data.paused);
    return { ok: true };
  });
