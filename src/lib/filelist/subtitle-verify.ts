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
import { formatSubtitleNumber as num } from "./subtitle-outcomes";

const execFileAsync = promisify(execFile);

// Cât poate depăși ultima replică durata fișierului (generic, release-uri).
const DURATION_SLACK_S = 120;
// Corelația minimă a intervalelor de vorbire (vezi speechCorrelation).
const MIN_SPEECH_CORRELATION = 0.45;
// Prea puține replici fac comparația nesigură — atunci nu decidem.
const MIN_CUES = 40;
// Decalajul maxim căutat între cele două subtitrări și rezoluția comparației.
// The Shield S01 pe Amazon (1 nov. 2026): 60–95 s în plus la început față de
// DVD/BluRay — cu 60 s, traducerile corecte ieșeau „alt montaj”.
const MAX_OFFSET_S = 180;
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

// Corecția timpilor: t' = t × ratio + shift; după fiecare tăietură `at` (în
// timpul subtitrării după viteză) deplasarea devine a ei.
export interface Retime {
  ratio: number;
  shift: number;
  cuts?: Array<{ at: number; shift: number }>;
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

// `anchor` = începutul replicii: o replică peste o tăietură se mută întreagă,
// altfel sfârșitul ei ar putea ajunge înaintea începutului.
export function applyRetime(t: number, retime: Retime, anchor = t): number {
  const at = anchor * retime.ratio;
  let shift = retime.shift;
  for (const cut of retime.cuts ?? []) if (at >= cut.at) shift = cut.shift;
  return Math.max(0, t * retime.ratio + shift);
}

function retimeIntervals(ivs: Array<[number, number]>, retime: Retime): Array<[number, number]> {
  return ivs.map(([a, b]) => [applyRetime(a, retime), applyRetime(b, retime, a)]);
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

// Decalaj constant pe bucăți: ediția are câteva secunde în plus într-un loc
// (The Shield S01E13 pe Amazon: −1,5 s până la jumătate, −11 s după; E03:
// −62 s, apoi −67 s). Ferestrele cu același decalaj se grupează; tăietura
// dintre grupuri se caută la jumătate de secundă.
const PIECE_WINDOWS = 8;
const PIECE_MAX_GROUPS = 3;
const PIECE_MIN_WINDOWS = 2;
const PIECE_GROUP_TOLERANCE_S = 1.5;

function piecewiseRetime(
  candidate: Array<[number, number]>,
  reference: Array<[number, number]>,
  ratio: number,
): Retime | null {
  const scaled = retimeIntervals(candidate, { ratio, shift: 0 });
  const n = binCount(scaled, reference);
  const c = toSpeechBins(scaled, n);
  const r = toSpeechBins(reference, n);
  const maxShift = Math.round(MAX_OFFSET_S / BIN_S);
  const w = Math.floor(n / PIECE_WINDOWS);
  if (w === 0) return null;

  const groups: Array<{ lo: number; hi: number; offsets: number[] }> = [];
  for (let s = 0; s < PIECE_WINDOWS; s++) {
    const lo = s * w;
    const hi = s === PIECE_WINDOWS - 1 ? n : lo + w;
    let speech = 0;
    for (let i = lo; i < hi; i++) speech += c[i];
    const last = groups[groups.length - 1];
    // Fără dialog: lipită de grupul curent, nu decide nimic.
    if (speech < RETIME_SEGMENT_MIN_SPEECH_BINS) {
      if (last) last.hi = hi;
      continue;
    }
    const { score, offset } = bestShift(c, r, maxShift, lo, hi);
    if (score < MIN_SPEECH_CORRELATION) return null;
    if (last && Math.abs(offset - last.offsets[0]) <= PIECE_GROUP_TOLERANCE_S) {
      last.hi = hi;
      last.offsets.push(offset);
    } else {
      groups.push({ lo, hi, offsets: [offset] });
    }
  }
  if (groups.length < 2 || groups.length > PIECE_MAX_GROUPS) return null;
  if (groups.some((g) => g.offsets.length < PIECE_MIN_WINDOWS)) return null;

  // Deplasarea exactă a fiecărui grup, pe tot grupul.
  const near = Math.round(3 / BIN_S);
  const shifts = groups.map((g) => {
    const mid = g.offsets[Math.floor(g.offsets.length / 2)] / BIN_S;
    let best = { score: -1, k: Math.round(mid) };
    for (let k = Math.round(mid) - near; k <= Math.round(mid) + near; k++) {
      // Feliile potrivite cu referința mutată cu k.
      let x = 0;
      for (let i = Math.max(g.lo, -k); i < g.hi && i + k < n; i++) x += c[i] & r[i + k];
      if (x > best.score) best = { score: x, k };
    }
    return best.k;
  });

  // Tăietura dintre două grupuri: poziția care potrivește cele mai multe
  // felii, cu deplasarea din stânga înainte și cea din dreapta după.
  const cuts: Array<{ at: number; shift: number }> = [];
  for (let g = 0; g + 1 < groups.length; g++) {
    const ka = shifts[g];
    const kb = shifts[g + 1];
    const lo = groups[g].lo + Math.floor((groups[g].hi - groups[g].lo) / 2);
    const hi = groups[g + 1].lo + Math.floor((groups[g + 1].hi - groups[g + 1].lo) / 2);
    const hit = (i: number, k: number) => (i + k >= 0 && i + k < n ? c[i] & r[i + k] : 0);
    let right = 0;
    for (let i = lo; i < hi; i++) right += hit(i, kb);
    let left = 0;
    let best = { score: right, p: lo };
    for (let p = lo; p < hi; p++) {
      left += hit(p, ka);
      right -= hit(p, kb);
      if (left + right > best.score) best = { score: left + right, p: p + 1 };
    }
    cuts.push({ at: best.p * BIN_S, shift: kb * BIN_S });
  }
  return { ratio, shift: shifts[0] * BIN_S, cuts };
}

// Sincronizarea, cu corecția timpilor dacă e nevoie de una: întâi viteza (doar
// cu un câștig clar), apoi deplasarea — una singură sau, dacă nu ține peste
// tot, pe bucăți. După corecție decalajul rămas e 0.
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
  const single: Retime = { ratio: best.ratio, shift: best.offset };
  const identity = best.ratio === 1 && Math.abs(best.offset) <= GOOD_SYNC_MAX_OFFSET_S;
  if (retimeHoldsEverywhere(candidate, reference, identity ? { ratio: 1, shift: 0 } : single)) {
    if (identity) return plain;
    return { score: best.score, offset: 0, retime: { ...single, label: best.label } };
  }

  const pieces = piecewiseRetime(candidate, reference, best.ratio);
  if (pieces && retimeHoldsEverywhere(candidate, reference, pieces)) {
    const after = speechCorrelation(retimeIntervals(candidate, pieces), reference);
    if (
      after.score >= plain.score + RATIO_MIN_GAIN &&
      Math.abs(after.offset) <= GOOD_SYNC_MAX_OFFSET_S
    )
      return { score: after.score, offset: 0, retime: { ...pieces, label: best.label } };
  }
  return plain;
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
      const start = t(h1, m1, s1, ms1);
      return `${fmt(applyRetime(start, retime))}${arrow}${fmt(applyRetime(t(h2, m2, s2, ms2), retime, start))}`;
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

// Referința de rezervă, fără subtitrare text încorporată (BluRay-urile au de
// obicei doar PGS): momentele de vorbire din audio — canalul central la 5.1/7.1
// (aproape doar dialog), altfel amestecul. Mult mai zgomotoasă decât o
// subtitrare (corelații 0,15–0,45 pentru varianta corectă, The Shield S01
// ROVERS, 1 nov. 2026), dar decalajul îl găsește — deci doar pentru el.
export async function audioSpeechIntervals(
  mediaAbsPath: string,
): Promise<Array<[number, number]> | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=channels,channel_layout",
        "-of",
        "json",
        mediaAbsPath,
      ],
      { timeout: 20_000 },
    );
    const stream = (
      JSON.parse(stdout) as { streams?: Array<{ channels?: number; channel_layout?: string }> }
    ).streams?.[0];
    if (!stream?.channels) return null;
    const pan =
      stream.channels >= 6
        ? "pan=mono|c0=FC,"
        : stream.channels === 2
          ? "pan=mono|c0=0.5*c0+0.5*c1,"
          : "";
    // silencedetect scrie în stderr; ~3 s pe un episod de 45 min.
    const { stderr } = await execFileAsync(
      "ffmpeg",
      [
        "-nostats",
        "-v",
        "info",
        "-i",
        mediaAbsPath,
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-af",
        `${pan}highpass=f=200,lowpass=f=3500,silencedetect=noise=-32dB:d=0.35`,
        "-f",
        "null",
        "-",
      ],
      { timeout: 300_000, maxBuffer: 64 * 1024 * 1024 },
    );
    const intervals: Array<[number, number]> = [];
    let speechStart = 0;
    for (const m of stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
      const t = Number(m[2]);
      if (m[1] === "start") {
        if (t > speechStart) intervals.push([speechStart, t]);
      } else speechStart = t;
    }
    const d = await mediaDurationSeconds(mediaAbsPath);
    if (d != null && d > speechStart) intervals.push([speechStart, d]);
    return intervals.length >= MIN_CUES ? intervals : null;
  } catch {
    return null;
  }
}

// Deplasarea după audio: doar când decalajul e mare și același în cel puțin
// trei sferturi din fișier. Precizia e ~1 s la decalajele mari (The Shield:
// −59,3 față de −59, −75 față de −75), dar la cele mici greșea cu până la
// 2,5 s (E07: −3,4 față de −1) — sub 5 s nu atingem nimic. Nu respinge nimic:
// corelațiile cu audio sunt prea mici ca să judece traducerea.
const AUDIO_MIN_SHIFT_S = 5;
const AUDIO_ONSET_TOLERANCE_S = 0.5;
const AUDIO_QUARTER_TOLERANCE_S = 1;
const AUDIO_MIN_AGREEING_QUARTERS = 3;

export function audioShift(
  candidate: Array<[number, number]>,
  speech: Array<[number, number]>,
): Retime | null {
  const n = binCount(candidate, speech);
  const c = toSpeechBins(candidate, n);
  const r = toSpeechBins(speech, n);
  const global = bestShift(c, r, Math.round(MAX_OFFSET_S / BIN_S));
  if (Math.abs(global.offset) <= AUDIO_MIN_SHIFT_S) return null;
  const q = Math.floor(n / 4);
  const near = Math.round(10 / BIN_S);
  const k = Math.round(global.offset / BIN_S);
  let agreeing = 0;
  for (let s = 0; s < 4; s++) {
    const lo = s * q;
    const hi = s === 3 ? n : lo + q;
    // Fereastra ±10 s în jurul decalajului global: deplasăm candidatul cu k.
    let best = { hits: -1, k: 0 };
    for (let j = k - near; j <= k + near; j++) {
      let hits = 0;
      for (let i = Math.max(lo, -j); i < hi && i + j < n; i++) hits += c[i] & r[i + j];
      if (hits > best.hits) best = { hits, k: j };
    }
    if (Math.abs(best.k - k) * BIN_S <= AUDIO_QUARTER_TOLERANCE_S) agreeing++;
  }
  if (agreeing < AUDIO_MIN_AGREEING_QUARTERS) return null;
  return { ratio: 1, shift: refineAudioShift(candidate, speech, global.offset) };
}

// Rafinarea la 0,1 s: câte începuturi de replică cad lângă un început de
// vorbire (±0,5 s), în ±3 s de decalajul grosier.
function refineAudioShift(
  candidate: Array<[number, number]>,
  speech: Array<[number, number]>,
  coarse: number,
): number {
  const starts = candidate.map((c) => c[0]).sort((a, b) => a - b);
  const onsets = speech.map((s) => s[0]).sort((a, b) => a - b);
  let best = { hits: -1, shift: coarse };
  for (let step = -30; step <= 30; step++) {
    const shift = coarse + step / 10;
    let hits = 0;
    let j = 0;
    for (const s of starts) {
      const t = s + shift;
      while (j < onsets.length && onsets[j] < t - AUDIO_ONSET_TOLERANCE_S) j++;
      if (j < onsets.length && onsets[j] <= t + AUDIO_ONSET_TOLERANCE_S) hits++;
    }
    if (hits > best.hits) best = { hits, shift: Math.round(shift * 10) / 10 };
  }
  return best.shift;
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
  // Fără subtitrare încorporată: deplasarea găsită după audio, de aplicat la
  // scriere. Nu spune nimic despre calitatea traducerii.
  audioRetime?: Retime;
}

// Un verificator per fișier: durata și referința se citesc o singură dată
// pentru toți candidații.
export function createSubtitleVerifier(mediaAbsPath: string) {
  let duration: Promise<number | null> | null = null;
  let reference: Promise<SrtTiming | null> | null = null;
  let audio: Promise<Array<[number, number]> | null> | null = null;

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

    if (!sync) {
      if (ref || timing.starts.length < MIN_CUES) return { reason: null, sync: null };
      audio ??= audioSpeechIntervals(mediaAbsPath);
      const speech = await audio;
      const shift = speech ? audioShift(timing.intervals, speech) : null;
      return { reason: null, sync: null, ...(shift ? { audioRetime: shift } : {}) };
    }
    if (sync.score < MIN_SPEECH_CORRELATION) {
      return reject(
        `momentele de vorbire nu se potrivesc cu subtitrarea încorporată în fișier (corelație ${num(sync.score)}, minimum ${num(MIN_SPEECH_CORRELATION)}) — e pentru alt episod sau altă versiune`,
        `nesincronizată (${num(sync.score)}) — alt episod sau alt montaj`,
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
      : `decalaj ~${num(Math.abs(sync.offset), 1)} s`;
  return `sincronizare măsurată: corelație ${num(sync.score)}, ${offset}${sync.retime ? `, ${describeRetime(sync.retime)}` : ""}`;
}

const signedSeconds = (v: number) => `${v > 0 ? "+" : "−"}${num(Math.abs(v), 1)} s`;

// Deplasarea, ca text: una singură, sau pe bucăți cu momentul fiecărei schimbări.
function shiftParts(retime: Retime): { short: string; long: string } | null {
  if (retime.cuts?.length) {
    const steps = retime.cuts.map((c) => `${signedSeconds(c.shift)} de la ${formatTime(c.at)}`);
    return {
      short: `pe bucăți: ${[signedSeconds(retime.shift), ...retime.cuts.map((c) => signedSeconds(c.shift))].join(" / ")}`,
      long: `deplasată pe bucăți: ${signedSeconds(retime.shift)}, apoi ${steps.join(", apoi ")}`,
    };
  }
  if (Math.abs(retime.shift) <= GOOD_SYNC_MAX_OFFSET_S) return null;
  return {
    short: signedSeconds(retime.shift),
    long: `deplasată cu ${signedSeconds(retime.shift)}`,
  };
}

// Varianta scurtă, pentru eticheta din jurnal.
export function retimeLabel(retime: Retime & { label?: string }): string {
  const parts: string[] = [];
  if (retime.ratio !== 1) parts.push(retime.label ?? `×${retime.ratio.toFixed(4)}`);
  const shift = shiftParts(retime);
  if (shift) parts.push(shift.short);
  return parts.join(", ");
}

export function describeRetime(retime: Retime & { label?: string }): string {
  const parts: string[] = [];
  if (retime.ratio !== 1)
    parts.push(`viteză ajustată ${retime.label ?? `×${retime.ratio.toFixed(4)}`}`);
  const shift = shiftParts(retime);
  if (shift) parts.push(shift.long);
  return `timpi corectați (${parts.join(", ")})`;
}
