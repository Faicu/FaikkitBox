// ---------------------------------------------------------------------------
// Plugin: sincronizare periodică media ↔ qBittorrent ↔ subtitrări, pentru
// TOATĂ biblioteca (nu doar titlurile fixate — asta face pinned-watcher.ts).
// Rulează automat, fără acțiune din UI:
//   1. Completează `media` cu orice titlu din Plex încă neindexat (echivalent
//      butonului „Completează din TMDB” din Bibliotecă).
//   2. Leagă retroactiv torrent_hash pentru rândurile `media` care au deja
//      plex_rating_key dar nu și torrent — cazul unui torrent adăugat direct
//      în qBittorrent, în afara aplicației, care altfel rămânea "nu știm ce
//      torrent corespunde" până la o rulare manuală.
//   3. Verifică/corectează subtitrarea RO pentru toate torrentele active din
//      qBittorrent (echivalent butonului „Verifică subtitrări” din
//      Bibliotecă) — ca un torrent nou legat la pasul 2 să capete automat și
//      verificarea subtitrării, nu doar statusul actualizat.
// Cele trei rulează secvențial (nu paralel), ca să nu suprapunem cereri grele
// către Plex/qBittorrent/TMDB.
// ---------------------------------------------------------------------------

const FIRST_RUN_DELAY_MS = 2 * 60 * 1000; // 2 min după pornirea serviciului
const CYCLE_INTERVAL_MS = 2 * 60 * 60 * 1000; // la fiecare 2 ore

async function runCycle(): Promise<void> {
  try {
    const { runMediaBackfillIfIdle, linkUnmatchedTorrents } =
      await import("../../src/lib/media-backfill");
    await runMediaBackfillIfIdle();
    const { checked, linked } = await linkUnmatchedTorrents();
    if (checked > 0) {
      console.log(
        `[media-torrent-sync] Legătură retroactivă: ${linked}/${checked} titluri legate de torrente active`,
      );
    }
  } catch (e) {
    console.warn("[media-torrent-sync] Completare/legătură media eșuată:", e);
  }

  try {
    const { runSubtitleBackfillIfIdle } = await import("../../src/lib/filelist/download");
    await runSubtitleBackfillIfIdle();
  } catch (e) {
    console.warn("[media-torrent-sync] Verificare subtitrări eșuată:", e);
  }
}

export default function () {
  import("../../src/lib/console-capture").then(({ installConsoleErrorCapture }) =>
    installConsoleErrorCapture(),
  );

  setTimeout(() => {
    runCycle().catch((e) => console.warn("[media-torrent-sync] Prima rulare eșuată:", e));
  }, FIRST_RUN_DELAY_MS);

  setInterval(() => {
    runCycle().catch((e) => console.warn("[media-torrent-sync] Rulare periodică eșuată:", e));
  }, CYCLE_INTERVAL_MS);
}
