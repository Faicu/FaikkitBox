// ---------------------------------------------------------------------------
// Speedtest — implementarea, server-only.
//
// Fișierul are importuri server statice (node:child_process, node:crypto) și
// atinge DB-ul. Server function-urile stau în speedtest.functions.ts, care e
// importat de tehnic.tsx și queries.ts — deci ajunge în bundle-ul de client.
// Înainte, importurile astea erau chiar acolo, static: exact tiparul care a
// produs eroarea `dirname` la update-ul Plex (node:path stub-uit în client).
//
// Rularea e DECUPLATĂ de cererea HTTP care o pornește: starea trăiește în
// modul, nu în request. Vezi startSpeedtestRun.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

export type SpeedtestHistoryEntry = {
  id: string;
  timestamp: string;
  download: number;
  upload: number;
  ping: number;
  jitter?: number;
  isp?: string;
  serverName?: string;
  resultUrl?: string;
};

export type SpeedtestResult = {
  timestamp: string;
  ping: { latency: number; jitter: number };
  download: number; // bytes/sec
  upload: number; // bytes/sec
  packetLoss?: number;
  isp?: string;
  server?: { name?: string; location?: string };
  resultUrl?: string;
};

type BinaryConfig = {
  path: string;
  args: string[];
  parser: (raw: string) => SpeedtestResult;
};

function speedtestConfigs(): BinaryConfig[] {
  const configured = process.env.SPEEDTEST_BIN?.trim();
  const ooklaArgs = [
    "--accept-license",
    "--accept-gdpr",
    "-f",
    "json",
    "-p",
    "no",
    "--server-id",
    "11494",
  ];
  const pyArgs = ["--json"];

  if (configured) {
    return [
      { path: configured, args: ooklaArgs, parser: parseOoklaJson },
      { path: configured, args: pyArgs, parser: parsePythonCliJson },
    ];
  }

  return [
    { path: "/usr/local/bin/ookla-speedtest", args: ooklaArgs, parser: parseOoklaJson },
    { path: "speedtest", args: ooklaArgs, parser: parseOoklaJson },
    { path: "/usr/bin/speedtest", args: ooklaArgs, parser: parseOoklaJson },
    { path: "/usr/local/bin/speedtest", args: ooklaArgs, parser: parseOoklaJson },
    { path: "speedtest-cli", args: pyArgs, parser: parsePythonCliJson },
    { path: "/usr/bin/speedtest-cli", args: pyArgs, parser: parsePythonCliJson },
    { path: "/usr/local/bin/speedtest-cli", args: pyArgs, parser: parsePythonCliJson },
  ];
}

function parseOoklaJson(raw: string): SpeedtestResult {
  if (!raw?.trim()) throw new Error("Speedtest nu a returnat niciun rezultat (stdout gol).");
  const j = JSON.parse(raw);
  if (j?.type === "error" || j?.error) {
    throw new Error(j.error ?? "Speedtest a raportat o eroare.");
  }
  return {
    timestamp: j.timestamp ?? new Date().toISOString(),
    ping: { latency: j.ping?.latency ?? 0, jitter: j.ping?.jitter ?? 0 },
    download: j.download?.bandwidth ?? 0,
    upload: j.upload?.bandwidth ?? 0,
    packetLoss: j.packetLoss,
    isp: j.isp,
    server: j.server ? { name: j.server.name, location: j.server.location } : undefined,
    resultUrl: j.result?.url,
  };
}

// Parser pentru varianta Python `speedtest-cli` (apt-get install speedtest-cli).
// Aceasta raportează download/upload în biți/sec și are o schemă JSON diferită.
function parsePythonCliJson(raw: string): SpeedtestResult {
  if (!raw?.trim()) throw new Error("Speedtest nu a returnat niciun rezultat (stdout gol).");
  const j = JSON.parse(raw);
  return {
    timestamp: j.timestamp ?? new Date().toISOString(),
    // download/upload sunt în biți/sec → convertim la bytes/sec
    ping: { latency: j.ping ?? 0, jitter: 0 },
    download: Math.round((j.download ?? 0) / 8),
    upload: Math.round((j.upload ?? 0) / 8),
    isp: j.client?.isp,
    server: j.server
      ? { name: j.server.sponsor ?? j.server.name, location: j.server.name }
      : undefined,
    resultUrl: j.share ?? undefined,
  };
}

async function saveToHistory(result: SpeedtestResult) {
  try {
    const { getDb } = await import("../db");
    const db = getDb();
    db.prepare(
      `INSERT INTO speedtest_history (id, timestamp, download, upload, ping, jitter, isp, server_name, result_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      result.timestamp,
      result.download,
      result.upload,
      result.ping.latency,
      result.ping.jitter ?? null,
      result.isp ?? null,
      result.server?.name ?? null,
      result.resultUrl ?? null,
    );
    // Păstrăm doar ultimele 30
    db.prepare(
      `DELETE FROM speedtest_history WHERE id NOT IN (
        SELECT id FROM speedtest_history ORDER BY timestamp DESC LIMIT 30
      )`,
    ).run();
  } catch (e) {
    console.warn("[speedtest] Eroare la salvare istoric:", e);
  }
}

export async function readLastFromHistory(): Promise<SpeedtestResult | null> {
  try {
    const { getDb } = await import("../db");
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM speedtest_history ORDER BY timestamp DESC LIMIT 1")
      .get() as
      | {
          timestamp: string;
          download: number;
          upload: number;
          ping: number;
          jitter: number | null;
          isp: string | null;
          server_name: string | null;
          result_url: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      timestamp: row.timestamp,
      ping: { latency: row.ping, jitter: row.jitter ?? 0 },
      download: row.download,
      upload: row.upload,
      isp: row.isp ?? undefined,
      server: row.server_name ? { name: row.server_name } : undefined,
      resultUrl: row.result_url ?? undefined,
    };
  } catch {
    return null;
  }
}

export async function readHistory(): Promise<SpeedtestHistoryEntry[]> {
  try {
    const { getDb } = await import("../db");
    const db = getDb();
    const rows = db
      .prepare("SELECT * FROM speedtest_history ORDER BY timestamp DESC LIMIT 30")
      .all() as Array<{
      id: string;
      timestamp: string;
      download: number;
      upload: number;
      ping: number;
      jitter: number | null;
      isp: string | null;
      server_name: string | null;
      result_url: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      download: r.download,
      upload: r.upload,
      ping: r.ping,
      jitter: r.jitter ?? undefined,
      isp: r.isp ?? undefined,
      serverName: r.server_name ?? undefined,
      resultUrl: r.result_url ?? undefined,
    }));
  } catch {
    return [];
  }
}

// Încearcă binarele pe rând. Aruncă dacă niciunul nu reușește — apelantul
// (startSpeedtestRun) prinde și ține mesajul în stare.
async function executeSpeedtest(): Promise<SpeedtestResult> {
  let lastError: string | null = null;
  let hasSnapCgroupError = false;
  let hasAnyBinary = false;

  for (const { path: bin, args, parser } of speedtestConfigs()) {
    try {
      const { stdout } = await execFileAsync(bin, args, {
        timeout: 90_000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/usr/bin:/bin` },
      });
      return parser(stdout);
    } catch (e) {
      const err = e as { code?: string; stderr?: string; stdout?: string; message?: string };
      if (err?.code === "ENOENT") continue;
      hasAnyBinary = true;
      const message = err?.stderr || err?.stdout || err?.message || String(e);
      if (
        typeof message === "string" &&
        message.includes("is not a snap cgroup for tag snap.speedtest.speedtest")
      ) {
        hasSnapCgroupError = true;
        lastError = message;
        continue;
      }
      lastError = message;
      // Continuăm cu următoarea configurație (ex: Ookla a eșuat, încercăm speedtest-cli Python)
      continue;
    }
  }

  if (hasSnapCgroupError) {
    throw new Error(
      "Speedtest instalat prin snap nu poate rula din acest serviciu systemd. Instaleaza varianta Ookla .deb (non-snap) sau seteaza SPEEDTEST_BIN catre un binar non-snap (ex: /usr/bin/speedtest).",
    );
  }
  if (!hasAnyBinary) {
    throw new Error(
      "Comanda speedtest nu a fost gasita pe server. Verifica instalarea Speedtest by Ookla si/sau seteaza SPEEDTEST_BIN in .env.",
    );
  }
  throw new Error(lastError ?? "Speedtest a esuat dintr-un motiv necunoscut.");
}

// ---------------------------------------------------------------------------
// Starea rulării — în modul, nu în cererea HTTP.
//
// Testul durează 30-60s. Dacă browserul se închide sau Android îngheață PWA-ul
// minimizat, cererea moare — dar rularea nu trebuie să moară cu ea. De aceea
// startSpeedtestRun pornește promisiunea și returnează IMEDIAT: nimic din
// rulare nu mai depinde de conexiune.
//
// Clientul află ce se întâmplă interogând getSpeedtestState, deci vede corect
// "în curs" chiar dacă a redeschis aplicația la mijlocul testului.
// ---------------------------------------------------------------------------

export type SpeedtestState = {
  running: boolean;
  startedAt: string | null;
  /** Momentul în care s-a încheiat ultima rulare — cheia după care clientul
   *  recunoaște o rulare nouă față de una deja raportată. */
  finishedAt: string | null;
  /** Rezultatul ultimei rulări încheiate cu succes. */
  result: SpeedtestResult | null;
  /** Mesajul ultimei rulări eșuate. Ținut doar în memorie: rularea moare
   *  oricum la restart de server, deci nu are ce supraviețui separat. */
  error: string | null;
};

let state: SpeedtestState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null,
};

export function getSpeedtestState(): SpeedtestState {
  return state;
}

/** `started: false` înseamnă că deja rulează un test — nu pornim al doilea. */
export function startSpeedtestRun(): { started: boolean } {
  if (state.running) return { started: false };

  state = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null,
  };

  // `void`: deliberat neașteptat. Handler-ul server function-ului se întoarce
  // fără să aștepte, deci răspunsul pleacă la client în milisecunde, iar
  // rularea continuă în procesul serverului.
  void executeSpeedtest()
    .then(async (result) => {
      await saveToHistory(result);
      state = { ...state, result, error: null };
    })
    .catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      console.warn("[speedtest] Rulare eșuată:", message);
      state = { ...state, result: null, error: message };
    })
    .finally(() => {
      state = { ...state, running: false, finishedAt: new Date().toISOString() };
    });

  return { started: true };
}
