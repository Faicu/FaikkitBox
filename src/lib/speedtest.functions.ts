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

export type SpeedtestRunResponse =
  | ({ ok: true } & SpeedtestResult)
  | { ok: false; error: string };

function cacheFilePath() {
  return process.env.SPEEDTEST_CACHE_FILE ?? path.join(tmpdir(), "faikkitbox-speedtest.json");
}

function speedtestBinaries() {
  const configured = process.env.SPEEDTEST_BIN?.trim();
  if (configured) return [configured];
  return ["speedtest", "/usr/bin/speedtest", "/usr/local/bin/speedtest"];
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

export const getLastSpeedtest = createServerFn({ method: "GET" }).handler(async () => {
  return await readCache();
});

export const runSpeedtest = createServerFn({ method: "POST" }).handler(async (): Promise<SpeedtestRunResponse> => {
  const { requireAdmin } = await import("./admin.server");
  await requireAdmin();

  let lastError: string | null = null;
  let hasSnapCgroupError = false;
  let hasAnyBinary = false;

  for (const bin of speedtestBinaries()) {
    try {
      const { stdout } = await execFileAsync(
        bin,
        ["--accept-license", "--accept-gdpr", "-f", "json", "-p", "no"],
        {
          timeout: 90_000,
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env, PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/usr/bin:/bin` },
        },
      );
      const result = parseOoklaJson(stdout);
      await writeCache(result);
      return { ok: true, ...result };
    } catch (e: any) {
      if (e?.code === "ENOENT") {
        continue;
      }
      hasAnyBinary = true;
      const message = e?.stderr || e?.stdout || e?.message || String(e);
      if (typeof message === "string" && message.includes("is not a snap cgroup for tag snap.speedtest.speedtest")) {
        hasSnapCgroupError = true;
        lastError = message;
        continue;
      }
      return { ok: false, error: message };
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
});
