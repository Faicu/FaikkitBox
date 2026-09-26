// ---------------------------------------------------------------------------
// Plugin: la pornire, închide acțiunile pe servicii (restart / update) rămase
// „în curs” de la procesul anterior — au murit odată cu el. Fără asta, o
// singură acțiune întreruptă ar bloca toate butoanele pe veci („rulează
// deja”). Vezi src/lib/system/service-jobs.ts.
// ---------------------------------------------------------------------------

export default function () {
  // Imediat: până nu se curăță, butoanele ar refuza orice acțiune nouă.
  import("../../src/lib/system/service-jobs")
    .then(({ markInterruptedJobs }) => markInterruptedJobs())
    .catch((e) => console.warn("[service-jobs] Curățarea acțiunilor întrerupte a eșuat:", e));
}
