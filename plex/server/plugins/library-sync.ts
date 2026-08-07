// Nitro plugin — sincronizare librărie Plex existentă, la boot + periodic
// (interval configurabil din alert_settings.library_sync_interval_min,
// implicit 60 minute). Pattern similar cu plex-session-tracker.ts din
// FaikkitBox, dar fișier propriu, independent, în plex/.
export default function () {
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tick() {
    try {
      const { runLibrarySync } = await import("../../src/lib/library-sync");
      const { getAlertSettings } = await import("../../src/lib/plex-db");
      const result = await runLibrarySync();
      if (result.inserted > 0) {
        console.log(
          `[library-sync] ${result.scanned} titluri scanate, ${result.inserted} adăugate (owner implicit Faicu).`,
        );
      }
      const settings = getAlertSettings();
      const intervalMs = Math.max(5, settings.library_sync_interval_min) * 60_000;
      timer = setTimeout(tick, intervalMs);
    } catch (err) {
      console.warn("[library-sync] Eroare la sincronizare:", err);
      timer = setTimeout(tick, 60 * 60_000);
    }
  }

  // Pornește după un delay scurt, ca restul serverului (DB, env) să fie gata.
  timer = setTimeout(tick, 5_000);

  return () => {
    if (timer) clearTimeout(timer);
  };
}
