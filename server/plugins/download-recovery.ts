// ---------------------------------------------------------------------------
// Plugin: continuitatea descărcărilor peste un restart.
//
// O descărcare pornită din aplicație e urmărită de o buclă de polling care
// trăiește în proces, iar după terminare încearcă legarea la Plex timp de 30
// de minute, tot în proces. Un restart le omoară pe amândouă — iar workflow-ul
// de deploy repornește serviciul la fiecare modificare de cod. Două goluri,
// complementare:
//
// 1. Reluarea (la +15s): descărcările încă neterminate (`completed_at` NULL)
//    își primesc bucla înapoi — vezi resumeOrphanedPolls din
//    filelist/download.ts. Fără ea, torrentul se termină în qBittorrent, dar
//    aplicația nu află niciodată: fără subtitrare RO, fără completed_at, fără
//    notificare, fără legare Plex. Exista ca `setTimeout` de modul în
//    download.ts și a încetat silențios să ruleze când modulul a devenit
//    import leneș.
//
// 2. Reconcilierea (la +45s, apoi la 10 min): titlurile terminate, dar
//    rămase fără plex_rating_key — prinse de un restart în fereastra de
//    legare, deci blocate pe „se procesează” în Bibliotecă. Vezi
//    src/lib/media/plex-link-reconciler.ts.
//
// Distanța de 30s dintre cele două rămâne explicită: resumeOrphanedPolls
// doar PORNEȘTE buclele și se întoarce imediat, deci „după ce s-a terminat”
// n-ar însemna nimic — prima verificare a fiecărei bucle vine abia după 30s.
// Cele două lucrează pe seturi disjuncte (completed_at NULL vs. NOT NULL).
// ---------------------------------------------------------------------------

const RESUME_DELAY_MS = 15_000; // serverul a pornit, qBittorrent e gata
const RECONCILE_DELAY_MS = 45_000; // și Plex a avut timp să răspundă
// Destul de des cât un titlu prins de un restart să se lege în câteva minute,
// destul de rar cât să nu conteze (interogarea nu atinge Plex decât dacă
// chiar există rânduri nelegate).
const RECONCILE_INTERVAL_MS = 10 * 60_000;

async function resume(): Promise<void> {
  try {
    const { resumeOrphanedPolls } = await import("../../src/lib/filelist/download");
    await resumeOrphanedPolls();
  } catch (e) {
    console.warn("[download-recovery] Reluarea polling-urilor a eșuat:", e);
  }
}

// Gardă de suprapunere: fiecare hash nelegat înseamnă câteva cereri către
// Plex, deci o rulare cu multe rânduri în așteptare poate depăși intervalul.
// Două rulări simultane ar încerca să desfacă același pachet de sezon în
// paralel, dublând rândurile de episod pe care le creează.
let reconciling = false;

async function reconcile(): Promise<void> {
  if (reconciling) return;
  reconciling = true;
  try {
    const { reconcilePlexLinks } = await import("../../src/lib/media/plex-link-reconciler");
    await reconcilePlexLinks();
  } catch (e) {
    console.warn("[plex-reconcile] Rulare eșuată:", e);
  } finally {
    reconciling = false;
  }
}

export default function () {
  setTimeout(() => void resume(), RESUME_DELAY_MS);
  setTimeout(() => void reconcile(), RECONCILE_DELAY_MS);
  setInterval(() => void reconcile(), RECONCILE_INTERVAL_MS);
}
