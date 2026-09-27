// ---------------------------------------------------------------------------
// Plugin: întreținerea sistemului — acțiunile pe servicii și backup-ul bazei.
//
// Trei pași independenți, fiecare cu ritmul și try/catch-ul lui: un backup
// ratat nu trebuie să oprească verificarea actualizărilor, nici invers.
//
// 1. La pornire, imediat: închide acțiunile Restart/Update rămase „în curs”
//    de la procesul anterior (src/lib/system/service-jobs.ts) — au murit
//    odată cu el. Fără asta, o singură acțiune întreruptă ar bloca toate
//    butoanele pe veci („rulează deja”).
//
// 2. Backup-ul bazei (src/lib/system/db-backup.ts), la +90s — ca să nu
//    concureze cu migrările și cu celelalte plugin-uri de pornire — apoi la
//    24h. Copia se face doar dacă cea mai recentă e mai veche de ~20h, altfel
//    un server repornit de cinci ori pe zi (deploy-uri) ar face cinci copii
//    identice și ar împinge afară din rotație istoricul chiar util.
//
// 3. Verificarea actualizărilor (Plex, Immich, Ubuntu, cererea de repornire —
//    src/lib/system/update-check.ts), la +5 min, apoi din oră în oră. Efectivă
//    o dată la 24h: ceasul stă în DB, fiindcă un interval de 24h în memorie
//    s-ar reseta la fiecare deploy.
// ---------------------------------------------------------------------------

const BACKUP_DELAY_MS = 90_000;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BACKUP_MIN_AGE_MS = 20 * 60 * 60 * 1000;

// Plex și Immich au timp să răspundă după pornire.
const UPDATE_CHECK_DELAY_MS = 5 * 60_000;
const UPDATE_CHECK_INTERVAL_MS = 60 * 60_000;

async function closeInterruptedJobs(): Promise<void> {
  try {
    const { markInterruptedJobs } = await import("../../src/lib/system/service-jobs");
    await markInterruptedJobs();
  } catch (e) {
    console.warn("[service-jobs] Curățarea acțiunilor întrerupte a eșuat:", e);
  }
}

async function backupIfDue(): Promise<void> {
  try {
    const { getBackupStatus, runDbBackup } = await import("../../src/lib/system/db-backup");
    const last = getBackupStatus().lastAt;
    if (last && Date.now() - new Date(last).getTime() < BACKUP_MIN_AGE_MS) return;

    const result = runDbBackup();
    if (result.ok) {
      const mb = (result.file.size / 1024 / 1024).toFixed(1);
      console.log(
        `[backup] ${result.file.name} (${mb} MB)` +
          (result.removed ? ` · ${result.removed} vechi șterse` : ""),
      );
    }
  } catch (e) {
    // Reîncearcă la următorul tic (sau la următoarea pornire).
    console.warn("[backup] Rulare eșuată:", e);
  }
}

// Gardă de suprapunere: o verificare atinge Plex, Immich și apt, iar un
// răspuns lent n-ar trebui să se suprapună cu tic-ul următor.
let checking = false;

async function checkUpdates(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const { checkForUpdates } = await import("../../src/lib/system/update-check");
    await checkForUpdates();
  } catch (e) {
    console.warn("[update-check] Verificare eșuată, se reia peste o oră:", e);
  } finally {
    checking = false;
  }
}

export default function () {
  // Imediat: până nu se curăță, butoanele ar refuza orice acțiune nouă.
  void closeInterruptedJobs();

  // Timerele backup-ului nu țin procesul în viață — așa erau și înainte.
  const firstBackup = setTimeout(() => {
    void backupIfDue();
    setInterval(() => void backupIfDue(), BACKUP_INTERVAL_MS).unref?.();
  }, BACKUP_DELAY_MS);
  firstBackup.unref?.();

  setTimeout(() => void checkUpdates(), UPDATE_CHECK_DELAY_MS);
  setInterval(() => void checkUpdates(), UPDATE_CHECK_INTERVAL_MS);
}
