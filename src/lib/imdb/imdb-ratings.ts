// ---------------------------------------------------------------------------
// Rating-urile IMDb (notă + număr de voturi) — afișate în grilele Descoperă,
// în locul notei TMDB, care diferă vizibil de IMDb.
//
// Sursa e datasetul oficial IMDb (title.ratings.tsv.gz, ~1,7 milioane de
// titluri, ~8 MB), regenerat de IMDb o dată pe zi. Nu e în timp real: cifrele
// au cel mult o zi întârziere. Alternativa OMDb (cheie API, 1000 cereri/zi)
// a fost respinsă: e un serviciu terț, cu întârzieri nepublicate, mai mari
// tocmai la titlurile noi.
//
// Baza e un fișier SQLite separat (data/imdb-ratings.db), nu un tabel în
// faikkitbox.db: are ~35 MB, se poate reface oricând din dataset și n-are ce
// căuta în cele 14 backup-uri zilnice ale bazei principale. Importul scrie un
// fișier nou, alături, și îl mută peste cel vechi abia la final — o citire în
// timpul importului vede datele de ieri, nu un tabel pe jumătate gol.
//
// Rulat de sarcina imdb-ratings din Watcher. Server-only (node:sqlite, node:fs).
// ---------------------------------------------------------------------------

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";

const DATASET_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz";
// 23h, nu 24h: verificarea e din oră în oră (vezi src/lib/watcher/tasks.ts).
const IMPORT_MIN_AGE_MS = 23 * 60 * 60 * 1000;
// Rânduri per tranzacție. Între loturi cedăm event loop-ul: un import de 1,7
// milioane de rânduri dintr-o bucată ar bloca serverul câteva secunde.
const BATCH = 50_000;

export interface ImdbRating {
  rating: number;
  votes: number;
}

function ratingsPath(): string {
  const mainDb = process.env.FAIKKITBOX_DB_PATH ?? "/opt/faikkitbox/data/faikkitbox.db";
  return join(dirname(mainDb), "imdb-ratings.db");
}

let db: DatabaseSync | null = null;

function openDb(): DatabaseSync | null {
  if (db) return db;
  const file = ratingsPath();
  if (!existsSync(file)) return null;
  db = new DatabaseSync(file, { readOnly: true });
  return db;
}

function readMeta(database: DatabaseSync, key: string): string | null {
  const row = database.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    { value: string } | undefined;
  return row?.value ?? null;
}

// „tt0111161" → 111161. Cheia numerică ține tabelul compact (rowid direct).
function imdbNumber(imdbId: string): number | null {
  const m = imdbId.trim().match(/^tt(\d{7,9})$/i);
  return m ? Number(m[1]) : null;
}

// Rating-urile pentru o listă de IMDb id-uri. Lipsesc din rezultat titlurile
// pe care IMDb nu le are în dataset (încă fără voturi) și id-urile invalide.
// Map gol dacă baza nu există încă (primul import n-a rulat).
export function getImdbRatings(imdbIds: Iterable<string>): Map<string, ImdbRating> {
  const out = new Map<string, ImdbRating>();
  let database: DatabaseSync | null;
  try {
    database = openDb();
  } catch {
    return out;
  }
  if (!database) return out;
  const stmt = database.prepare("SELECT rating, votes FROM ratings WHERE id = ?");
  for (const id of imdbIds) {
    const n = imdbNumber(id);
    if (n === null || out.has(id)) continue;
    const row = stmt.get(n) as { rating: number; votes: number } | undefined;
    if (row) out.set(id, { rating: row.rating, votes: row.votes });
  }
  return out;
}

function lastCheckedAt(): number | null {
  try {
    const database = openDb();
    const v = database ? readMeta(database, "checked_at") : null;
    return v ? new Date(v).getTime() : null;
  } catch {
    return null;
  }
}

// Când devine scadentă următoarea verificare — Watcher-ul o programează exact
// atunci, nu din oră în oră. Null = încă niciuna, deci acum.
export function nextImdbCheckAt(): number | null {
  const last = lastCheckedAt();
  return last === null ? null : last + IMPORT_MIN_AGE_MS;
}

async function importInto(tmpFile: string, body: ReadableStream<Uint8Array>, etag: string) {
  rmSync(tmpFile, { force: true });
  const out = new DatabaseSync(tmpFile);
  try {
    out.exec(`
      PRAGMA journal_mode = OFF;
      PRAGMA synchronous = OFF;
      CREATE TABLE ratings (id INTEGER PRIMARY KEY, rating REAL NOT NULL, votes INTEGER NOT NULL);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    const insert = out.prepare(
      "INSERT OR REPLACE INTO ratings (id, rating, votes) VALUES (?, ?, ?)",
    );
    const lines = createInterface({
      input: Readable.fromWeb(body as import("node:stream/web").ReadableStream).pipe(
        createGunzip(),
      ),
      crlfDelay: Infinity,
    });

    let batch: [number, number, number][] = [];
    let count = 0;
    const flush = async () => {
      out.exec("BEGIN");
      for (const r of batch) insert.run(r[0], r[1], r[2]);
      out.exec("COMMIT");
      count += batch.length;
      batch = [];
      await new Promise((r) => setImmediate(r));
    };

    for await (const line of lines) {
      const [tconst, avg, votes] = line.split("\t");
      const id = imdbNumber(tconst ?? "");
      const rating = Number(avg);
      const n = Number(votes);
      if (id === null || !Number.isFinite(rating) || !Number.isFinite(n)) continue; // antetul
      batch.push([id, rating, n]);
      if (batch.length >= BATCH) await flush();
    }
    if (batch.length) await flush();
    // Un dataset trunchiat (conexiune tăiată) nu înlocuiește unul complet.
    if (count < 1_000_000) throw new Error(`dataset incomplet (${count} rânduri)`);

    const now = new Date().toISOString();
    const meta = out.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    meta.run("imported_at", now);
    meta.run("checked_at", now);
    meta.run("etag", etag);
    meta.run("count", String(count));
    return count;
  } finally {
    out.close();
  }
}

// Reîmprospătează baza dacă ultima verificare e mai veche de 23h (sau oricând,
// cu `force` — „Rulează acum” din Watcher). Dataset-ul neschimbat (același
// ETag) costă o singură cerere 304, fără import. Întoarce ce s-a întâmplat,
// pentru rezumatul din Watcher.
let running = false;

export type ImdbRefreshResult = "skipped" | "unchanged" | { imported: number };

export async function refreshImdbRatingsIfDue(
  opts: { force?: boolean } = {},
): Promise<ImdbRefreshResult> {
  if (running) return "skipped";
  const last = lastCheckedAt();
  if (!opts.force && last && Date.now() - last < IMPORT_MIN_AGE_MS) return "skipped";
  running = true;
  try {
    const file = ratingsPath();
    const current = openDb();
    const etag = current ? readMeta(current, "etag") : null;

    const res = await fetch(DATASET_URL, {
      headers: etag ? { "If-None-Match": etag } : {},
      signal: AbortSignal.timeout(5 * 60_000),
    });

    if (res.status === 304 && current) {
      // Baza e deschisă read-only — marcajul se scrie printr-o conexiune scurtă.
      const rw = new DatabaseSync(file);
      try {
        rw.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('checked_at', ?)").run(
          new Date().toISOString(),
        );
      } finally {
        rw.close();
      }
      return "unchanged";
    }
    if (!res.ok || !res.body) throw new Error(`IMDb dataset HTTP ${res.status}`);

    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    const started = Date.now();
    let count: number;
    try {
      count = await importInto(tmp, res.body, res.headers.get("etag") ?? "");
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
    db?.close();
    db = null;
    renameSync(tmp, file);
    console.log(
      `[imdb] ${count.toLocaleString("ro-RO")} rating-uri importate în ${((Date.now() - started) / 1000).toFixed(0)}s`,
    );
    return { imported: count };
  } finally {
    running = false;
  }
}
