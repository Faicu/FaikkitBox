// ---------------------------------------------------------------------------
// Motorul Watcher-ului: un tact la o secundă care pornește sarcinile din
// tasks.ts când le vine rândul. Tactul nu așteaptă nicio sarcină — fiecare e o
// operațiune independentă, deci una lentă nu le ține pe loc pe celelalte.
//
// Starea stă în watcher_tasks: server functions din Tehnic o citesc de acolo
// și scriu acolo pauza și „Rulează acum”, citite de tact la fiecare secundă.
// În memorie rămân doar operațiunile în curs.
// ---------------------------------------------------------------------------

import { getDb } from "../db";
import { WATCHER_TASKS, type WatcherOutcome, type WatcherTask } from "./tasks";

const TICK_MS = 1000;
// Istoricul: ultimele 20 de rulări care au făcut ceva, au eșuat sau au fost
// manuale — cele goale ar împinge afară tot ce contează.
const HISTORY_KEEP = 20;
// Limitele orei cerute de o sarcină: cel puțin un minut (fără bucle), cel mult
// 25h (o oră greșită nu oprește sarcina pe termen lung).
const NEXT_MIN_MS = 60_000;
const NEXT_MAX_MS = 25 * 60 * 60 * 1000;

const running = new Map<string, number>();
const nextAt = new Map<string, number>();
// pokeWatcher primit cât sarcina rula — rularea următoare vine cel târziu atunci.
const poked = new Map<string, number>();

interface ControlRow {
  id: string;
  paused: number;
  run_requested_at: number | null;
}

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 500 ? `${msg.slice(0, 500)}…` : msg;
}

// La pornire: un rând per sarcină, rulările rămase „în curs” trecute ca
// întrerupte, și ora primei rulări.
export function boot(now: number): void {
  const db = getDb();
  db.prepare(
    `DELETE FROM watcher_tasks WHERE id NOT IN (${WATCHER_TASKS.map(() => "?").join(",")})`,
  ).run(...WATCHER_TASKS.map((t) => t.id));

  for (const task of WATCHER_TASKS) {
    db.prepare("INSERT OR IGNORE INTO watcher_tasks (id) VALUES (?)").run(task.id);
    const row = db
      .prepare("SELECT next_run_at, running_since, running_manual FROM watcher_tasks WHERE id = ?")
      .get(task.id) as {
      next_run_at: number | null;
      running_since: number | null;
      running_manual: number;
    };

    if (row.running_since !== null) {
      const error = "întreruptă de o repornire a serverului";
      db.prepare(
        `INSERT INTO watcher_runs (task_id, started_at, finished_at, duration_ms, ok, manual, error)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      ).run(task.id, row.running_since, now, now - row.running_since, row.running_manual, error);
      db.prepare(
        `UPDATE watcher_tasks SET running_since = NULL, running_manual = 0,
           last_finished_at = ?, last_duration_ms = ?, last_ok = 0, last_error = ?
         WHERE id = ?`,
      ).run(now, now - row.running_since, error, task.id);
      prune(task.id);
    }

    // Ora salvată rămâne peste un deploy; întârzierea de pornire se aplică doar
    // dacă e depășită. Plafonul e 25h, nu intervalul: la backup intervalul e
    // doar reîncercarea (1h) și ar scurta ora cerută (23h) după fiecare deploy.
    const first =
      task.everyMs === null
        ? now + task.delayMs
        : Math.max(now + task.delayMs, Math.min(row.next_run_at ?? 0, now + NEXT_MAX_MS));
    nextAt.set(task.id, first);
    db.prepare("UPDATE watcher_tasks SET next_run_at = ? WHERE id = ?").run(first, task.id);
  }
  // Cererile manuale de dinainte de restart nu mai au pe cine să aștepte.
  db.prepare("UPDATE watcher_tasks SET run_requested_at = NULL").run();
}

function prune(taskId: string): void {
  getDb()
    .prepare(
      `DELETE FROM watcher_runs WHERE task_id = ? AND id NOT IN (
         SELECT id FROM watcher_runs WHERE task_id = ? ORDER BY id DESC LIMIT ?)`,
    )
    .run(taskId, taskId, HISTORY_KEEP);
}

function isRepeatedError(taskId: string, error: string): boolean {
  try {
    const prev = getDb()
      .prepare("SELECT last_ok, last_error FROM watcher_tasks WHERE id = ?")
      .get(taskId) as { last_ok: number | null; last_error: string | null } | undefined;
    return prev?.last_ok === 0 && prev.last_error === error;
  } catch {
    return false;
  }
}

async function execute(task: WatcherTask, manual: boolean): Promise<void> {
  const started = Date.now();
  running.set(task.id, started);
  try {
    getDb()
      .prepare(
        `UPDATE watcher_tasks SET running_since = ?, running_manual = ?,
           run_requested_at = CASE WHEN ? THEN NULL ELSE run_requested_at END
         WHERE id = ?`,
      )
      .run(started, manual ? 1 : 0, manual ? 1 : 0, task.id);
  } catch (e) {
    console.warn(`[watcher] Starea sarcinii „${task.label}” nu s-a putut scrie:`, e);
  }

  let ok = true;
  let summary: string | null = null;
  let requestedNext: number | null = null;
  let error: string | null = null;
  let repeated = false;
  try {
    const out: WatcherOutcome = await task.run({ manual });
    if (out !== null && typeof out === "object") {
      summary = out.summary;
      requestedNext = out.nextAt;
    } else {
      summary = out;
    }
  } catch (e) {
    ok = false;
    error = errorText(e);
    // Aceeași eroare ca data trecută se raportează o singură dată — altfel o
    // sarcină de 10s ar umple „Erori aplicație” cât e qBittorrent oprit.
    repeated = isRepeatedError(task.id, error);
    if (!repeated) {
      console.warn(`[watcher] ${task.label} — rulare eșuată, se reia la următoarea:`, e);
    }
  }

  const finished = Date.now();
  // Ora cerută de sarcină are întâietate; o rulare eșuată revine la interval.
  let next: number | null = null;
  if (ok && requestedNext !== null)
    next = Math.min(Math.max(requestedNext, finished + NEXT_MIN_MS), finished + NEXT_MAX_MS);
  else if (task.everyMs !== null) next = finished + task.everyMs;
  const pokedAt = poked.get(task.id);
  if (pokedAt !== undefined) {
    poked.delete(task.id);
    next = Math.min(next ?? Infinity, Math.max(pokedAt, finished));
  }
  if (next === null) nextAt.delete(task.id);
  else nextAt.set(task.id, next);
  running.delete(task.id);

  try {
    const db = getDb();
    db.prepare(
      `UPDATE watcher_tasks SET running_since = NULL, running_manual = 0, next_run_at = ?,
         last_finished_at = ?, last_duration_ms = ?, last_ok = ?, last_error = ?
       WHERE id = ?`,
    ).run(next, finished, finished - started, ok ? 1 : 0, error, task.id);

    if (!repeated && (manual || !ok || summary !== null)) {
      db.prepare(
        `INSERT INTO watcher_runs (task_id, started_at, finished_at, duration_ms, ok, manual, summary, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        task.id,
        started,
        finished,
        finished - started,
        ok ? 1 : 0,
        manual ? 1 : 0,
        summary,
        error,
      );
      prune(task.id);
    }
  } catch (e) {
    console.warn(`[watcher] Rezultatul sarcinii „${task.label}” nu s-a putut scrie:`, e);
  }
}

// Eroarea de citire se repetă la fiecare secundă — logată cel mult o dată pe minut.
let lastTickWarn = 0;

// Exportată (ca și boot și poke) pentru teste — runner.test.ts.
export function tick(): void {
  let control: Map<string, ControlRow>;
  try {
    const rows = getDb()
      .prepare("SELECT id, paused, run_requested_at FROM watcher_tasks")
      .all() as unknown as ControlRow[];
    control = new Map(rows.map((r) => [r.id, r]));
  } catch (e) {
    if (Date.now() - lastTickWarn > 60_000) {
      lastTickWarn = Date.now();
      console.warn("[watcher] Tactul nu poate citi starea sarcinilor:", e);
    }
    // Fără pauze și cereri manuale, dar sarcinile își continuă ritmul.
    control = new Map();
  }

  const now = Date.now();

  for (const task of WATCHER_TASKS) {
    if (running.has(task.id)) continue;
    const c = control.get(task.id);
    const manual = task.controllable && c?.run_requested_at != null;
    const at = nextAt.get(task.id);
    const due = at !== undefined && now >= at && !(task.controllable && c?.paused);
    if (!manual && !due) continue;
    void execute(task, manual);
  }
}

declare global {
  var __faikkitboxWatcherStarted: boolean | undefined;
  var __faikkitboxWatcherPoke: ((taskId: string, delayMs?: number) => void) | undefined;
}

// Aduce rularea unei sarcini cel târziu la `delayMs` de acum, fără s-o amâne
// vreodată. Chemată prin globalThis (poke.ts): server functions rulează în
// altă copie a modulelor, dar în același proces. Respectă pauza.
export function poke(taskId: string, delayMs = 0): void {
  if (!WATCHER_TASKS.some((t) => t.id === taskId)) return;
  const at = Date.now() + delayMs;
  if (running.has(taskId)) {
    poked.set(taskId, Math.min(poked.get(taskId) ?? Infinity, at));
    return;
  }
  const next = Math.min(nextAt.get(taskId) ?? Infinity, at);
  nextAt.set(taskId, next);
  try {
    getDb().prepare("UPDATE watcher_tasks SET next_run_at = ? WHERE id = ?").run(next, taskId);
  } catch {
    // Doar afișarea orei următoare rămâne în urmă; rularea vine oricum.
  }
}

export function startWatcher(): void {
  if (globalThis.__faikkitboxWatcherStarted) return;
  globalThis.__faikkitboxWatcherStarted = true;
  try {
    boot(Date.now());
  } catch (e) {
    // Fără starea din DB, sarcinile pornesc totuși după întârzierea lor.
    console.warn("[watcher] Pornirea din starea salvată a eșuat:", e);
    const now = Date.now();
    for (const t of WATCHER_TASKS) nextAt.set(t.id, now + t.delayMs);
  }
  globalThis.__faikkitboxWatcherPoke = poke;
  tick();
  setInterval(tick, TICK_MS).unref?.();
}
