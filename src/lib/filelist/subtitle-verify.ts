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

// Felii de BIN_S secunde: 1 unde se vorbește.
function toSpeechBins(ivs: Array<[number, number]>, n: number): Uint8Array {
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
}

// Cel mai bun decalaj constant pentru feliile [lo, hi) ale candidatului.
function bestShift(
  c: Uint8Array,
  r: Uint8Array,
  maxShift: number,
  lo = 0,
  hi = c.length,
): { score: number; offset: number } {
  const n = c.length;
  let best = { score: -1, offset: 0 };
  for (let k = -maxShift; k <= maxShift; k++) {
    let m = 0;
    let sx = 0;
    let sy = 0;
    let sxy = 0;
    for (let i = Math.max(lo, -k); i < hi && i + k < n; i++) {
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

function binCount(...sets: Array<Array<[number, number]>>): number {
  let lastEnd = 0;
  for (const ivs of sets) for (const i of ivs) lastEnd = Math.max(lastEnd, i[1]);
  return Math.ceil(lastEnd / BIN_S) + 1;
}

// Corelația Pearson dintre „se vorbește / nu” pe felii de BIN_S secunde, la
// cel mai bun decalaj constant. 1 = aceleași momente, ~0 = fără legătură.
export function speechCorrelation(
  candidate: Array<[number, number]>,
  reference: Array<[number, number]>,
): { score: number; offset: number } {
  if (candidate.length === 0 || reference.length === 0) return { score: 0, offset: 0 };
  const n = binCount(candidate, reference);
  return bestShift(
    toSpeechBins(candidate, n),
    toSpeechBins(reference, n),
    Math.round(MAX_OFFSET_S / BIN_S),
  );
}

// Corecția timpilor: t' = t × ratio + shift.
export interface Retime {
  ratio: number;
  shift: number;
}

// Conversiile obișnuite între cadre pe secundă. The Dog Stars (1 nov. 2026):
// traducerea corectă aluneca de la 0,5 la 6 s pe film (24 față de 23,976) —
// 0,56 măsurat, 0,86 fără decalaj după corecție.
const FRAME_RATE_RATIOS: Array<{ ratio: number; label: string }> = [
  { ratio: 1000 / 1001, label: "24 → 23,976 fps" },
  { ratio: 1001 / 1000, label: "23,976 → 24 fps" },
  { ratio: 24 / 25, label: "24 → 25 fps" },
  { ratio: 25 / 24, label: "25 → 24 fps" },
  { ratio: 24000 / 25025, label: "23,976 → 25 fps" },
  { ratio: 25025 / 24000, label: "25 → 23,976 fps" },
];
// Cu cât trebuie să crească corelația ca o altă viteză să fie luată în seamă.
const RATIO_MIN_GAIN = 0.1;
// Verificarea corecției pe bucăți de film: fiecare trebuie să rămână fără
// decalaj. Un alt montaj nu are un decalaj constant — fără verificare, o
// deplasare l-ar fi făcut să pară sincronizat.
const RETIME_SEGMENTS = 4;
const RETIME_SEGMENT_MAX_OFFSET_S = 1;
const RETIME_SEGMENT_MAX_SHIFT_S = 10;
const RETIME_SEGMENT_MIN_SPEECH_BINS = 40;

export function applyRetime(t: number, retime: Retime): number {
  return Math.max(0, t * retime.ratio + retime.shift);
}

function retimeIntervals(ivs: Array<[number, number]>, retime: Retime): Array<[number, number]> {
  return ivs.map(([a, b]) => [applyRetime(a, retime), applyRetime(b, retime)]);
}

// După corecție, fiecare bucată de film trebuie să vorbească în aceleași
// momente cu referința.
function retimeHoldsEverywhere(
  candidate: Array<[number, number]>,
  reference: Array<[number, number]>,
  retime: Retime,
): boolean {
  const corrected = retimeIntervals(candidate, retime);
  const n = binCount(corrected, reference);
  const c = toSpeechBins(corrected, n);
  const r = toSpeechBins(reference, n);
  const seg = Math.floor(n / RETIME_SEGMENTS);
  const maxShift = Math.round(RETIME_SEGMENT_MAX_SHIFT_S / BIN_S);
  for (let s = 0; s < RETIME_SEGMENTS; s++) {
    const lo = s * seg;
    const hi = s === RETIME_SEGMENTS - 1 ? n : lo + seg;
    let speech = 0;
    for (let i = lo; i < hi; i++) speech += c[i];
    // Bucăți aproape fără dialog (generic, scene mute) nu spun nimic.
    if (speech < RETIME_SEGMENT_MIN_SPEECH_BINS) continue;
    const { offset } = bestShift(c, r, maxShift, lo, hi);
    if (Math.abs(offset) > RETIME_SEGMENT_MAX_OFFSET_S) return false;
  }
  return true;
}

// Sincronizarea, cu corecția timpilor dacă e nevoie de una: întâi viteza (doar
// cu un câștig clar), apoi deplasarea. După corecție decalajul rămas e 0.
export function measureSync(
  candidate: Array<[number, number]>,
  reference: Array<[number, number]>,
): SyncMeasure {
  const plain = speechCorrelation(candidate, reference);
  let best: { score: number; offset: number; ratio: number; label?: string } = {
    ...plain,
    ratio: 1,
  };
  for (const { ratio, label } of FRAME_RATE_RATIOS) {
    const m = speechCorrelation(retimeIntervals(candidate, { ratio, shift: 0 }), reference);
    if (m.score >= plain.score + RATIO_MIN_GAIN && m.score > best.score)
      best = { ...m, ratio, label };
  }
  if (best.ratio === 1 && Math.abs(best.offset) <= GOOD_SYNC_MAX_OFFSET_S) return plain;
  const retime: Retime = { ratio: best.ratio, shift: best.offset };
  if (!retimeHoldsEverywhere(candidate, reference, retime)) return plain;
  return { score: best.score, offset: 0, retime: { ...retime, label: best.label } };
}

// Aplică corecția pe un SRT, păstrând restul textului neatins.
export function retimeSrt(text: string, retime: Retime): string {
  const fmt = (t: number) => {
    const ms = Math.round(t * 1000);
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    const pad = (v: number, w = 2) => String(v).padStart(w, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
  };
  return text.replace(
    /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})(\s*-->\s*)(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/g,
    (_all, h1, m1, s1, ms1, arrow, h2, m2, s2, ms2) => {
      const t = (h: string, mi: string, s: string, ms: string) =>
        Number(h) * 3600 + Number(mi) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
      return `${fmt(applyRetime(t(h1, m1, s1, ms1), retime))}${arrow}${fmt(applyRetime(t(h2, m2, s2, ms2), retime))}`;
    },
  );
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
  // Decalajul rămas; 0 când timpii se corectează (`retime`).
  offset: number;
  // Corecția de aplicat la scriere; lipsește când nu e nevoie.
  retime?: Retime & { label?: string };
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
  if (Math.abs(candidate.score - best.score) < SAME_SCORE_EPSILON) {
    // Apoi cea care nu trebuie corectată.
    if (Math.abs(candidate.offset) === Math.abs(best.offset))
      return !candidate.retime && !!best.retime;
    return Math.abs(candidate.offset) < Math.abs(best.offset);
  }
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

    reference ??= embeddedReferenceTiming(mediaAbsPath);
    const ref = await reference;
    const sync =
      ref && ref.starts.length >= MIN_CUES && timing.starts.length >= MIN_CUES
        ? measureSync(timing.intervals, ref.intervals)
        : null;

    // Durata după corecție — o subtitrare pentru 25 fps e mai lungă înainte.
    duration ??= mediaDurationSeconds(mediaAbsPath);
    const d = await duration;
    const lastEnd = sync?.retime ? applyRetime(timing.lastEnd, sync.retime) : timing.lastEnd;
    if (d != null && lastEnd > d + DURATION_SLACK_S) {
      return reject(
        `ultima replică e la ${formatTime(lastEnd)}, dar fișierul are doar ${formatTime(d)} — e pentru alt episod sau altă versiune`,
        `mai lungă decât fișierul (${formatTime(lastEnd)} față de ${formatTime(d)}) — alt episod sau altă versiune`,
      );
    }

    if (!sync) return { reason: null, sync: null };
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
  return `sincronizare măsurată: corelație ${sync.score.toFixed(2)}, ${offset}${sync.retime ? `, ${describeRetime(sync.retime)}` : ""}`;
}

export function describeRetime(retime: Retime & { label?: string }): string {
  const parts: string[] = [];
  if (retime.ratio !== 1)
    parts.push(`viteză ajustată ${retime.label ?? `×${retime.ratio.toFixed(4)}`}`);
  if (Math.abs(retime.shift) > GOOD_SYNC_MAX_OFFSET_S)
    parts.push(
      `deplasată cu ${retime.shift > 0 ? "+" : "−"}${Math.abs(retime.shift).toFixed(1)} s`,
    );
  return `timpi corectați (${parts.join(", ")})`;
}
