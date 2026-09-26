// ---------------------------------------------------------------------------
// Plugin: acțiunile pe servicii (src/lib/system/service-jobs.ts).
//
// 1. La pornire, închide acțiunile (restart / update) rămase „în curs” de la
//    procesul anterior — au murit odată cu el. Fără asta, o singură acțiune
//    întreruptă ar bloca toate butoanele pe veci („rulează deja”).
// 2. La 24 de ore, verifică dacă există actualizări (Plex, Immich, Ubuntu)
//    sau dacă Ubuntu cere repornire, și anunță prin jurnal + push (vezi
//    src/lib/system/update-check.ts).
// ---------------------------------------------------------------------------

export default function () {
  // Imediat: până nu se curăță, butoanele ar refuza orice acțiune nouă.
  import("../../src/lib/system/service-jobs")
    .then(({ markInterruptedJobs }) => markInterruptedJobs())
    .catch((e) => console.warn("[service-jobs] Curățarea acțiunilor întrerupte a eșuat:", e));

  // Ceasul de 24h stă în DB; aici doar întrebăm din oră în oră dacă a
  // trecut. Un interval de 24h în memorie s-ar reseta la fiecare deploy.
  let checking = false;
  async function check() {
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
  // 5 min după pornire: Plex și Immich au timp să răspundă.
  setTimeout(check, 5 * 60_000);
  setInterval(check, 60 * 60_000);
}
