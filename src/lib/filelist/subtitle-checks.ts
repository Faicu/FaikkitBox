// ---------------------------------------------------------------------------
// Pas 1 — verificări de existență/conținut, înainte de a căuta sau descărca
// orice subtitrare: are deja subtitrare/audio română încorporate (ffprobe)?
// pare românesc un .srt deja bundle-uit? există deja un .srt sidecar pe disc?
// Funcții pure de citire — niciuna nu atinge qBittorrent sau disk-ul în scris
// (vezi subtitle-apply.ts pentru acțiunile care modifică ceva).
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { findTag } from "./release-scoring";

const execFileAsync = promisify(execFile);

export const MEDIA_EXTENSIONS = [".mkv", ".mp4", ".avi", ".m2ts", ".ts", ".wmv", ".mov"];
export const ROMANIAN_LANG_CODES = ["ro", "rum", "ron"];

// Extrage sezon+episod dintr-un nume de fișier (ex. "...S08E01..." → {8, 1}).
// Folosit atât pentru a asocia fiecare fișier media cu subtitrarea lui
// corectă într-un pachet de episoade, cât și pentru a determina sezonul
// pachetului (din primul fișier media care se potrivește).
export function parseSeasonEpisode(name: string): { season: number; episode: number } | null {
  const m = name.match(/S(\d{1,3})E(\d{1,3})/i);
  if (!m) return null;
  return { season: Number(m[1]), episode: Number(m[2]) };
}

// Cheie normalizată (ex. "S08E01"), indiferent de padding-ul original.
export function episodeKeyFrom(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

// Cheie normalizată pentru potrivire exactă între un fișier media și
// subtitrarea/candidatul lui.
export function extractEpisodeKey(name: string): string | null {
  const se = parseSeasonEpisode(name);
  return se ? episodeKeyFrom(se.season, se.episode) : null;
}

// Verificare de limbă pentru un .srt deja bundle-uit în torrent — NU putem
// presupune că, fiindcă e singurul .srt al fișierului, e automat română (bug
// real: unele lansări vin cu subtitrare engleză bundle-uită, care ar fi fost
// redenumită orbește în .ro.srt și afișată greșit în Plex ca română).
// Diacriticele (ă/â/î/ș/ț) sunt un semnal aproape sigur — engleza nu le are
// niciodată; cuvinte uzuale RO sunt rezervă pentru fișiere fără diacritice.
export function looksRomanian(text: string): boolean {
  const diacritics = (text.match(/[ăâîșțĂÂÎȘȚ]/g) ?? []).length;
  if (diacritics >= 5) return true;
  const lower = ` ${text.toLowerCase()} `;
  const stopwords = [" și ", " pentru ", " este ", " sunt ", " care ", " această ", " nu "];
  return stopwords.filter((w) => lower.includes(w)).length >= 3;
}

export async function fileExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
}

// Verifică prin ffprobe dacă fișierul media are deja un stream (subtitrare
// sau audio) cu tag de limbă română. Dacă ffprobe nu e disponibil pe server
// sau fișierul n-are deloc tag de limbă pe stream-ul respectiv, tratăm ca
// "necunoscut" (returnăm false) — apelanții preferă să încerce în plus decât
// să presupună greșit că nu e nevoie.
async function hasRomanianLanguageStream(
  mediaAbsPath: string,
  streamSelector: "s" | "a",
): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        streamSelector,
        "-show_entries",
        "stream_tags=language",
        "-of",
        "csv=p=0",
        mediaAbsPath,
      ],
      { timeout: 20_000 },
    );
    const langs = stdout
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean);
    return langs.some((l) => ROMANIAN_LANG_CODES.includes(l));
  } catch {
    return false;
  }
}

// Verifică dacă fișierul media are deja un stream de subtitrare în română
// încorporat — mai bine încercăm să adăugăm un .srt în plus decât să lăsăm
// filmul fără subtitrare deloc.
export async function hasEmbeddedRomanianSubtitle(mediaAbsPath: string): Promise<boolean> {
  return hasRomanianLanguageStream(mediaAbsPath, "s");
}

// Verifică dacă track-ul audio principal e deja în română — conținut nativ
// românesc (emisiuni TV, producții locale) n-are nevoie de nicio subtitrare.
async function hasRomanianAudio(mediaAbsPath: string): Promise<boolean> {
  return hasRomanianLanguageStream(mediaAbsPath, "a");
}

// Platforme/surse cunoscute care oferă exclusiv conținut audio nativ în
// română (emisiuni TV românești) — indiciu de rezervă când ffprobe nu poate
// confirma limba audio (fișier fără tag de limbă setat pe track, frecvent la
// rip-uri TV). Listă mică, extensibilă — adaugă alte platforme aici dacă
// apar cazuri similare.
const ROMANIAN_ONLY_PLATFORM_TAGS = ["ANTP"]; // Antena Play

function knownRomanianOnlySourceTag(mediaFileName: string): string | null {
  return ROMANIAN_ONLY_PLATFORM_TAGS.find((tag) => findTag(mediaFileName, [tag]) === tag) ?? null;
}

// Verifică (audio ffprobe, apoi heuristica de platformă) dacă fișierul e deja
// conținut românesc, care nu are nevoie de nicio subtitrare — evită erori
// "fără IMDb id" pentru emisiuni TV locale (fără prezență pe IMDb) și evită
// să căutăm inutil o subtitrare pentru ceva deja în română.
export async function detectAlreadyRomanianContent(
  mediaAbsPath: string,
  mediaFileName: string,
): Promise<string | null> {
  if (await hasRomanianAudio(mediaAbsPath)) {
    return "conținutul audio e deja în română (detectat prin ffprobe) — nu necesită subtitrare";
  }
  const platformTag = knownRomanianOnlySourceTag(mediaFileName);
  if (platformTag) {
    return `sursă cunoscută cu conținut exclusiv românesc (${platformTag}) — presupun audio deja în română, nu caut subtitrare`;
  }
  return null;
}
