// ---------------------------------------------------------------------------
// Plugin: sincronizare periodică media ↔ qBittorrent, pentru TOATĂ biblioteca.
// Rulează automat, fără acțiune din UI (nu mai există butoane manuale
// echivalente — Biblioteca adaugă totul prin Wizard/căutarea manuală
// Filelist; asta rămâne plasa de siguranță pentru cazul rar al unui titlu
// ajuns în Plex/qBittorrent fără să treacă prin aplicație):
//   1. Completează `media` cu orice titlu din Plex încă neindexat.
//   2. Leagă retroactiv torrent_hash pentru rândurile `media` care au deja
//      plex_rating_key dar nu și torrent — cazul unui torrent adăugat direct
//      în qBittorrent, în afara aplicației, care altfel rămânea "nu știm ce
//      torrent corespunde" până la o rulare manuală.
//   2b. Curăță placeholder-ele de pachet de sezon (episode NULL) rămase
//       orfane — cazul în care toate episoadele reale s-au legat deja de
//       Plex înainte ca acest ciclu să mai proceseze ceva nou pentru acel
//       serial (vezi cleanupOrphanSeasonPackPlaceholders în media.ts).
// Verificarea de subtitrări NU se mai declanșează automat de aici — userul
// verifică/corectează punctual, per titlu, din Bibliotecă, când primește
// notificare că un titlu n-a primit subtitrare RO la descărcare.
// ---------------------------------------------------------------------------

const FIRST_RUN_DELAY_MS = 2 * 60 * 1000; // 2 min după pornirea serviciului
const CYCLE_INTERVAL_MS = 2 * 60 * 60 * 1000; // la fiecare 2 ore

async function runCycle(): Promise<void> {
  try {
    const { runMediaBackfillIfIdle, linkUnmatchedTorrents } =
      await import("../../src/lib/media/media-backfill");
    await runMediaBackfillIfIdle();

    const { checked, linked } = await linkUnmatchedTorrents();
    if (checked > 0) {
      console.log(
        `[media-torrent-sync] Legătură retroactivă: ${linked}/${checked} titluri legate de torrente active`,
      );
    }

    const { cleanupOrphanSeasonPackPlaceholders } = await import("../../src/lib/media/media");
    const cleaned = cleanupOrphanSeasonPackPlaceholders();
    if (cleaned > 0) {
      console.log(`[media-torrent-sync] Placeholder-e de pachet orfane șterse: ${cleaned}`);
    }
  } catch (e) {
    console.warn("[media-torrent-sync] Completare/legătură media eșuată:", e);
  }
}

export default function () {
  import("../../src/lib/errors/console-capture").then(({ installConsoleErrorCapture }) =>
    installConsoleErrorCapture(),
  );

  setTimeout(() => {
    runCycle().catch((e) => console.warn("[media-torrent-sync] Prima rulare eșuată:", e));
  }, FIRST_RUN_DELAY_MS);

  setInterval(() => {
    runCycle().catch((e) => console.warn("[media-torrent-sync] Rulare periodică eșuată:", e));
  }, CYCLE_INTERVAL_MS);
}
