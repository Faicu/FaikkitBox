// ---------------------------------------------------------------------------
// Plugin: încărcările în Immich, trecute în Jurnalul de activitate. Vezi
// src/lib/services/immich-uploads.ts pentru motivul existenței — varianta
// veche rula doar cât era deschisă pagina Immich și pierdea totul la repornire.
// ---------------------------------------------------------------------------

export default function () {
  // La 5 minute: o încărcare apare în jurnal la cel mult ~10 minute după ce se
  // termină (o verificare care o prinde + una care nu mai găsește nimic nou).
  const INTERVAL_MS = 5 * 60_000;

  // Gardă de suprapunere: un import mare înseamnă căutări paginate, iar două
  // rulări simultane ar citi același `checked_until` și ar număra de două ori.
  let running = false;

  async function run() {
    if (running) return;
    running = true;
    try {
      const { checkImmichUploads } = await import("../../src/lib/services/immich-uploads");
      await checkImmichUploads();
    } catch (e) {
      console.warn("[immich-uploads] Verificare eșuată, se reia la următoarea:", e);
    } finally {
      running = false;
    }
  }

  // 60s: după pornire, Immich (container separat) poate răspunde încă lent.
  setTimeout(run, 60_000);
  setInterval(run, INTERVAL_MS);
}
