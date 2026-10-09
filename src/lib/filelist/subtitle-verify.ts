// ---------------------------------------------------------------------------
// Verificarea conținutului unei subtitrări față de fișierul media, înainte să
// rămână lângă el — ultima plasă după filtrele de episod de la căutare
// (subtitle-sources.ts). Numele pot minți (upload etichetat greșit, arhivă
// subs.ro cu alt episod înăuntru); conținutul nu.
//
// Găsit pe 9 oct. 2026: MobLand S02E02 și S02E03 aveau, byte cu byte,
// subtitrarea lui S02E01 — subs.ro avea doar arhiva cu E01, iar înainte de
// 643c7d2 orice episod o primea.
//
// Trei verificări, fiecare sărită dacă nu are pe ce se baza:
//  1. limba — trebuie să pară română (looksRomanian);
//  2. durata — ultima replică nu poate fi mult după sfârșitul fișierului;
//  3. sincronizarea — comparată cu o subtitrare text deja încorporată în
//     fișier (de obicei engleza, la WEB-DL): în același episod se vorbește
//     în aceleași momente, cu cel mult un decalaj constant (alt release).
//     Comparăm intervalele de vorbire, nu începuturile replicilor: un
//     traducător își împarte replicile altfel decât engleza SDH, iar prima
//     variantă (pe începuturi) dădea doar 0,17–0,20 la The Rookie S08, cu
//     subtitrările corecte. Pe intervale: episodul corect 0,72–1,00 (The
//     Rookie, MobLand, o traducere automată Subtitle Cat), altul ≤ 0,29.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { looksRomanian } from "./subtitle-checks";

const execFileAsync = promisify(execFile);

// Cât poate depăși ultima replică durata fișierului (genericul de final,
// diferențe mici între release-uri).
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

// Corelația (Pearson) dintre „se vorbește / nu se vorbește" în cele două
// subtitrări, pe felii de BIN_S secunde, la cel mai bun decalaj constant
// (± MAX_OFFSET_S). 1 = aceleași momente de vorbire, ~0 = fără legătură.
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

// Prima subtitrare text încorporată care nu e română (o română încorporată
// ar fi oprit oricum pipeline-ul la pasul 1a), extrasă ca SRT.
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
        "stream=index,codec_name:stream_tags=language",
        "-of",
        "json",
        mediaAbsPath,
      ],
      { timeout: 20_000 },
    );
    const streams = (
      JSON.parse(stdout) as {
        streams?: Array<{ index: number; codec_name?: string; tags?: { language?: string } }>;
      }
    ).streams;
    const ref = (streams ?? []).find(
      (s) =>
        TEXT_SUBTITLE_CODECS.includes(s.codec_name ?? "") &&
        !ROMANIAN_LANG_CODES.includes((s.tags?.language ?? "").toLowerCase()),
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

// Sincronizare „bună": fără decalaj și cu momentele de vorbire potrivite.
// Peste ea nu mai căutăm altă variantă (subtitle-pipeline.ts), iar
// subtitrarea e raportată ca potrivire sigură, nu „aproximativă" — oricât de
// diferit ar fi numele release-ului. The Invite: varianta cptclaudiu, pentru
// alt release (2160p), dădea 0,91 fără decalaj; cea aleasă după nume
// (BluRay 1080p) 0,53 cu ~3 s decalaj.
//
// Pragul de corelație e calibrat pe auditul bibliotecii (9 oct. 2026):
// traducerile făcute de om, sincronizate, dau 0,62–1,00 — cele sub 0,8 doar
// fiindcă traducătorul unește sau taie replici. Ce contează e decalajul:
// variantele pentru alt montaj (The Rookie S08E14 de la Amazon pe un fișier
// HULU) ieșeau 0,67 cu 2 s decalaj, crescând spre final.
const GOOD_SYNC_SCORE = 0.6;
const GOOD_SYNC_MAX_OFFSET_S = 0.5;

export interface SyncMeasure {
  score: number;
  offset: number;
}

export function isWellSynced(sync: SyncMeasure): boolean {
  return sync.score >= GOOD_SYNC_SCORE && Math.abs(sync.offset) <= GOOD_SYNC_MAX_OFFSET_S;
}

export interface SubtitleCheck {
  // null = pare în regulă (sau nu avem cum ști); altfel motivul respingerii.
  reason: string | null;
  // Sincronizarea măsurată față de subtitrarea încorporată; null dacă
  // fișierul n-are una (sau sunt prea puține replici ca să conteze).
  sync: SyncMeasure | null;
}

// Un verificator per fișier media: durata și subtitrarea de referință se
// citesc o singură dată, chiar dacă verificăm mai mulți candidați (un .srt
// existent, apoi variantele descărcate).
export function createSubtitleVerifier(mediaAbsPath: string) {
  let duration: Promise<number | null> | null = null;
  let reference: Promise<SrtTiming | null> | null = null;

  return async function verify(text: string): Promise<SubtitleCheck> {
    const reject = (reason: string): SubtitleCheck => ({ reason, sync: null });
    if (!looksRomanian(text)) return reject("nu pare să fie în română");

    const timing = parseSrtTiming(text);
    if (timing.starts.length === 0)
      return reject("nu conține nicio replică cu timp (nu e un SRT valid)");

    duration ??= mediaDurationSeconds(mediaAbsPath);
    const d = await duration;
    if (d != null && timing.lastEnd > d + DURATION_SLACK_S) {
      return reject(
        `ultima replică e la ${formatTime(timing.lastEnd)}, dar fișierul are doar ${formatTime(d)} — e pentru alt episod sau altă versiune`,
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
