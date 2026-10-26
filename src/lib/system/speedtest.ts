// ---------------------------------------------------------------------------
// Speedtest — implementarea, server-only (server functions în
// speedtest.functions.ts, importat și de client — tiparul care a produs eroarea
// `dirname`). Rularea e decuplată de cererea HTTP: starea trăiește în modul.
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

// Doar serverul Digi București (Ookla 11494), ca rezultatele să fie
// comparabile. speedtest-cli nu-l poate ținti și alegea unul la întâmplare, deci
// nu mai e rezervă: un eșec Ookla se arată ca eroare.
const SPEEDTEST_SERVER_ID = 11494;

function speedtestBinaries(): string[] {
  const configured = process.env.SPEEDTEST_BIN?.trim();
  if (configured) return [configured];
  return [
    "/usr/local/bin/ookla-speedtest",
    "/usr/local/bin/speedtest",
    "/usr/bin/speedtest",
    "speedtest",
  ];
}

const OOKLA_ARGS = [
  "--accept-license",
  "--accept-gdpr",
  "-f",
  "json",
  "-p",
  "no",
  "--server-id",
  String(SPEEDTEST_SERVER_ID),
];

function parseOoklaJson(raw: string): SpeedtestResult {
  if (!raw?.trim()) throw new Error("Speedtest nu a returnat niciun rezultat (stdout gol).");
  const j = JSON.parse(raw);
  if (j?.type === "error" || j?.error) {
    throw new Error(j.error ?? "Speedtest a raportat o eroare.");
  }
  if (Number(j.server?.id) !== SPEEDTEST_SERVER_ID) {
    throw new Error(
      `Speedtest a rulat pe alt server (${j.server?.name ?? "necunoscut"}, id ${j.server?.id ?? "?"}) în loc de Digi București (${SPEEDTEST_SERVER_ID}) — rezultat ignorat.`,
    );
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
    // Ultimele 30.
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

// Primul binar Ookla găsit; doar ENOENT trece la următorul, orice altă eroare
// e a testului.
async function executeSpeedtest(): Promise<SpeedtestResult> {
  for (const bin of speedtestBinaries()) {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(bin, OOKLA_ARGS, {
        timeout: 90_000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/usr/bin:/bin` },
      }));
    } catch (e) {
      const err = e as { code?: string; stderr?: string; stdout?: string; message?: string };
      if (err?.code === "ENOENT") continue;
      const message = err?.stderr || err?.stdout || err?.message || String(e);
      if (message.includes("is not a snap cgroup for tag snap.speedtest.speedtest")) {
        throw new Error(
          "Speedtest instalat prin snap nu poate rula din acest serviciu systemd. Instaleaza varianta Ookla .deb (non-snap) sau seteaza SPEEDTEST_BIN catre un binar non-snap (ex: /usr/bin/speedtest).",
          { cause: e },
        );
      }
      throw new Error(message, { cause: e });
    }
    return parseOoklaJson(stdout);
  }
  throw new Error(
    "Comanda speedtest nu a fost gasita pe server. Verifica instalarea Speedtest by Ookla si/sau seteaza SPEEDTEST_BIN in .env.",
  );
}

// ---------------------------------------------------------------------------
// Starea rulării, în modul: testul durează 30–60s, iar cererea poate muri
// (browser închis, PWA înghețat). startSpeedtestRun pornește și întoarce
// imediat; clientul întreabă getSpeedtestState, deci vede „în curs” și după
// redeschidere.
// ---------------------------------------------------------------------------

export type SpeedtestState = {
  running: boolean;
  startedAt: string | null;
  /** Când s-a încheiat ultima rulare — după asta clientul recunoaște una nouă. */
  finishedAt: string | null;
  /** Rezultatul ultimei rulări încheiate cu succes. */
  result: SpeedtestResult | null;
  /** Eroarea ultimei rulări eșuate — doar în memorie (rularea moare oricum la restart). */
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

  // `void`, deliberat: răspunsul pleacă imediat, rularea continuă pe server.
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
