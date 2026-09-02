// ---------------------------------------------------------------------------
// Pas 3 — pregătirea fișierelor: detectare/conversie la UTF-8, citire/scriere
// cu reîncercări (I/O tranzitoriu), verificare suprapunere de piese torrent.
// Nu decide nimic despre ce fișier să atingă — doar operații pe bytes/disc,
// apelate de subtitle-pipeline.ts și subtitle-apply.ts.
// ---------------------------------------------------------------------------

import iconv from "iconv-lite";
import { readFile, writeFile } from "node:fs/promises";

// Plex citește .srt-urile externe ca UTF-8, fără detecție de encoding —
// subtitrările românești vechi (mai ales cele care vin direct în torrent,
// nu de pe OpenSubtitles) sunt frecvent Windows-1250, ceea ce corupe
// diacriticele în Plex. Verificăm strict dacă bytes-ii sunt deja UTF-8
// valid; dacă nu, presupunem Windows-1250 (cea mai comună codare pentru
// subtitrări românești salvate din Notepad pe Windows) și convertim.
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

// Citește un fișier cu reîncercări scurte — imediat după un rename prin API-ul
// qBittorrent, fișierul poate să nu fie încă vizibil instant la o citire
// directă (mai ales pe montări de rețea), deși API-ul a răspuns deja cu
// succes. Fără retry, prima citire poate da ENOENT chiar dacă fișierul chiar
// există (confirmat: apare pe disc la o verificare manuală câteva secunde mai
// târziu).
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

// EACCES/EBUSY la scriere apar tranzitoriu când alt proces (torrent client,
// verificare antivirus, montare de rețea) ține fișierul .srt deschis chiar
// în fereastra în care încercăm conversia — a apărut recurent în producție
// (vezi Erori Aplicație), și reușea la o rulare ulterioară fără nicio
// intervenție. Retry cu backoff, ca la citire.
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

// Verifică (și corectează, dacă e cazul) encoding-ul unui .srt deja scris pe
// disc — folosit pentru fișierele care vin cu torrentul (nu descărcate de
// noi, deci nu le controlăm bytes-ii din start). Scrierea se face direct pe
// disc, în afara API-ului qBittorrent: schimbă doar conținutul, nu calea,
// deci nu afectează evidența fișierelor din qBittorrent (spre deosebire de
// redenumire, care trebuie mereu prin API) — DAR modifică bytes-ii fișierului,
// deci nu mai corespund hash-ului piesei din .torrent. Chiar înainte de
// scriere, excludem fișierul de la download/seed în qBittorrent (`exclude`),
// ca un eventual "Force Recheck" viitor să nu-l mai re-verifice/redescarce
// (anulând conversia) și să nu-l mai oferim la seed altor peers cu bytes
// modificați (hash mismatch pentru ei). Excluderea e permanentă și
// intenționată — un .srt are dimensiune neglijabilă, nu afectează ratio-ul.
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

// Verifică dacă două fișiere din același torrent partajează cel puțin o
// piesă — dacă da, excluderea unuia singur de la seed (qbitSetFilePriority)
// nu protejează complet la un recheck, pentru că piesa comună tot e "wanted"
// prin celălalt fișier. Doar avertisment, nu blochează conversia.
export function piecesOverlap(a?: [number, number], b?: [number, number]): boolean {
  if (!a || !b) return false;
  return a[0] <= b[1] && b[0] <= a[1];
}
