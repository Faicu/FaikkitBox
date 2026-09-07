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
// activity-boot.ts și filelist-resume.ts — munca de la pornire făcută într-un
// `setTimeout` la nivel de modul funcționează doar cât timp cineva mai
// importă static modulul respectiv, și încetează silențios când nu.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 min — cât de des vedem cine a expirat
// 30s: filmul se verifică la un minut după adăugare (condiția e în SQL), iar
// un poll de 30s înseamnă că se întâmplă între minutul 1 și 1:30, nu la 2.
const NEW_MOVIE_POLL_MS = 30 * 1000;

// Gardă de suprapunere: o rulare atinge TMDB, TVmaze, Filelist și qBittorrent
// pentru mai multe seriale, deci poate depăși intervalul de 10 minute.
// checkShow are propria protecție per serial (inProgress), dar
// fillMissingEpisodeTitles și refreshShowMetadata n-au niciuna — două rulări
// suprapuse ar cere de două ori aceleași sezoane de la TMDB.
let running = false;

async function run(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { checkDueShows, fillMissingEpisodeTitles, refreshShowMetadata } =
      await import("../../src/lib/media/show-watch");
    // Numele episoadelor înainte: e un no-op ieftin (un SELECT) când nu
    // lipsește niciunul, și înseamnă că un episod abia descărcat își capătă
    // numele în cel mult un ciclu, fără să depindă de urmărire.
    await fillMissingEpisodeTitles();
    // Status + următorul episod, pentru toate serialele (la 12h fiecare) —
    // nu doar pentru cele urmărite, fiindcă tv_status decide dacă vezi
    // butonul de urmărire, deci trebuie corect mai ales acolo unde încă n-ai
    // pornit-o.
    await refreshShowMetadata();
    await checkDueShows();
    // Filmele așteptate, la coadă și în aceeași buclă, nu într-un plugin
    // separat: ambele caută pe Filelist, iar două bucle independente ar
    // deschide sesiuni concurente acolo, fiecare cu garda ei de suprapunere
    // inutilă față de cealaltă. Aici rămân strict secvențiale.
    const { checkDueMovies } = await import("../../src/lib/media/movie-watch");
    await checkDueMovies();
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
// Gardă separată de `running`: cele două bucle pot rula în paralel fără să se
// calce, fiindcă checkMovie are propria protecție per film (inProgress), iar
// un film abia adăugat nu poate fi în același timp și scadent la 12h.
let checkingNew = false;

async function runNewMovies(): Promise<void> {
  if (checkingNew) return;
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
  // 45s: după filelist-resume (15s), ca reluarea descărcărilor întrerupte să
  // apuce să repopuleze starea înainte să ne apucăm să căutăm ce lipsește —
  // altfel un episod deja în curs ar putea părea lipsă.
  setTimeout(run, 45_000);
  setInterval(run, POLL_INTERVAL_MS);
  setInterval(runNewMovies, NEW_MOVIE_POLL_MS);
}
