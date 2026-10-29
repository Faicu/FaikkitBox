// ---------------------------------------------------------------------------
// Verificarea conținutului unei subtitrări față de fișier — ultima plasă după
// filtrele de episod: numele pot minți, conținutul nu (MobLand S02E02/E03
// aveau byte cu byte subtitrarea lui S02E01, 9 oct. 2026).
//
// Trei verificări, fiecare sărită fără reper:
//  1. limba — trebuie să pară română;
//  2. durata — ultima replică nu poate fi mult după sfârșitul fișierului;
//  3. sincronizarea — față de o subtitrare încorporată (de obicei engleza):
//     în același episod se vorbește în aceleași momente, cu cel mult un
//     decalaj constant. Pe intervale de vorbire, nu pe începuturi de replici
//     (traducătorii împart altfel replicile): episodul corect 0,72–1,00, altul
//     ≤ 0,29.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { looksRomanian } from "./subtitle-checks";

const execFileAsync = promisify(execFile);

// Cât poate depăși ultima replică durata fișierului (generic, release-uri).
const DURATION_SLACK_S = 120;
// Corelația minimă a intervalelor de vorbire (vezi speechCorrelation).
const MIN_SPEECH_CORRELATION = 0.45;
// Prea puține replici fac comparația nesigură — atunci nu decidem.
const MIN_CUES = 40;
// Decalajul maxim căutat între cele două subtitrări și rezoluția comparației.
const MAX_OFFSET_S = 60;
const BIN_S = 0.5;

const TEXT_SUBTITLE_CODECS = ["subrip", "ass", "ssa", "mov_text", "webvtt", "text"];
const ROMANIAN_LANG_CODES = ["ro", "rum", "ron"];

export interface SrtTiming {
  starts: number[];
  intervals: Array<[number, number]>;
  lastEnd: number;
}

export function parseSrtTiming(text: string): SrtTiming {
  const starts: number[] = [];
  const intervals: Array<[number, number]> = [];
  let lastEnd = 0;
  const re =
    /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/g;
  for (const m of text.matchAll(re)) {
    const t = (h: string, mi: string, s: string, ms: string) =>
      Number(h) * 3600 + Number(mi) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
    const start = t(m[1], m[2], m[3], m[4]);
    const end = t(m[5], m[6], m[7], m[8]);
    starts.push(start);
    intervals.push([start, end]);
    lastEnd = Math.max(lastEnd, end);
  }
  starts.sort((a, b) => a - b);
  return { starts, intervals, lastEnd };
}

// Corelația Pearson dintre „se vorbește / nu” pe felii de BIN_S secunde, la
// cel mai bun decalaj constant. 1 = aceleași momente, ~0 = fără legătură.
export function speechCorrelation(
  candidate: Array<[number, number]>,
  reference: Array<[number, number]>,
): { score: number; offset: number } {
  if (candidate.length === 0 || reference.length === 0) return { score: 0, offset: 0 };
  const maxShift = Math.round(MAX_OFFSET_S / BIN_S);
  const lastEnd = Math.max(...candidate.map((i) => i[1]), ...reference.map((i) => i[1]));
  const n = Math.ceil(lastEnd / BIN_S) + 1;
  const toBins = (ivs: Array<[number, number]>) => {
    const v = new Uint8Array(n);
    for (const [a, b] of ivs) {
      for (
        let i = Math.max(0, Math.floor(a / BIN_S));
        i <= Math.min(n - 1, Math.floor(b / BIN_S));
        i++
      )
        v[i] = 1;
    }
    return v;
  };
  const c = toBins(candidate);
  const r = toBins(reference);

  let best = { score: -1, offset: 0 };
  for (let k = -maxShift; k <= maxShift; k++) {
    let m = 0;
    let sx = 0;
    let sy = 0;
    let sxy = 0;
    for (let i = Math.max(0, -k); i < n && i + k < n; i++) {
      const x = c[i];
      const y = r[i + k];
      m++;
      sx += x;
      sy += y;
      sxy += x & y;
    }
    if (m === 0) continue;
    const px = sx / m;
    const py = sy / m;
    const den = Math.sqrt(px * (1 - px) * py * (1 - py));
    const score = den > 0 ? (sxy / m - px * py) / den : 0;
    if (score > best.score) best = { score, offset: k * BIN_S };
  }
  return best;
}

async function mediaDurationSeconds(mediaAbsPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mediaAbsPath],
      { timeout: 20_000 },
    );
    const d = Number(stdout.trim());
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

export interface EmbeddedSubtitleStream {
  index: number;
  codec_name?: string;
  disposition?: { forced?: number; hearing_impaired?: number };
  tags?: { language?: string; title?: string };
}

// Reperul de sincronizare: o subtitrare text completă care nu e română (una
// română ar fi oprit pipeline-ul la pasul 1a). Cele forțate au doar replicile
// în altă limbă — The Fix (29 oct. 2026): pista „English [Forced]”, prima din
// fișier, dădea 0,21 pentru subtitrarea corectă, care cu engleza completă
// dădea 0,91. SDH merge, dar descrierile de sunete o fac mai puțin precisă.
export function pickReferenceStream(
  streams: EmbeddedSubtitleStream[],
): EmbeddedSubtitleStream | null {
  const candidates = streams.filter(
    (s) =>
      TEXT_SUBTITLE_CODECS.includes(s.codec_name ?? "") &&
      !ROMANIAN_LANG_CODES.includes((s.tags?.language ?? "").toLowerCase()) &&
      s.disposition?.forced !== 1 &&
      !/forced/i.test(s.tags?.title ?? ""),
  );
  const isSdh = (s: EmbeddedSubtitleStream) =>
    s.disposition?.hearing_impaired === 1 || /\b(sdh|cc)\b/i.test(s.tags?.title ?? "");
  return candidates.find((s) => !isSdh(s)) ?? candidates[0] ?? null;
}

async function embeddedReferenceTiming(mediaAbsPath: string): Promise<SrtTiming | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "s",
        "-show_entries",
        "stream=index,codec_name:stream_tags=language,title:stream_disposition=forced,hearing_impaired",
        "-of",
        "json",
        mediaAbsPath,
      ],
      { timeout: 20_000 },
    );
    const ref = pickReferenceStream(
      (JSON.parse(stdout) as { streams?: EmbeddedSubtitleStream[] }).streams ?? [],
    );
    if (!ref) return null;
    // Extragerea citește tot containerul — câteva secunde pe un episod.
    const { stdout: srt } = await execFileAsync(
      "ffmpeg",
      ["-v", "error", "-i", mediaAbsPath, "-map", `0:${ref.index}`, "-f", "srt", "-"],
      { timeout: 180_000, maxBuffer: 32 * 1024 * 1024 },
    );
    return parseSrtTiming(srt);
  } catch {
    return null;
  }
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

// Sincronizare „bună”: fără decalaj și cu vorbirea potrivită — nu mai căutăm
// altceva și e raportată ca sigură, oricât de diferit ar fi numele (The Invite:
// cptclaudiu 0,91 fără decalaj, față de varianta aleasă după nume, 0,53 cu
// ~3 s). Prag calibrat pe auditul bibliotecii (9 oct. 2026): traducerile umane
// sincronizate dau 0,62–1,00; ce contează e decalajul — alt montaj ieșea 0,67
// cu 2 s, crescând spre final.
const GOOD_SYNC_SCORE = 0.6;
const GOOD_SYNC_MAX_OFFSET_S = 0.5;

export interface SyncMeasure {
  score: number;
  offset: number;
}

export function isWellSynced(sync: SyncMeasure): boolean {
  return sync.score >= GOOD_SYNC_SCORE && Math.abs(sync.offset) <= GOOD_SYNC_MAX_OFFSET_S;
}

// Potrivire sigură pentru o variantă trecută de verificare: bine sincronizată,
// sau cu release identic și fără decalaj. Euphoria S01 (24 oct. 2026): KiNGS,
// corectă, dădea doar 0,47–0,54 fiindcă traducătorul unește replicile; alt
// montaj pică oricum la decalaj sau corelație (0,09–0,35).
export function isConfidentSync(
  sync: SyncMeasure,
  match: { matchedCriteria: number; maxCriteria: number },
): boolean {
  const exactRelease = match.maxCriteria > 0 && match.matchedCriteria === match.maxCriteria;
  return isWellSynced(sync) || (exactRelease && Math.abs(sync.offset) <= GOOD_SYNC_MAX_OFFSET_S);
}

// Sub diferența asta, corelațiile sunt egale — aceeași traducere pentru mai
// multe release-uri diferă doar la decalaj.
const SAME_SCORE_EPSILON = 0.02;

// Mai bine sincronizată decât `best`? La scor practic egal decide decalajul,
// apoi rămâne cea deja aleasă. Euphoria S01E02: aceeași traducere cu 8 s
// decalaj câștiga la o miime diferență.
export function isBetterSync(candidate: SyncMeasure, best: SyncMeasure | null): boolean {
  if (!best) return true;
  if (Math.abs(candidate.score - best.score) < SAME_SCORE_EPSILON)
    return Math.abs(candidate.offset) < Math.abs(best.offset);
  return candidate.score > best.score;
}

export interface SubtitleCheck {
  // null = pare în regulă (sau nu avem cum ști); altfel motivul respingerii.
  reason: string | null;
  // Același motiv, scurt, pentru afișarea structurată din jurnal.
  short?: string;
  // Sincronizarea față de subtitrarea încorporată; null fără una.
  sync: SyncMeasure | null;
}

// Un verificator per fișier: durata și referința se citesc o singură dată
// pentru toți candidații.
export function createSubtitleVerifier(mediaAbsPath: string) {
  let duration: Promise<number | null> | null = null;
  let reference: Promise<SrtTiming | null> | null = null;

  return async function verify(text: string): Promise<SubtitleCheck> {
    const reject = (reason: string, short: string): SubtitleCheck => ({
      reason,
      short,
      sync: null,
    });
    if (!looksRomanian(text)) return reject("nu pare să fie în română", "nu e în română");

    const timing = parseSrtTiming(text);
    if (timing.starts.length === 0)
      return reject("nu conține nicio replică cu timp (nu e un SRT valid)", "nu e un SRT valid");

    duration ??= mediaDurationSeconds(mediaAbsPath);
    const d = await duration;
    if (d != null && timing.lastEnd > d + DURATION_SLACK_S) {
      return reject(
        `ultima replică e la ${formatTime(timing.lastEnd)}, dar fișierul are doar ${formatTime(d)} — e pentru alt episod sau altă versiune`,
        `mai lungă decât fișierul (${formatTime(timing.lastEnd)} față de ${formatTime(d)}) — alt episod sau altă versiune`,
      );
    }

    reference ??= embeddedReferenceTiming(mediaAbsPath);
    const ref = await reference;
    if (!ref || ref.starts.length < MIN_CUES || timing.starts.length < MIN_CUES) {
      return { reason: null, sync: null };
    }
    const sync = speechCorrelation(timing.intervals, ref.intervals);
    if (sync.score < MIN_SPEECH_CORRELATION) {
      return reject(
        `momentele de vorbire nu se potrivesc cu subtitrarea încorporată în fișier (corelație ${sync.score.toFixed(2)}, minimum ${MIN_SPEECH_CORRELATION}) — e pentru alt episod sau altă versiune`,
        `nesincronizată (${sync.score.toFixed(2).replace(".", ",")}) — alt episod sau alt montaj`,
      );
    }
    return { reason: null, sync };
  };
}

export type SubtitleVerifier = ReturnType<typeof createSubtitleVerifier>;

export function describeSync(sync: SyncMeasure): string {
  const offset =
    Math.abs(sync.offset) <= GOOD_SYNC_MAX_OFFSET_S
      ? "fără decalaj"
      : `decalaj ~${Math.abs(sync.offset).toFixed(1)} s`;
  return `sincronizare măsurată: corelație ${sync.score.toFixed(2)}, ${offset}`;
}
