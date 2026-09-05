// ---------------------------------------------------------------------------
// Plugin: reia polling-ul descărcărilor întrerupte de un restart.
//
// Fiecare descărcare pornită prin aplicație are o buclă de polling care
// trăiește în proces (vezi pollUntilComplete). Un restart o omoară, deci la
// pornire trebuie reluată pentru tot ce nu e încă marcat complet — altfel
// torrentul se termină în qBittorrent, dar aplicația nu află niciodată: fără
// subtitrare RO, fără completed_at, fără notificare, fără legare Plex.
//
// Exista deja ca `setTimeout` la nivel de modul în download.ts, ceea ce
// funcționa doar accidental — modulul se încărca la boot fiindcă barrel-ul
// îl importa static. Când download.ts a devenit import leneș, reluarea a
// încetat complet să mai ruleze. Aceeași lecție ca la activity-boot.ts:
// pentru lucruri care trebuie să se întâmple la pornire, un plugin explicit,
// nu un efect secundar de modul.
// ---------------------------------------------------------------------------

export default function () {
  // 15s: lăsăm serverul să termine de pornit și qBittorrent să fie gata.
  setTimeout(async () => {
    try {
      const { resumeOrphanedPolls } = await import("../../src/lib/filelist/download");
      await resumeOrphanedPolls();
    } catch (e) {
      console.warn("[filelist-resume] Reluarea polling-urilor a eșuat:", e);
    }
  }, 15_000);
}
