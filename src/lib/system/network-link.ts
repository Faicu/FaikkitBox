// ---------------------------------------------------------------------------
// Starea legăturii Ethernet a serverului + renegociere.
//
// Problemă reală, recurentă: la atingerea fizică a cablului, auto-negocierea
// se reașază pe 100 Mb/s și rămâne acolo, deși ambele capete suportă 1000.
// Diagnosticat pe 2026-09-05 exact în starea asta:
//   interfața suportă  2500baseT/Full
//   routerul anunță    1000baseT/Full
//   negociat           100 Mb/s
// Leacul e `ethtool -r`, care repornește doar auto-negocierea, fără să atingă
// configurația interfeței.
//
// Fișierul e server-only (node:fs, node:child_process). Server functions stau
// în network-link.functions.ts — vezi comentariul de acolo.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface NetworkLinkInfo {
  /** Interfața pe care iese traficul (ruta implicită), ex. "enp2s0". */
  iface: string | null;
  /** Viteza negociată acum, în Mb/s. null dacă interfaţa e jos sau necunoscută. */
  speedMbps: number | null;
  duplex: string | null;
  /** Cel mai bun mod pe care îl suportă AMBELE capete — ținta realistă. */
  expectedMbps: number | null;
  /** true dacă se poate mai bine decât acum (deci merită renegociat). */
  degraded: boolean;
  error?: string;
}

// Interfața rutei implicite, citită din /proc/net/route — fără să pornim
// procese. Linia cu Destination 00000000 e ruta implicită.
async function defaultRouteIface(): Promise<string | null> {
  try {
    const raw = await readFile("/proc/net/route", "utf8");
    for (const line of raw.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length > 2 && cols[1] === "00000000") return cols[0];
    }
  } catch {
    // /proc indisponibil — cădem pe null, apelantul raportează necunoscut
  }
  return null;
}

async function readSysFile(iface: string, name: string): Promise<string | null> {
  try {
    return (await readFile(`/sys/class/net/${iface}/${name}`, "utf8")).trim();
  } catch {
    return null;
  }
}

// Extrage vitezele (în Mb/s) dintr-un bloc de moduri ethtool, ex.
// "1000baseT/Full" -> 1000. "2500baseT/Full" -> 2500.
function maxModeSpeed(block: string): number | null {
  const speeds = [...block.matchAll(/(\d+)base/g)].map((m) => Number(m[1]));
  return speeds.length ? Math.max(...speeds) : null;
}

// Ce viteză e realist atins: minimul dintre ce suportă placa noastră și ce
// anunță celălalt capăt. Fără partea de "link partner" am compara cu 2500,
// deși routerul nu poate decât 1000 — și butonul ar părea mereu necesar.
async function expectedFromEthtool(iface: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("sudo", ["ethtool", iface], { timeout: 5000 });
    const supported = stdout.match(/Supported link modes:([\s\S]*?)(?:\n\s*\w[\w -]*:)/)?.[1] ?? "";
    const partner =
      stdout.match(/Link partner advertised link modes:([\s\S]*?)(?:\n\s*\w[\w -]*:)/)?.[1] ?? "";
    const ours = maxModeSpeed(supported);
    const theirs = maxModeSpeed(partner);
    if (ours == null) return theirs;
    if (theirs == null) return ours;
    return Math.min(ours, theirs);
  } catch {
    return null;
  }
}

export async function getNetworkLinkInfo(): Promise<NetworkLinkInfo> {
  const iface = await defaultRouteIface();
  if (!iface) {
    return {
      iface: null,
      speedMbps: null,
      duplex: null,
      expectedMbps: null,
      degraded: false,
      error: "Nu am putut determina interfața rutei implicite",
    };
  }

  const [speedRaw, duplex, operstate] = await Promise.all([
    readSysFile(iface, "speed"),
    readSysFile(iface, "duplex"),
    readSysFile(iface, "operstate"),
  ]);

  // /sys/.../speed întoarce -1 (sau eroare) când legătura e jos.
  const speed = speedRaw != null && Number(speedRaw) > 0 ? Number(speedRaw) : null;
  const expected = await expectedFromEthtool(iface);

  return {
    iface,
    speedMbps: speed,
    duplex: duplex && duplex !== "unknown" ? duplex : null,
    expectedMbps: expected,
    // Degradat doar dacă știm sigur ambele valori și chiar se poate mai bine.
    degraded: speed != null && expected != null && speed < expected,
    ...(operstate && operstate !== "up" ? { error: `Interfața ${iface} e ${operstate}` } : {}),
  };
}

export interface RenegotiateResult {
  ok: boolean;
  iface?: string;
  error?: string;
}

export async function renegotiateLink(): Promise<RenegotiateResult> {
  const iface = await defaultRouteIface();
  if (!iface) return { ok: false, error: "Nu am putut determina interfața rutei implicite" };

  try {
    // Rulăm DETAȘAT, peste o secundă: `ethtool -r` face legătura să cadă și să
    // revină (2-5s), iar cererea HTTP curentă circulă chiar pe ea. Executat
    // inline, răspunsul n-ar mai ajunge niciodată la telefon și butonul ar
    // părea că a eșuat, deși comanda a mers. Cu întârzierea asta, răspunsul
    // pleacă înainte ca legătura să pice. Același tipar ca la deploy_app.
    await execFileAsync(
      "sudo",
      [
        "systemd-run",
        "--on-active=1s",
        "--unit=faikkitbox-relink",
        "--collect",
        "ethtool",
        "-r",
        iface,
      ],
      { timeout: 10_000 },
    );
    return { ok: true, iface };
  } catch (e) {
    return { ok: false, iface, error: e instanceof Error ? e.message : String(e) };
  }
}
