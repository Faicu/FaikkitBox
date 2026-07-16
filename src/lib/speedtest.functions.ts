import { createServerFn } from "@tanstack/react-start";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

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

export type SpeedtestRunResponse = ({ ok: true } & SpeedtestResult) | { ok: false; error: string };

function cacheFilePath() {
  return process.env.SPEEDTEST_CACHE_FILE ?? path.join(tmpdir(), "faikkitbox-speedtest.json");
}

type BinaryConfig = {
  path: string;
  args: string[];
  parser: (raw: string) => SpeedtestResult;
};

function speedtestConfigs(): BinaryConfig[] {
  const configured = process.env.SPEEDTEST_BIN?.trim();
  const ooklaArgs = ["--accept-license", "--accept-gdpr", "-f", "json", "-p", "no"];
  const pyArgs = ["--json"];

  if (configured) {
    return [
      { path: configured, args: ooklaArgs, parser: parseOoklaJson },
      { path: configured, args: pyArgs, parser: parsePythonCliJson },
    ];
  }

  return [
    { path: "speedtest", args: ooklaArgs, parser: parseOoklaJson },
    { path: "/usr/bin/speedtest", args: ooklaArgs, parser: parseOoklaJson },
    { path: "/usr/local/bin/speedtest", args: ooklaArgs, parser: parseOoklaJson },
    { path: "speedtest-cli", args: pyArgs, parser: parsePythonCliJson },
    { path: "/usr/bin/speedtest-cli", args: pyArgs, parser: parsePythonCliJson },
    { path: "/usr/local/bin/speedtest-cli", args: pyArgs, parser: parsePythonCliJson },
  ];
}

async function readCache(): Promise<SpeedtestResult | null> {
  try {
    const raw = await readFile(cacheFilePath(), "utf8");
    return JSON.parse(raw) as SpeedtestResult;
  } catch {
    return null;
  }
}

async function writeCache(result: SpeedtestResult) {
  const file = cacheFilePath();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(result), "utf8");
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

export const getLastSpeedtest = createServerFn({ method: "GET" }).handler(async () => {
  return await readCache();
});

export const runSpeedtest = createServerFn({ method: "POST" }).handler(
  async (): Promise<SpeedtestRunResponse> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();

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
        const result = parser(stdout);
        await writeCache(result);
        return { ok: true, ...result };
      } catch (e: any) {
        if (e?.code === "ENOENT") {
          continue;
        }
        hasAnyBinary = true;
        const message = e?.stderr || e?.stdout || e?.message || String(e);
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
      return {
        ok: false,
        error:
          "Speedtest instalat prin snap nu poate rula din acest serviciu systemd. Instaleaza varianta Ookla .deb (non-snap) sau seteaza SPEEDTEST_BIN catre un binar non-snap (ex: /usr/bin/speedtest).",
      };
    }

    if (!hasAnyBinary) {
      return {
        ok: false,
        error:
          "Comanda speedtest nu a fost gasita pe server. Verifica instalarea Speedtest by Ookla si/sau seteaza SPEEDTEST_BIN in .env.",
      };
    }

    return { ok: false, error: lastError ?? "Speedtest a esuat dintr-un motiv necunoscut." };
  },
);
