// Pasul 3 — operații pe bytes și disc: conversie la UTF-8, citire/scriere cu
// reîncercări, suprapunerea pieselor torrent. Nu decide ce fișier atinge.

import iconv from "iconv-lite";
import { readFile, writeFile } from "node:fs/promises";

// Plex citește .srt-urile ca UTF-8, fără detecție — subtitrările românești
// vechi sunt des Windows-1250 și își pierd diacriticele. UTF-8 invalid →
// presupunem Windows-1250 și convertim.
const FALLBACK_ENCODING = "windows-1250";

function isValidUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

export function decodeToUtf8Text(buf: Buffer): { text: string; wasConverted: boolean } {
  if (isValidUtf8(buf)) return { text: buf.toString("utf8"), wasConverted: false };
  return { text: iconv.decode(buf, FALLBACK_ENCODING), wasConverted: true };
}

// Citire cu reîncercări: după o redenumire prin qBittorrent fișierul poate să
// nu fie vizibil imediat (ENOENT, deși există câteva secunde mai târziu).
async function readFileWithRetry(absPath: string, attempts = 6, delayMs = 750): Promise<Buffer> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await readFile(absPath);
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

// EACCES/EBUSY tranzitorii la scriere (alt proces ține fișierul deschis) —
// reușeau la o rulare ulterioară. Retry cu backoff.
export async function writeFileWithRetry(
  absPath: string,
  data: string,
  attempts = 6,
  delayMs = 750,
): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await writeFile(absPath, data, "utf8");
      return;
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

// Corectează codarea unui .srt venit cu torrentul. Scrierea e direct pe disc
// (calea nu se schimbă, deci qBittorrent nu e afectat), dar bytes-ii nu mai
// corespund hash-ului piesei — așa că fișierul e exclus întâi de la
// descărcare/seed, ca un recheck să nu anuleze conversia și să nu trimitem
// bytes greșiți altor peers. Excluderea e permanentă (un .srt nu contează la
// ratio).
export async function ensureUtf8SrtOnDisk(
  absPath: string,
  exclude: () => Promise<void>,
): Promise<boolean> {
  try {
    const buf = await readFileWithRetry(absPath);
    const { text, wasConverted } = decodeToUtf8Text(buf);
    if (!wasConverted) return false;
    await exclude().catch((e) =>
      console.warn(
        `[subtitles] Nu am putut exclude .srt de la seed în qBittorrent (${absPath}):`,
        e,
      ),
    );
    await writeFileWithRetry(absPath, text);
    return true;
  } catch (e) {
    console.warn(`[subtitles] Verificare/conversie UTF-8 eșuată pentru ${absPath}:`, e);
    return false;
  }
}

// Două fișiere care partajează o piesă: excluderea unuia nu protejează complet
// la recheck. Doar avertisment.
export function piecesOverlap(a?: [number, number], b?: [number, number]): boolean {
  if (!a || !b) return false;
  return a[0] <= b[1] && b[0] <= a[1];
}
