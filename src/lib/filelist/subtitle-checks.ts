// Pasul 1 — verificări doar de citire, înainte de orice căutare: are deja
// subtitrare/audio română (ffprobe)? pare român un .srt inclus? există un .srt
// pe disc? Scrierile sunt în subtitle-apply.ts.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { findTag } from "./release-scoring";

const execFileAsync = promisify(execFile);

export const MEDIA_EXTENSIONS = [".mkv", ".mp4", ".avi", ".m2ts", ".ts", ".wmv", ".mov"];
const ROMANIAN_LANG_CODES = ["ro", "rum", "ron"];

// Sezon + episod din numele unui fișier („…S08E01…” → {8, 1}) — asocierea
// subtitrărilor într-un pachet și sezonul pachetului.
export function parseSeasonEpisode(name: string): { season: number; episode: number } | null {
  const m = name.match(/S(\d{1,3})E(\d{1,3})/i);
  if (!m) return null;
  return { season: Number(m[1]), episode: Number(m[2]) };
}

// Cheie normalizată (ex. "S08E01"), indiferent de padding-ul original.
export function episodeKeyFrom(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

// Cheia pentru potrivirea exactă fișier–subtitrare.
export function extractEpisodeKey(name: string): string | null {
  const se = parseSeasonEpisode(name);
  return se ? episodeKeyFrom(se.season, se.episode) : null;
}

// Episodul indicat de TOATE reperele unui candidat (API, release, fișier); null
// dacă niciunul n-are SxxEyy sau se contrazic — încredere zero.
export function agreedEpisodeKey(signals: Array<string | null | undefined>): string | null {
  const keys = new Set(
    signals.map((s) => (s ? extractEpisodeKey(s) : null)).filter((k): k is string => k != null),
  );
  return keys.size === 1 ? [...keys][0] : null;
}

// Un candidat OpenSubtitles e pentru `episodeKey`? Reperele care au SxxEyy
// trebuie să fie de acord; fără niciun reper, respins — mai bine fără
// subtitrare decât cu a altui episod.
export function osResultMatchesEpisode(
  r: { release: string; seasonNumber?: number; episodeNumber?: number; fileName?: string },
  episodeKey: string,
): boolean {
  const fromApi =
    r.seasonNumber != null && r.episodeNumber != null
      ? episodeKeyFrom(r.seasonNumber, r.episodeNumber)
      : null;
  return agreedEpisodeKey([fromApi, r.release, r.fileName]) === episodeKey;
}

// Un .srt inclus în torrent nu e român doar fiindcă e singurul — unele lansări
// vin cu engleză, care altfel apărea în Plex ca română. Diacriticele sunt un
// semnal aproape sigur (și ş/ţ cu sedilă, folosite încă de unii traducători);
// cuvintele uzuale sunt rezerva pentru fișiere fără diacritice.
export function looksRomanian(text: string): boolean {
  const diacritics = (text.match(/[ăâîșțşţĂÂÎȘȚŞŢ]/g) ?? []).length;
  if (diacritics >= 5) return true;
  const lower = ` ${text.toLowerCase()} `;
  const stopwords = [" și ", " pentru ", " este ", " sunt ", " care ", " această ", " nu "];
  return stopwords.filter((w) => lower.includes(w)).length >= 3;
}

// Engleză? Un .srt străin în engleză primește „.en”; în altă limbă e pus
// deoparte.
export function looksEnglish(text: string): boolean {
  if (looksRomanian(text)) return false;
  const lower = ` ${text.toLowerCase().replace(/[^a-z']+/g, " ")} `;
  const stopwords = [" the ", " you ", " and ", " what ", " that ", " this ", " is ", " it "];
  return stopwords.filter((w) => lower.includes(w)).length >= 5;
}

export type SrtLanguage = "ro" | "en" | "other";

export function srtContentLanguage(text: string): SrtLanguage {
  if (looksRomanian(text)) return "ro";
  return looksEnglish(text) ? "en" : "other";
}

export async function fileExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
}

// Are fișierul un stream (subtitrare sau audio) marcat român? Fără ffprobe sau
// fără tag de limbă: false — mai bine încercăm în plus decât să presupunem.
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

// Subtitrare română încorporată?
export async function hasEmbeddedRomanianSubtitle(mediaAbsPath: string): Promise<boolean> {
  return hasRomanianLanguageStream(mediaAbsPath, "s");
}

// Audio principal român — conținutul nativ n-are nevoie de subtitrare.
async function hasRomanianAudio(mediaAbsPath: string): Promise<boolean> {
  return hasRomanianLanguageStream(mediaAbsPath, "a");
}

// Platforme cu conținut exclusiv românesc — rezervă când ffprobe nu confirmă
// limba audio (frecvent la rip-uri TV fără tag).
const ROMANIAN_ONLY_PLATFORM_TAGS = ["ANTP"]; // Antena Play

function knownRomanianOnlySourceTag(mediaFileName: string): string | null {
  return ROMANIAN_ONLY_PLATFORM_TAGS.find((tag) => findTag(mediaFileName, [tag]) === tag) ?? null;
}

// Conținut deja românesc (audio sau platformă) — fără căutare inutilă și fără
// eroarea „fără IMDb id” la emisiunile locale.
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

// Limba marcată în numele unui .srt: "ro", "other" sau null. Doar coduri
// cunoscute — „-GRP” din release nu e o limbă.
const RO_TAGS = ["ro", "rum", "ron", "romanian", "romana", "română"];
const OTHER_TAGS = [
  "en",
  "eng",
  "english",
  "fr",
  "fre",
  "fra",
  "french",
  "es",
  "spa",
  "spanish",
  "de",
  "ger",
  "deu",
  "german",
  "it",
  "ita",
  "italian",
  "hu",
  "hun",
  "hungarian",
  "pt",
  "por",
  "portuguese",
  "ru",
  "rus",
  "russian",
  "nl",
  "dut",
  "nld",
  "pl",
  "pol",
  "tr",
  "tur",
  "el",
  "gre",
  "ell",
  "bg",
  "bul",
  "sr",
  "srp",
  "hr",
  "hrv",
  "ar",
  "ara",
];
export function srtLanguageTag(name: string): "ro" | "other" | null {
  const stem = basenameNoExt(name).toLowerCase();
  const words = stem.split(/[._\- ]+/).filter(Boolean);
  const last = words.slice(-2);
  // „Film.ro.forced.srt" / „Film.eng.sdh.srt" — sufixele forced/sdh nu sunt limba.
  const tag = ["forced", "sdh", "cc", "hi"].includes(last[last.length - 1] ?? "")
    ? last[0]
    : last[last.length - 1];
  if (!tag) return null;
  if (RO_TAGS.includes(tag)) return "ro";
  if (OTHER_TAGS.includes(tag)) return "other";
  return null;
}

function basenameNoExt(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.[^.]+$/, "");
}

// Subtitrarea română dintre mai multe .srt-uri: decide conținutul, nu numele.
// Între mai multe române: marcată „ro”, apoi nemarcată, apoi cea mai mare
// (cea „forced” are doar câteva replici).
export function pickRomanianSrt<T extends { name: string; size: number }>(
  files: Array<{ file: T; romanian: boolean }>,
): T | null {
  const rank = (f: T) => {
    const tag = srtLanguageTag(f.name);
    return tag === "ro" ? 0 : tag === null ? 1 : 2;
  };
  const ro = files
    .filter((f) => f.romanian)
    .map((f) => f.file)
    .sort((a, b) => rank(a) - rank(b) || b.size - a.size);
  return ro[0] ?? null;
}
