// ---------------------------------------------------------------------------
// Plugin: reîncercarea zilnică a subtitrărilor care lipsesc (vezi
// src/lib/filelist/subtitle-retry.ts). Bucla e din oră în oră, dar cadența
// reală per torrent (o dată pe zi) stă în DB, pe `subtitle_checked_at`.
//
// Plugin explicit, nu efect secundar de modul — vezi show-watcher.ts.
// ---------------------------------------------------------------------------

// După reluarea descărcărilor (15s) și primul ciclu al urmăririi (45s).
const START_DELAY_MS = 10 * 60_000;
const INTERVAL_MS = 60 * 60_000;

// O rulare poate dura (căutări externe, ffmpeg pe fiecare fișier) — nu o
// pornim peste una încă în curs.
let running = false;

async function run(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { retryMissingSubtitles } = await import("../../src/lib/filelist/subtitle-retry");
    await retryMissingSubtitles();
  } catch (e) {
    console.warn("[subtitle-retry] Rulare eșuată:", e);
  } finally {
    running = false;
  }
}

export default function () {
  setTimeout(run, START_DELAY_MS);
  setInterval(run, INTERVAL_MS);
}
