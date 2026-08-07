#!/usr/bin/env node
// Wrapper systemd: pornește ambele servere Node (FaikkitBox pe 3000,
// portalul Plex pe 3001), le supraveghează, propagă SIGTERM/SIGINT la
// ambele și iese cu un cod de eroare dacă vreunul dintre ele cade.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// systemd încarcă doar /opt/faikkitbox/.env (EnvironmentFile); portalul Plex are
// propriile variabile (PORT=3001, PLEX_DB_PATH etc.) în plex/.env, care nu se
// suprapun automat peste mediul procesului părinte — le citim manual aici și le
// aplicăm doar peste env-ul copilului Plex, ca să nu se lovească de PORT=3000.
function loadEnvFile(path) {
  const out = {};
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const plexEnv = { ...process.env, ...loadEnvFile(join(root, "plex/.env")) };

const procs = [
  spawn(process.execPath, [join(root, ".output/server/index.mjs")], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  }),
  spawn(process.execPath, [join(root, "plex/.output/server/index.mjs")], {
    cwd: join(root, "plex"),
    stdio: "inherit",
    env: plexEnv,
  }),
];

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) {
    if (!p.killed) p.kill(signal);
  }
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => shutdown(signal));
}

for (const p of procs) {
  p.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(
      `[start-both] Un proces s-a oprit (cod=${code}, semnal=${signal}) — opresc și celălalt.`,
    );
    shutdown("SIGTERM");
    process.exitCode = code ?? 1;
  });
}
