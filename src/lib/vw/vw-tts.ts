// ---------------------------------------------------------------------------
// Vocea salutului VW Welcome: textul e rostit de Piper (voce neurală locală,
// ro_RO-mihai-medium, în data/piper) și transformat de ffmpeg în MP3, cu 0,4 s de
// liniște la început (ieșirea audio a navigației pornește abia cu primul sunet).
// Rezultatele se păstrează pe disc după textul exact. Server-only.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

export const MAX_TTS_CHARS = 300;
const MAX_CACHED = 500;

function piperDir(): string {
  return process.env.FAIKKITBOX_PIPER_DIR ?? "/opt/faikkitbox/data/piper";
}

function cacheDir(): string {
  return process.env.FAIKKITBOX_VW_TTS_DIR ?? "/opt/faikkitbox/data/vw-tts";
}

function run(cmd: string, args: string[], input?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout: 20_000 }, (err, _out, stderr) => {
      if (err) reject(new Error(`${cmd}: ${err.message} ${String(stderr).slice(-300)}`));
      else resolve();
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

/** Păstrează doar cele mai noi MAX_CACHED fișiere. */
function prune(dir: string): void {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".mp3"))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(MAX_CACHED)) rmSync(join(dir, f), { force: true });
}

/** MP3-ul cu textul rostit (din cache sau generat acum). */
export async function synthesize(text: string): Promise<Buffer> {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_TTS_CHARS);
  if (!clean) throw new Error("Text gol");
  const dir = cacheDir();
  mkdirSync(dir, { recursive: true });
  const id = createHash("sha1").update(`mihai-medium|${clean}`).digest("hex");
  const mp3 = join(dir, `${id}.mp3`);
  if (!existsSync(mp3)) {
    const wav = join(dir, `${id}.wav`);
    const piper = piperDir();
    try {
      await run(
        join(piper, "piper", "piper"),
        ["--model", join(piper, "ro_RO-mihai-medium.onnx"), "--output_file", wav],
        clean,
      );
      await run("ffmpeg", [
        "-loglevel",
        "error",
        "-y",
        "-i",
        wav,
        "-af",
        "adelay=400:all=1",
        "-b:a",
        "96k",
        `${mp3}.tmp.mp3`,
      ]);
      // Redenumirea e atomică: o cerere paralelă nu vede niciodată un MP3 pe jumătate.
      renameSync(`${mp3}.tmp.mp3`, mp3);
    } finally {
      rmSync(wav, { force: true });
      rmSync(`${mp3}.tmp.mp3`, { force: true });
    }
    prune(dir);
  }
  return readFileSync(mp3);
}
