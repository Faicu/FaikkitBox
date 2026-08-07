#!/usr/bin/env node
// Wrapper systemd: pornește ambele servere Node (FaikkitBox pe 3000,
// portalul Plex pe 3001), le supraveghează, propagă SIGTERM/SIGINT la
// ambele și iese cu un cod de eroare dacă vreunul dintre ele cade.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const procs = [
  spawn(process.execPath, [join(root, ".output/server/index.mjs")], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  }),
  spawn(process.execPath, [join(root, "plex/.output/server/index.mjs")], {
    cwd: join(root, "plex"),
    stdio: "inherit",
    env: process.env,
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
