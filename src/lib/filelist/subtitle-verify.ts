// ---------------------------------------------------------------------------
// Verificarea conținutului unei subtitrări față de fișierul media, înainte să
// rămână lângă el — ultima plasă după filtrele de episod de la căutare
// (subtitle-sources.ts). Numele pot minți (upload etichetat greșit, arhivă
// subs.ro cu alt episod înăuntru); conținutul nu.
//
// Găsit pe 9 oct. 2026: MobLand S02E02 și S02E03 aveau, byte cu byte,
// subtitrarea lui S02E01 — subs.ro avea doar arhiva cu E01, iar înainte de
// 643c7d2 orice episod o primea. Testat pe acele fișiere, verificarea de mai
// jos dă 50–100% replici sincronizate pe episodul corect și sub 10% pe
// celelalte, inclusiv cu un decalaj constant de câteva secunde.
//
// Trei verificări, fiecare sărită dacă nu are pe ce se baza:
//  1. limba — trebuie să pară română (looksRomanian);
//  2. durata — ultima replică nu poate fi mult după sfârșitul fișierului;
//  3. sincronizarea — comparată cu o subtitrare text deja încorporată în
//     fișier (de obicei engleza, la WEB-DL): replicile aceluiași episod încep
//     la aceleași momente, cu cel mult un decalaj constant (alt release).
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { looksRomanian } from "./subtitle-checks";

const execFileAsync = promisify(execFile);

// Cât poate depăși ultima replică durata fișierului (genericul de final,
// diferențe mici între release-uri).
const DURATION_SLACK_S = 120;
// Sub atâtea replici sincronizate (din cele ale subtitrării verificate),
// subtitrarea e pentru alt episod. Măsurat: corect ≥ 0,5, greșit ≤ 0,1.
const MIN_TIMING_MATCH = 0.2;
// Prea puține replici fac proporția nesigură — atunci nu decidem.
const MIN_CUES = 40;
// Decalajul maxim căutat între cele două subtitrări și toleranța unei potriviri.
const MAX_OFFSET_S = 60;
const BIN_S = 0.2;

const TEXT_SUBTITLE_CODECS = ["subrip", "ass", "ssa", "mov_text", "webvtt", "text"];
const ROMANIAN_LANG_CODES = ["ro", "rum", "ron"];

export interface SrtTiming {
  starts: number[];
  lastEnd: number;
}

export function parseSrtTiming(text: string): SrtTiming {
  const starts: number[] = [];
  let lastEnd = 0;
  const re =
    /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/g;
  for (const m of text.matchAll(re)) {
    const t = (h: string, mi: string, s: string, ms: string) =>
      Number(h) * 3600 + Number(mi) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
    starts.push(t(m[1], m[2], m[3], m[4]));
    lastEnd = Math.max(lastEnd, t(m[5], m[6], m[7], m[8]));
  }
  starts.sort((a, b) => a - b);
  return { starts, lastEnd };
}

// Proporția replicilor din `candidate` care încep odată cu o replică din
// `reference`, la cel mai bun decalaj constant (± MAX_OFFSET_S). Pentru
// fiecare replică numărăm o singură dată fiecare decalaj posibil, apoi luăm
// decalajul cu cele mai multe potriviri.
export function timingMatch(
  candidate: number[],
  reference: number[],
): { score: number; offset: number } {
  if (candidate.length === 0 || reference.length === 0) return { score: 0, offset: 0 };
  const counts = new Map<number, number>();
  let lo = 0;
  for (const x of candidate) {
    while (lo < reference.length && reference[lo] < x - MAX_OFFSET_S) lo++;
    const seen = new Set<number>();
    for (let i = lo; i < reference.length && reference[i] <= x + MAX_OFFSET_S; i++) {
      const bin = Math.round((reference[i] - x) / BIN_S);
      if (seen.has(bin)) continue;
      seen.add(bin);
      counts.set(bin, (counts.get(bin) ?? 0) + 1);
    }
  }
  let bestBin = 0;
  let best = 0;
  for (const [bin, n] of counts) {
    if (n > best) {
      best = n;
      bestBin = bin;
    }
  }
  return { score: best / candidate.length, offset: bestBin * BIN_S };
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

// Un verificator per fișier media: durata și subtitrarea de referință se
// citesc o singură dată, chiar dacă verificăm mai mulți candidați (un .srt
// existent, apoi unul descărcat).
export function createSubtitleVerifier(mediaAbsPath: string) {
  let duration: Promise<number | null> | null = null;
  let reference: Promise<SrtTiming | null> | null = null;

  // null = pare în regulă (sau nu avem cum ști); altfel motivul respingerii.
  return async function verify(text: string): Promise<string | null> {
    if (!looksRomanian(text)) return "nu pare să fie în română";

    const timing = parseSrtTiming(text);
    if (timing.starts.length === 0) return "nu conține nicio replică cu timp (nu e un SRT valid)";

    duration ??= mediaDurationSeconds(mediaAbsPath);
    const d = await duration;
    if (d != null && timing.lastEnd > d + DURATION_SLACK_S) {
      return `ultima replică e la ${formatTime(timing.lastEnd)}, dar fișierul are doar ${formatTime(d)} — e pentru alt episod sau altă versiune`;
    }

    reference ??= embeddedReferenceTiming(mediaAbsPath);
    const ref = await reference;
    if (ref && ref.starts.length >= MIN_CUES && timing.starts.length >= MIN_CUES) {
      const { score } = timingMatch(timing.starts, ref.starts);
      if (score < MIN_TIMING_MATCH) {
        return `doar ${Math.round(score * 100)}% din replici se sincronizează cu subtitrarea încorporată în fișier — e pentru alt episod`;
      }
    }
    return null;
  };
}

export type SubtitleVerifier = ReturnType<typeof createSubtitleVerifier>;
