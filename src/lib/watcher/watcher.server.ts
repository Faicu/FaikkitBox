// ---------------------------------------------------------------------------
// Citirea și comanda Watcher-ului din Tehnic. Server functions rulează în altă
// copie a modulelor decât plugin-ul (vezi db.ts, watcher_tasks), deci totul
// trece prin bază: citim starea scrisă de tact și scriem pauza și cererile
// „Rulează acum”, pe care tactul le preia în cel mult o secundă.
// ---------------------------------------------------------------------------

import { getDb } from "../db";
import { WATCHER_TASKS, findWatcherTask } from "./tasks";
import type { WatcherRun, WatcherTaskStatus } from "./types";

interface TaskRow {
  id: string;
  next_run_at: number | null;
  paused: number;
  run_requested_at: number | null;
  running_since: number | null;
  running_manual: number;
  last_started_at: number | null;
  last_finished_at: number | null;
  last_duration_ms: number | null;
  last_ok: number | null;
  last_error: string | null;
  last_summary: string | null;
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export function readWatcherStatus(): WatcherTaskStatus[] {
  const rows = getDb().prepare("SELECT * FROM watcher_tasks").all() as unknown as TaskRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Ultima rulare reușită cu rezumat, per sarcină.
  const actions = getDb()
    .prepare(
      `SELECT r.task_id, r.finished_at, r.summary FROM watcher_runs r
        WHERE r.id = (SELECT MAX(id) FROM watcher_runs
                       WHERE task_id = r.task_id AND ok = 1 AND summary IS NOT NULL)`,
    )
    .all() as unknown as Array<{ task_id: string; finished_at: number; summary: string }>;
  const actionById = new Map(actions.map((a) => [a.task_id, a]));
  // Ordinea din registru, nu din bază — e și ordinea în care au sens citite.
  return WATCHER_TASKS.map((t) => {
    const r = byId.get(t.id);
    const action = actionById.get(t.id);
    return {
      id: t.id,
      label: t.label,
      delayMs: t.delayMs,
      everyMs: t.everyMs,
      group: t.group ?? null,
      cadenceLabel: t.cadenceLabel ?? null,
      controllable: t.controllable,
      paused: r?.paused === 1,
      requestedAt: iso(r?.run_requested_at ?? null),
      runningSince: iso(r?.running_since ?? null),
      runningManual: r?.running_manual === 1,
      nextRunAt: iso(r?.next_run_at ?? null),
      lastStartedAt: iso(r?.last_started_at ?? null),
      lastFinishedAt: iso(r?.last_finished_at ?? null),
      lastDurationMs: r?.last_duration_ms ?? null,
      lastOk: r?.last_ok === null || r?.last_ok === undefined ? null : r.last_ok === 1,
      lastError: r?.last_error ?? null,
      lastSummary: r?.last_summary ?? null,
      lastActionAt: iso(action?.finished_at ?? null),
      lastActionSummary: action?.summary ?? null,
    };
  });
}

export function readWatcherHistory(taskId: string): WatcherRun[] {
  const rows = getDb()
    .prepare(
      `SELECT id, started_at, finished_at, duration_ms, ok, manual, summary, error
         FROM watcher_runs WHERE task_id = ? ORDER BY id DESC LIMIT 20`,
    )
    .all(taskId) as unknown as Array<{
    id: number;
    started_at: number;
    finished_at: number;
    duration_ms: number;
    ok: number;
    manual: number;
    summary: string | null;
    error: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    startedAt: new Date(r.started_at).toISOString(),
    finishedAt: new Date(r.finished_at).toISOString(),
    durationMs: r.duration_ms,
    ok: r.ok === 1,
    manual: r.manual === 1,
    summary: r.summary,
    error: r.error,
  }));
}

function controllableTask(taskId: string) {
  const task = findWatcherTask(taskId);
  if (!task) throw new Error("Sarcină necunoscută");
  if (!task.controllable) throw new Error(`„${task.label}” rulează doar la pornire`);
  return task;
}

export function requestWatcherRun(taskId: string): void {
  controllableTask(taskId);
  getDb()
    .prepare("UPDATE watcher_tasks SET run_requested_at = ? WHERE id = ?")
    .run(Date.now(), taskId);
}

export function setWatcherPaused(taskId: string, paused: boolean): void {
  controllableTask(taskId);
  getDb()
    .prepare("UPDATE watcher_tasks SET paused = ? WHERE id = ?")
    .run(paused ? 1 : 0, taskId);
}
