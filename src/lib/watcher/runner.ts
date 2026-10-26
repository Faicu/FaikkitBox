// ---------------------------------------------------------------------------
// Motorul Watcher-ului: un singur tact, la o secundă, care pornește sarcinile
// din tasks.ts când le vine rândul.
//
// Tactul doar verifică — nu așteaptă nicio sarcină. Fiecare sarcină pornită
// devine o operațiune independentă, deci una lentă (subtitrări cu ffmpeg,
// minute întregi) nu le ține pe loc pe celelalte (sesiunile Plex, la 30s).
//
// La fiecare tact, pentru fiecare sarcină:
// - rulează deja → sare (garda de suprapunere, comună tuturor);
// - pe pauză → sare, cu excepția unei rulări cerute manual;
// - grupul ei e ocupat → rămâne scadentă și încearcă la tactul următor;
// - altfel, dacă e scadentă sau cerută manual → pornește.
//
// Starea stă în watcher_tasks (vezi db.ts): server functions din Tehnic o
// citesc de acolo și scriu tot acolo pauza și cererile „Rulează acum”, pe
// care tactul le citește la fiecare secundă. În memorie rămân doar
// operațiunile în curs — ce trebuie să știe exact procesul ăsta.
// ---------------------------------------------------------------------------

import { getDb } from "../db";
import { WATCHER_TASKS, type WatcherOutcome, type WatcherTask } from "./tasks";

const TICK_MS = 1000;
// Istoricul păstrează ultimele 20 de rulări care au făcut ceva, au eșuat sau
// au fost pornite manual. Rulările fără nimic de făcut se văd doar în starea
// sarcinii („Ultima rulare”) — altfel ar împinge afară din istoric tot ce
// contează: la sarcinile dese, 20 de rânduri ar acoperi câteva minute.
const HISTORY_KEEP = 20;
// Limitele orei cerute de o sarcină (WatcherOutcome.nextAt): nu mai devreme
// de un minut — o sarcină care cere mereu „acum” n-ar face altceva — și nu
// mai târziu de 25h, ca o oră greșită să nu oprească sarcina pe termen lung.
const NEXT_MIN_MS = 60_000;
const NEXT_MAX_MS = 25 * 60 * 60 * 1000;

const running = new Map<string, number>();
const nextAt = new Map<string, number>();
// Sarcinile chemate cu pokeWatcher cât rulau deja — pornesc din nou imediat
// după, ca semnalul să nu se piardă.
const poked = new Set<string>();

interface ControlRow {
  id: string;
  paused: number;
  run_requested_at: number | null;
}

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 500 ? `${msg.slice(0, 500)}…` : msg;
}

// La pornire: un rând pentru fiecare sarcină, rulările rămase „în curs” de la
// procesul anterior trecute în istoric ca întrerupte, și ora primei rulări.
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
           last_started_at = ?, last_finished_at = ?, last_duration_ms = ?,
           last_ok = 0, last_error = ?, last_summary = NULL
         WHERE id = ?`,
      ).run(row.running_since, now, now - row.running_since, error, task.id);
      prune(task.id);
    }

    // Ora salvată se păstrează peste un deploy; întârzierea de pornire se
    // aplică doar dacă sarcina e deja scadentă (sau n-a rulat niciodată).
    // Plafonată la un interval de acum: dacă intervalul s-a scurtat între
    // timp, ora veche n-ar trebui s-o amâne.
    const first =
      task.everyMs === null
        ? now + task.delayMs
        : Math.max(now + task.delayMs, Math.min(row.next_run_at ?? 0, now + task.everyMs));
    nextAt.set(task.id, first);
    db.prepare("UPDATE watcher_tasks SET next_run_at = ? WHERE id = ?").run(first, task.id);
  }
  // Cererile manuale rămase de dinainte de restart nu mai au pe cine să
  // aștepte — sarcina rulează oricum la ora ei.
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
    // Aceeași eroare ca la rularea precedentă (qBittorrent oprit, de exemplu,
    // la o sarcină de 10s) se raportează o singură dată: altfel ar umple
    // „Erori aplicație” și istoricul cu sute de rânduri identice. Starea
    // sarcinii o arată în continuare, până trece.
    repeated = isRepeatedError(task.id, error);
    if (!repeated) {
      console.warn(`[watcher] ${task.label} — rulare eșuată, se reia la următoarea:`, e);
    }
  }

  const finished = Date.now();
  // Ora cerută de sarcină (backup-ul știe că următorul e peste 14h) are
  // întâietate față de interval; o rulare eșuată revine la interval, ca să se
  // reîncerce la ritmul obișnuit.
  let next: number | null = null;
  if (poked.delete(task.id)) next = finished;
  else if (ok && requestedNext !== null)
    next = Math.min(Math.max(requestedNext, finished + NEXT_MIN_MS), finished + NEXT_MAX_MS);
  else if (task.everyMs !== null) next = finished + task.everyMs;
  if (next === null) nextAt.delete(task.id);
  else nextAt.set(task.id, next);
  running.delete(task.id);

  try {
    const db = getDb();
    db.prepare(
      `UPDATE watcher_tasks SET running_since = NULL, running_manual = 0, next_run_at = ?,
         last_started_at = ?, last_finished_at = ?, last_duration_ms = ?,
         last_ok = ?, last_error = ?, last_summary = ?
       WHERE id = ?`,
    ).run(next, started, finished, finished - started, ok ? 1 : 0, error, summary, task.id);

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

// O eroare la citirea bazei se repetă la fiecare secundă — o logăm cel mult o
// dată pe minut, nu de 60 de ori.
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
  const busyGroups = new Set(
    WATCHER_TASKS.filter((t) => t.group && running.has(t.id)).map((t) => t.group),
  );

  for (const task of WATCHER_TASKS) {
    if (running.has(task.id)) continue;
    const c = control.get(task.id);
    const manual = task.controllable && c?.run_requested_at != null;
    const at = nextAt.get(task.id);
    const due = at !== undefined && now >= at && !(task.controllable && c?.paused);
    if (!manual && !due) continue;
    if (task.group && busyGroups.has(task.group)) continue;
    if (task.group) busyGroups.add(task.group);
    void execute(task, manual);
  }
}

declare global {
  var __faikkitboxWatcherStarted: boolean | undefined;
  var __faikkitboxWatcherPoke: ((taskId: string) => void) | undefined;
}

// Pornește o sarcină la tactul următor, fără să mai aștepte intervalul — de
// exemplu urmărirea serialelor, imediat după ce pornești urmărirea unuia.
// Chemată prin globalThis (vezi poke.ts): server functions rulează în altă
// copie a modulelor, dar în același proces. Nu e „Rulează acum”: respectă
// pauza și nu apare ca manuală în istoric.
export function poke(taskId: string): void {
  if (!WATCHER_TASKS.some((t) => t.id === taskId)) return;
  if (running.has(taskId)) poked.add(taskId);
  else nextAt.set(taskId, Date.now());
}

export function startWatcher(): void {
  if (globalThis.__faikkitboxWatcherStarted) return;
  globalThis.__faikkitboxWatcherStarted = true;
  try {
    boot(Date.now());
  } catch (e) {
    // Fără starea din DB, sarcinile pornesc totuși după întârzierea lor —
    // mai bine fără istoric decât fără backup și fără urmărire.
    console.warn("[watcher] Pornirea din starea salvată a eșuat:", e);
    const now = Date.now();
    for (const t of WATCHER_TASKS) nextAt.set(t.id, now + t.delayMs);
  }
  globalThis.__faikkitboxWatcherPoke = poke;
  tick();
  setInterval(tick, TICK_MS).unref?.();
}
