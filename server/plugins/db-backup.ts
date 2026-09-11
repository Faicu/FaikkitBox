// ---------------------------------------------------------------------------
// Plugin: backup zilnic al bazei de date.
//
// La +90s după pornire (ca să nu concureze cu migrările și cu celelalte
// plugin-uri de boot), apoi o dată la 24h. Copia se face doar dacă cea mai
// recentă e mai veche de ~20h — altfel un server care se repornește de
// cinci ori pe zi (deploy-uri) ar face cinci backup-uri identice și ar
// împinge afară din rotație istoricul chiar util.
//
// Ca toate celelalte: plugin explicit, nu efect de modul — vezi nota din
// STRUCTURE.md despre munca de la pornire.
// ---------------------------------------------------------------------------

const FIRST_DELAY_MS = 90_000;
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const MIN_AGE_MS = 20 * 60 * 60 * 1000;

async function backupIfDue(): Promise<void> {
  try {
    const { getBackupStatus, runDbBackup } = await import("../../src/lib/system/db-backup");
    const last = getBackupStatus().lastAt;
    if (last && Date.now() - new Date(last).getTime() < MIN_AGE_MS) return;

    const result = runDbBackup();
    if (result.ok) {
      const mb = (result.file.size / 1024 / 1024).toFixed(1);
      console.log(
        `[backup] ${result.file.name} (${mb} MB)` +
          (result.removed ? ` · ${result.removed} vechi șterse` : ""),
      );
    }
  } catch (e) {
    // Un backup ratat nu trebuie să atingă serverul — reîncearcă la
    // următorul tic (sau la următoarea pornire).
    console.warn("[backup] Rulare eșuată:", e);
  }
}

export default function () {
  const first = setTimeout(() => {
    void backupIfDue();
    const timer = setInterval(() => void backupIfDue(), INTERVAL_MS);
    timer.unref?.();
  }, FIRST_DELAY_MS);
  first.unref?.();
}
