// Verifică trackerele fiecărui torrent din qBittorrent, ca să prindă cele șterse
// de pe Filelist („Unregistered torrent”). Server-only; server function-urile
// sunt în qbit-tracker-check.functions.ts.
//
// Un torrent oprit nu face announce, deci statusul lui nu spune nimic: cele
// oprite se pornesc temporar, se forțează reannounce, se așteaptă răspunsul
// trackerelor și se opresc la loc (decizia userului, 4 nov. 2026). Hash-urile
// pornite de noi stau în DB (`resumed`) — dacă procesul moare la mijloc, la
// repornire se opresc la loc.

import { getDb } from "../db";
import { torrentDisplay } from "../media/torrent-display";
import { qbitGet, qbitPostForm, resetQbitCookie } from "../qbit-client";
import { errMsg, stripSlash } from "./shared";

export type TrackerVerdict = "ok" | "removed" | "down" | "unknown";

export interface TrackerLine {
  url: string;
  status: number;
  msg: string;
}

export interface TrackerCheckItem {
  hash: string;
  name: string;
  // Numele din `media` (format unic), dacă torrentul e cunoscut.
  label: string | null;
  verdict: Exclude<TrackerVerdict, "ok">;
  message: string;
  wasStopped: boolean;
  trackers: TrackerLine[];
}

export interface TrackerCheckStatus {
  running: boolean;
  phase: string | null;
  done: number;
  total: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  counts: { ok: number; removed: number; down: number; unknown: number } | null;
  // Doar torrentele cu probleme.
  items: TrackerCheckItem[];
}

interface QbitCreds {
  url: string;
  user: string;
  pass: string;
}

const CONCURRENCY = 6;
const FIRST_READ_DELAY_MS = 6_000;
const POLL_EVERY_MS = 4_000;
const MAX_WAIT_MS = 60_000;
// O rulare mai veche de atât a murit fără să se curețe.
const STALE_RUN_MS = 15 * 60_000;

// libtorrent: 0 dezactivat, 1 necontactat, 2 funcționează, 3 se actualizează, 4 nu funcționează.
const REMOVED_RE =
  /unregistered|not registered|torrent not found|not exist|deleted|nuked|invalid info.?hash/i;

export function isRealTracker(t: TrackerLine): boolean {
  // DHT / PeX / LSD apar ca „** [DHT] **”.
  return !t.url.startsWith("**") && t.status !== 0;
}

export function classifyTrackers(trackers: TrackerLine[]): {
  verdict: TrackerVerdict;
  message: string;
} {
  const real = trackers.filter(isRealTracker);
  if (real.some((t) => t.status === 2)) return { verdict: "ok", message: "" };
  const failed = real.filter((t) => t.status === 4);
  const removed = failed.find((t) => REMOVED_RE.test(t.msg));
  if (removed) return { verdict: "removed", message: removed.msg };
  if (failed.length > 0) {
    return { verdict: "down", message: failed.find((t) => t.msg)?.msg || "tracker indisponibil" };
  }
  return { verdict: "unknown", message: "trackerele nu au răspuns" };
}

// Încă n-avem un răspuns final de la tracker.
function isPending(trackers: TrackerLine[]): boolean {
  const real = trackers.filter(isRealTracker);
  return real.length === 0 || real.some((t) => t.status === 1 || t.status === 3);
}

function creds(): QbitCreds {
  const base = process.env.QBIT_URL;
  const user = process.env.QBIT_USERNAME;
  const pass = process.env.QBIT_PASSWORD;
  if (!base || !user || !pass) throw new Error("qBittorrent nu e configurat");
  return { url: stripSlash(base), user, pass };
}

function ensureRow(): void {
  getDb().prepare("INSERT OR IGNORE INTO qbit_tracker_check (id) VALUES (1)").run();
}

interface Row {
  running: number;
  phase: string | null;
  done: number;
  total: number;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  result: string | null;
  resumed: string;
}

function readRow(): Row {
  ensureRow();
  return getDb().prepare("SELECT * FROM qbit_tracker_check WHERE id = 1").get() as unknown as Row;
}

export function getTrackerCheckStatus(): TrackerCheckStatus {
  const r = readRow();
  const stale =
    r.running === 1 && r.started_at && Date.now() - Date.parse(r.started_at) > STALE_RUN_MS;
  let parsed: { counts: TrackerCheckStatus["counts"]; items: TrackerCheckItem[] } | null;
  try {
    parsed = r.result ? JSON.parse(r.result) : null;
  } catch {
    parsed = null;
  }
  return {
    running: r.running === 1 && !stale,
    phase: r.phase,
    done: r.done,
    total: r.total,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    error: r.error,
    counts: parsed?.counts ?? null,
    items: parsed?.items ?? [],
  };
}

function setProgress(phase: string, done: number, total: number): void {
  getDb()
    .prepare("UPDATE qbit_tracker_check SET phase = ?, done = ?, total = ? WHERE id = 1")
    .run(phase, done, total);
}

// pause/resume (qBit 4) sau stop/start (qBit 5) — același 404-fallback ca în qbitAction.
async function setRunning(c: QbitCreds, hashes: string[], run: boolean): Promise<void> {
  if (hashes.length === 0) return;
  const form = { hashes: hashes.join("|") };
  const primary = run ? "/api/v2/torrents/resume" : "/api/v2/torrents/pause";
  const fallback = run ? "/api/v2/torrents/start" : "/api/v2/torrents/stop";
  let res = await qbitPostForm(c.url, primary, c.user, c.pass, form);
  if (res.status === 404) res = await qbitPostForm(c.url, fallback, c.user, c.pass, form);
  if (!res.ok) throw new Error(`qBit ${run ? "pornire" : "oprire"}: HTTP ${res.status}`);
}

async function readTrackers(c: QbitCreds, hash: string): Promise<TrackerLine[]> {
  const res = await qbitGet(c.url, `/api/v2/torrents/trackers?hash=${hash}`, c.user, c.pass);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = (await res.json()) as Array<{ url?: string; status?: number; msg?: string }>;
  return raw.map((t) => ({ url: t.url ?? "", status: t.status ?? 0, msg: (t.msg ?? "").trim() }));
}

async function mapLimited<T>(list: T[], fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const worker = async () => {
    while (i < list.length) await fn(list[i++]);
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Oprește la loc torrentele pornite de noi. Apelată în `finally` și la pornirea
// serverului (rulare întreruptă de restart).
export async function restoreResumedTorrents(): Promise<void> {
  const r = readRow();
  const hashes = JSON.parse(r.resumed) as string[];
  if (hashes.length === 0) return;
  await setRunning(creds(), hashes, false);
  getDb().prepare("UPDATE qbit_tracker_check SET resumed = '[]' WHERE id = 1").run();
}

// La pornire: o rulare rămasă „running” a murit cu procesul anterior.
export async function recoverTrackerCheck(): Promise<void> {
  const r = readRow();
  if (r.running === 1) {
    getDb()
      .prepare(
        "UPDATE qbit_tracker_check SET running = 0, error = 'Întreruptă de o repornire', finished_at = ? WHERE id = 1",
      )
      .run(new Date().toISOString());
  }
  try {
    await restoreResumedTorrents();
  } catch (e) {
    console.warn("[tracker-check] torrentele pornite temporar n-au putut fi oprite:", errMsg(e));
  }
}

export class TrackerCheckRejected extends Error {}

// Pornește verificarea în fundal; revine imediat. Progresul se citește din DB.
export function startTrackerCheck(): void {
  const c = creds();
  if (getTrackerCheckStatus().running) throw new TrackerCheckRejected("Verificarea rulează deja");
  const db = getDb();
  db.prepare(
    `UPDATE qbit_tracker_check
        SET running = 1, phase = 'Se citesc torrentele', done = 0, total = 0,
            started_at = ?, finished_at = NULL, error = NULL
      WHERE id = 1`,
  ).run(new Date().toISOString());
  runCheck(c)
    .catch((e) => {
      resetQbitCookie();
      db.prepare("UPDATE qbit_tracker_check SET error = ? WHERE id = 1").run(errMsg(e));
    })
    .finally(() => {
      db.prepare(
        "UPDATE qbit_tracker_check SET running = 0, phase = NULL, finished_at = ? WHERE id = 1",
      ).run(new Date().toISOString());
    });
}

async function runCheck(c: QbitCreds): Promise<void> {
  // Rămășițe dintr-o rulare anterioară, înainte să pornim altele.
  await restoreResumedTorrents();

  const res = await qbitGet(c.url, "/api/v2/torrents/info", c.user, c.pass);
  if (!res.ok) throw new Error(`qBittorrent: HTTP ${res.status}`);
  const torrents = (await res.json()) as Array<{ hash: string; name: string; state: string }>;
  const stopped = new Set(
    torrents.filter((t) => /^(paused|stopped)/i.test(t.state)).map((t) => t.hash),
  );
  // Fără fișiere / în eroare: nu se pornesc, doar se raportează.
  const broken = new Map(
    torrents.filter((t) => /^(error|missingfiles)/i.test(t.state)).map((t) => [t.hash, t.state]),
  );
  const checkable = torrents.filter((t) => !broken.has(t.hash));
  const total = torrents.length;
  const db = getDb();
  const lines = new Map<string, TrackerLine[]>();

  try {
    if (stopped.size > 0) {
      setProgress(`Se pornesc temporar ${stopped.size} torrente oprite`, 0, total);
      db.prepare("UPDATE qbit_tracker_check SET resumed = ? WHERE id = 1").run(
        JSON.stringify([...stopped]),
      );
      await setRunning(c, [...stopped], true);
    }

    setProgress("Reannounce către trackere", 0, total);
    const hashes = checkable.map((t) => t.hash);
    if (hashes.length > 0) {
      const r = await qbitPostForm(c.url, "/api/v2/torrents/reannounce", c.user, c.pass, {
        hashes: hashes.join("|"),
      });
      if (!r.ok) throw new Error(`reannounce: HTTP ${r.status}`);
    }

    // Statusul vechi rămâne vizibil până pornește announce-ul.
    await sleep(FIRST_READ_DELAY_MS);
    let pending = hashes;
    const t0 = Date.now();
    for (;;) {
      await mapLimited(pending, async (h) => {
        try {
          lines.set(h, await readTrackers(c, h));
        } catch {
          // Rămâne ultimul citit; reîncercăm la runda următoare.
        }
      });
      pending = hashes.filter((h) => isPending(lines.get(h) ?? []));
      setProgress("Se așteaptă răspunsul trackerelor", total - pending.length, total);
      if (pending.length === 0 || Date.now() - t0 > MAX_WAIT_MS) break;
      await sleep(POLL_EVERY_MS);
    }
  } finally {
    setProgress("Se opresc la loc torrentele pornite temporar", total, total);
    try {
      await restoreResumedTorrents();
    } catch (e) {
      // `resumed` rămâne în DB; recoverTrackerCheck/următoarea rulare reîncearcă.
      console.warn("[tracker-check] oprirea la loc a eșuat:", errMsg(e));
    }
  }

  const counts = { ok: 0, removed: 0, down: 0, unknown: 0 };
  const items: TrackerCheckItem[] = [];
  for (const t of torrents) {
    const trackers = lines.get(t.hash) ?? [];
    const brokenState = broken.get(t.hash);
    const { verdict, message } = brokenState
      ? { verdict: "unknown" as const, message: `torrent în stare „${brokenState}”` }
      : classifyTrackers(trackers);
    counts[verdict]++;
    if (verdict === "ok") continue;
    let label: string | null;
    try {
      label = torrentDisplay(t.hash)?.label ?? null;
    } catch {
      label = null;
    }
    items.push({
      hash: t.hash,
      name: t.name,
      label,
      verdict,
      message,
      wasStopped: stopped.has(t.hash),
      trackers: trackers.filter(isRealTracker),
    });
  }
  const order = { removed: 0, down: 1, unknown: 2 };
  items.sort((a, b) => order[a.verdict] - order[b.verdict] || a.name.localeCompare(b.name));
  db.prepare("UPDATE qbit_tracker_check SET result = ? WHERE id = 1").run(
    JSON.stringify({ counts, items }),
  );
}
