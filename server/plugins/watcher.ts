// ---------------------------------------------------------------------------
// Plugin: Watcher — toate sarcinile de fundal ale aplicației, sub un singur
// tact. Registrul e în src/lib/watcher/tasks.ts, motorul în runner.ts.
//
// Înlocuiește șase plugin-uri separate (download-recovery, immich-upload-
// tracker, maintenance, plex-session-tracker, show-watcher, subtitle-retry),
// fiecare cu propriul setTimeout/setInterval, propria gardă și propriul
// try/catch. Singurul plugin rămas alături e server-lifecycle.ts, care nu e o
// sarcină periodică, ci pornirea și oprirea procesului în sine.
//
// Nitro nu așteaptă plugin-urile async, deci funcția rămâne sincronă; importul
// leneș păstrează modulele sarcinilor în afara încărcării de la pornire.
// ---------------------------------------------------------------------------

export default function () {
  void import("../../src/lib/watcher/runner")
    .then(({ startWatcher }) => startWatcher())
    .catch((e) => console.warn("[watcher] Pornirea a eșuat:", e));
}
