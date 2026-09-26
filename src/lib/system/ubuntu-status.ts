// ---------------------------------------------------------------------------
// Starea actualizărilor Ubuntu, pentru butoanele din pagina Sistem.
//
// Fără sudo și fără rețea: listele de pachete sunt ținute la zi de
// apt-daily.timer (de două ori pe zi), iar actualizările de securitate le
// instalează singur unattended-upgrades. Aici doar citim ce a rămas.
//
// Server-only (node:child_process, node:fs).
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REBOOT_FLAG = "/var/run/reboot-required";

export interface UbuntuStatus {
  // Pachete pe care `apt-get upgrade` (butonul Update) le-ar instala acum.
  pending: number;
  rebootRequired: boolean;
  // Pachetele care au cerut repornirea, din reboot-required.pkgs.
  rebootPackages: string[];
}

// Simularea exactă a comenzii rulate de butonul Update: numărăm liniile
// „Inst …”. `apt list --upgradable` ar număra și pachetele ținute pe loc
// (kept back), pe care `upgrade` nu le instalează — butonul n-ar dispărea
// niciodată după actualizare.
export function countSimulatedInstalls(simOutput: string): number {
  return simOutput.split("\n").filter((l) => l.startsWith("Inst ")).length;
}

export async function readUbuntuStatus(): Promise<UbuntuStatus> {
  const rebootRequired = await access(REBOOT_FLAG)
    .then(() => true)
    .catch(() => false);
  const rebootPackages = rebootRequired
    ? (await readFile(`${REBOOT_FLAG}.pkgs`, "utf8").catch(() => ""))
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    : [];
  const { stdout } = await execFileAsync("apt-get", ["-s", "-o", "Debug::NoLocking=1", "upgrade"], {
    timeout: 60_000,
    env: { ...process.env, LC_ALL: "C" },
  });
  return { pending: countSimulatedInstalls(stdout), rebootRequired, rebootPackages };
}
