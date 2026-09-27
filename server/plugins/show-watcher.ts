// ---------------------------------------------------------------------------
// Plugin: urmărirea serialelor — verifică periodic ce episoade difuzate
// lipsesc din bibliotecă și le descarcă (vezi src/lib/media/show-watch.ts
// pentru logica propriu-zisă și pentru ce a mers prost la prima încercare).
//
// Bucla de aici rulează des, dar cadența reală per serial (3 ore) e ținută în
// DB, pe `media.watch_last_checked_at` — nu într-un timer în memorie, care
// s-ar reseta la fiecare restart al serviciului.
//
// Plugin explicit, nu efect secundar de modul: aceeași lecție ca la
// server-lifecycle.ts și download-recovery.ts — munca de la pornire făcută
// într-un `setTimeout` la nivel de modul funcționează doar cât timp cineva
// mai importă static modulul respectiv, și încetează silențios când nu.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 min — cât de des vedem cine a expirat
// 30s: filmul se verifică la un minut după adăugare (condiția e în SQL), iar
// un poll de 30s înseamnă că se întâmplă între minutul 1 și 1:30, nu la 2.
const NEW_MOVIE_POLL_MS = 30 * 1000;

// Gardă de suprapunere: o rulare atinge TMDB, TVmaze, Filelist și qBittorrent
// pentru mai multe seriale, deci poate depăși intervalul de 10 minute.
// checkShow are propria protecție per serial (inProgress), dar
// refreshShowMetadata și refreshMovieMetadata n-au niciuna — două rulări
// suprapuse ar cere de două ori aceleași sezoane de la TMDB.
let running = false;

// Un pas care aruncă nu trebuie să-i oprească pe ceilalți. Înainte toată
// rularea stătea într-un singur try, cu metadatele primele: o eroare la
// reîmprospătarea detaliilor sărea căutarea episoadelor și a filmelor pentru
// tot ciclul.
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.warn(`[show-watcher] ${name} — pas eșuat, se reia la ciclul următor:`, e);
  }
}

async function run(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Descărcările întâi — sunt motivul pentru care există plugin-ul, iar
    // fiecare verificare își cere singură detaliile de care are nevoie, deci
    // nu depinde de reîmprospătarea de mai jos.
    await step("Episoade noi", async () => {
      const { checkDueShows } = await import("../../src/lib/media/show-watch");
      await checkDueShows();
    });
    // Filmele așteptate, la coadă și în aceeași buclă, nu într-un plugin
    // separat: ambele caută pe Filelist, iar două bucle independente ar
    // deschide sesiuni concurente acolo. Aici rămân strict secvențiale.
    await step("Filme așteptate", async () => {
      const { checkDueMovies } = await import("../../src/lib/media/movie-watch");
      await checkDueMovies();
    });
    // Detaliile tuturor serialelor (cu episoadele lor) și ale filmelor, la
    // 12h fiecare — nu doar pentru cele urmărite, fiindcă tv_status decide
    // dacă vezi butonul de urmărire, deci trebuie corect mai ales acolo unde
    // încă n-ai pornit-o. Seriale și filme adună în același raport: o rulare =
    // o intrare în jurnal (vezi metadata-report.ts), scrisă doar dacă a fost
    // ceva scadent — și scrisă chiar dacă una dintre jumătăți a eșuat.
    const { newMetaReport, logMetaReport } = await import("../../src/lib/media/metadata-report");
    const report = newMetaReport();
    await step("Detalii seriale", async () => {
      const { refreshShowMetadata } = await import("../../src/lib/media/show-watch");
      await refreshShowMetadata(report);
    });
    await step("Detalii filme", async () => {
      const { refreshMovieMetadata } = await import("../../src/lib/media/movie-metadata");
      await refreshMovieMetadata(report);
    });
    await logMetaReport(report);
  } catch (e) {
    console.warn("[show-watcher] Rulare eșuată:", e);
  } finally {
    running = false;
  }
}

// Prima verificare a filmelor abia adăugate — buclă proprie, deasă și
// ieftină. Nu intră în `run()` fiindcă acolo se împrospătează metadate și se
// verifică seriale, muncă mult prea grea pentru fiecare minut. Aici e un
// singur SELECT care, în marea majoritate a minutelor, nu întoarce nimic.
//
// Nu pornește cât rulează ciclul mare: acela caută și el pe Filelist, iar
// regula de mai sus (fără căutări concurente) ar fi încălcată exact aici.
// Filmul nou e prins la primul tic de 30s de după ciclu. Garda proprie,
// `checkingNew`, rămâne pentru suprapunerea buclei cu ea însăși.
let checkingNew = false;

async function runNewMovies(): Promise<void> {
  if (checkingNew || running) return;
  checkingNew = true;
  try {
    const { checkNewMovies } = await import("../../src/lib/media/movie-watch");
    await checkNewMovies();
  } catch (e) {
    console.warn("[show-watcher] Prima verificare a filmelor a eșuat:", e);
  } finally {
    checkingNew = false;
  }
}

export default function () {
  // 45s: după reluarea din download-recovery.ts (15s), ca descărcările
  // întrerupte să apuce să-și repopuleze starea înainte să ne apucăm să căutăm ce lipsește —
  // altfel un episod deja în curs ar putea părea lipsă.
  setTimeout(run, 45_000);
  setInterval(run, POLL_INTERVAL_MS);
  setInterval(runNewMovies, NEW_MOVIE_POLL_MS);
}
