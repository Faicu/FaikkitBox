// ---------------------------------------------------------------------------
// Registrul Watcher-ului: toate sarcinile de fundal ale aplicației, cu ritmul
// lor. Motorul (tactul de o secundă, gărzile, starea din DB) e în runner.ts;
// aici stă doar CE rulează și CÂND — plus, la fiecare sarcină, de ce există.
//
// Înainte, fiecare sarcină era un plugin separat în server/plugins/, cu
// propriul setTimeout/setInterval, propria gardă de suprapunere și propriul
// try/catch. Istoria din comentariile lor s-a mutat aici, lângă sarcină.
//
// Reguli comune, valabile pentru toate:
// - Munca de la pornire se face din plugin-ul Watcher (server/plugins/
//   watcher.ts), nu din efecte de modul: un `setTimeout` la nivel de modul
//   rulează doar cât timp cineva mai importă static modulul, și încetează
//   silențios când nu — două bug-uri identice au venit din asta.
// - Cadențele per element (serial la 3h, subtitrare zilnic, backup la 23h)
//   stau în DB, pe rândurile lor. Watcher-ul doar bate tactul, iar sarcina
//   decide ce e scadent — deci o rulare în plus nu strică nimic.
// - Importurile sunt leneșe, din interiorul `run`: registrul e citit și de
//   server functions (pentru listă), care n-au nevoie de modulele grele.
// ---------------------------------------------------------------------------

export interface WatcherRunContext {
  // Pornită cu „Rulează acum” din Tehnic. Sarcinile cu ceas global (backup,
  // actualizări, IMDb) îl ocolesc atunci; cele cu ceas per element rămân pe
  // ceasul lor — „acum” înseamnă „verifică acum ce e scadent”.
  manual: boolean;
}

export interface WatcherTask {
  id: string;
  label: string;
  // Prima rulare după pornire. Cu next_run_at păstrat în DB, întârzierea se
  // aplică doar dacă sarcina e deja scadentă (sau n-a rulat niciodată).
  delayMs: number;
  // Null = o singură dată, la pornire. Altfel, următoarea rulare vine la
  // atât după TERMINAREA celei curente, nu după pornire: o rulare de 8 minute
  // pe un interval de 10 nu pornește iar imediat.
  everyMs: number | null;
  // Sarcinile din același grup nu rulează niciodată simultan. Una ținută pe
  // loc de grup rămâne scadentă și pornește la primul tact cu grupul liber.
  group?: string;
  // Rulările unice de la pornire nu se pot pune pe pauză și nici porni manual:
  // „Acțiuni întrerupte” ar marca drept întreruptă o acțiune care chiar
  // rulează acum, iar reluarea descărcărilor ar dubla buclele de polling.
  controllable: boolean;
  // Textul scurt din istoric („2 legate la Plex”). Null = n-a avut ce face.
  run(ctx: WatcherRunContext): Promise<string | null>;
}

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Un pas care aruncă nu trebuie să-i oprească pe ceilalți din aceeași rulare.
// Pașii eșuați se strâng și, la final, rularea e marcată eșuată cu numele lor
// — înainte, la plugin-ul show-watcher, se vedeau doar în journalctl.
async function steps(list: Array<[string, () => Promise<void>]>, failed: string[]): Promise<void> {
  for (const [name, fn] of list) {
    try {
      await fn();
    } catch (e) {
      failed.push(name);
      console.warn(`[watcher] ${name} — pas eșuat, se reia la ciclul următor:`, e);
    }
  }
}

export const WATCHER_TASKS: WatcherTask[] = [
  // -------------------------------------------------------------------------
  // Acțiunile pe servicii (src/lib/system/service-jobs.ts) rămase „în curs”
  // de la procesul anterior au murit odată cu el. Fără închiderea lor, o
  // singură acțiune întreruptă ar bloca toate butoanele pe veci („rulează
  // deja”). Imediat: până nu se curăță, butoanele ar refuza orice acțiune.
  {
    id: "interrupted-jobs",
    label: "Acțiuni întrerupte",
    delayMs: 0,
    everyMs: null,
    controllable: false,
    async run() {
      const { markInterruptedJobs } = await import("../system/service-jobs");
      await markInterruptedJobs();
      return null;
    },
  },

  // -------------------------------------------------------------------------
  // Sesiunile Plex active — vezi src/lib/services/plex-session-poll.ts.
  {
    id: "plex-sessions",
    label: "Sesiuni Plex",
    delayMs: 30 * SEC,
    everyMs: 30 * SEC,
    controllable: true,
    async run() {
      const { pollPlexSessions } = await import("../services/plex-session-poll");
      await pollPlexSessions();
      return null;
    },
  },

  // -------------------------------------------------------------------------
  // Reluarea descărcărilor întrerupte de un restart. O descărcare pornită din
  // aplicație e urmărită de o buclă de polling care trăiește în proces
  // (filelist/download.ts); un restart o omoară — iar fiecare deploy
  // repornește serviciul. Descărcările încă neterminate (`completed_at` NULL)
  // își primesc aici bucla înapoi. Fără ea, torrentul se termină în
  // qBittorrent, dar aplicația nu află niciodată: fără subtitrare RO, fără
  // completed_at, fără notificare, fără legare Plex. Exista ca `setTimeout` de
  // modul în download.ts și a încetat silențios să ruleze când modulul a
  // devenit import leneș. La 15s: serverul a pornit, qBittorrent e gata.
  {
    id: "download-resume",
    label: "Reluare descărcări",
    delayMs: 15 * SEC,
    everyMs: null,
    controllable: false,
    async run() {
      const { resumeOrphanedPolls } = await import("../filelist/download");
      await resumeOrphanedPolls();
      return null;
    },
  },

  // -------------------------------------------------------------------------
  // Ștergerile programate (src/lib/media/scheduled-delete.ts). Un titlu cerut
  // spre ștergere în primele 24 h de la descărcare (hit and run pe Filelist)
  // se șterge abia la împlinirea lor; termenul stă în `media`, deci o ștergere
  // ratată cât serverul a fost oprit se face la pornirea următoare. Interogarea
  // e una singură, ieftină — de-aia minutul, ca timerul din Bibliotecă să fie
  // ținut aproape exact. La 30s: qBittorrent e gata.
  {
    id: "scheduled-delete",
    label: "Ștergeri programate",
    delayMs: 30 * SEC,
    everyMs: MIN,
    controllable: true,
    async run() {
      const { runDueDeletions } = await import("../filelist/delete-title");
      const n = await runDueDeletions();
      return n > 0 ? plural(n, "titlu șters", "titluri șterse") : null;
    },
  },

  // -------------------------------------------------------------------------
  // Urmărirea serialelor și a filmelor așteptate, plus detaliile lor (vezi
  // src/lib/media/show-watch.ts pentru logica propriu-zisă). Cadența reală
  // per serial (3 ore; 1 oră în zilele de lansare, vezi checkDueShows) stă pe
  // `media.watch_last_checked_at`.
  //
  // La 45s după pornire: după reluarea descărcărilor (15s), ca descărcările
  // întrerupte să-și repopuleze starea înainte să căutăm ce lipsește — altfel
  // un episod deja în curs ar putea părea lipsă.
  //
  // Grupul „filelist”: o rulare caută pe Filelist pentru mai multe titluri,
  // iar două căutări de fundal simultane ar deschide sesiuni concurente acolo.
  {
    id: "show-watch",
    label: "Seriale și filme",
    delayMs: 45 * SEC,
    everyMs: 10 * MIN,
    group: "filelist",
    controllable: true,
    async run() {
      const failed: string[] = [];
      // Descărcările întâi — sunt motivul pentru care există sarcina, iar
      // fiecare verificare își cere singură detaliile de care are nevoie.
      // Filmele așteptate, la coadă și în aceeași rulare: ambele caută pe
      // Filelist, deci rămân strict secvențiale.
      await steps(
        [
          [
            "Episoade noi",
            async () => {
              const { checkDueShows } = await import("../media/show-watch");
              await checkDueShows();
            },
          ],
          [
            "Filme așteptate",
            async () => {
              const { checkDueMovies } = await import("../media/movie-watch");
              await checkDueMovies();
            },
          ],
        ],
        failed,
      );
      // Detaliile tuturor serialelor (cu episoadele lor) și ale filmelor, la
      // 12h fiecare — nu doar pentru cele urmărite, fiindcă tv_status decide
      // dacă vezi butonul de urmărire. Seriale și filme adună în același
      // raport: o rulare = o intrare în jurnal (vezi metadata-report.ts),
      // scrisă doar dacă a fost ceva scadent — chiar dacă o jumătate a eșuat.
      const { newMetaReport, logMetaReport } = await import("../media/metadata-report");
      const report = newMetaReport();
      let shows = 0;
      let movies = 0;
      await steps(
        [
          [
            "Detalii seriale",
            async () => {
              const { refreshShowMetadata } = await import("../media/show-watch");
              shows = await refreshShowMetadata(report);
            },
          ],
          [
            "Detalii filme",
            async () => {
              const { refreshMovieMetadata } = await import("../media/movie-metadata");
              movies = await refreshMovieMetadata(report);
            },
          ],
        ],
        failed,
      );
      await logMetaReport(report);
      if (failed.length) throw new Error(`Pași eșuați: ${failed.join(", ")}`);
      const parts: string[] = [];
      if (shows) parts.push(plural(shows, "serial împrospătat", "seriale împrospătate"));
      if (movies) parts.push(plural(movies, "film împrospătat", "filme împrospătate"));
      return parts.length ? parts.join(" · ") : null;
    },
  },

  // -------------------------------------------------------------------------
  // Prima verificare a filmelor abia adăugate: filmul se verifică la un minut
  // după adăugare (condiția e în SQL), iar tactul de 30s face ca asta să se
  // întâmple între minutul 1 și 1:30. Separat de „show-watch”, unde se
  // împrospătează metadate și se verifică seriale — muncă prea grea pentru
  // fiecare jumătate de minut; aici e un singur SELECT care, în marea
  // majoritate a cazurilor, nu întoarce nimic. Același grup: cât rulează
  // ciclul mare, așteaptă.
  {
    id: "new-movies",
    label: "Filme abia adăugate",
    delayMs: 30 * SEC,
    everyMs: 30 * SEC,
    group: "filelist",
    controllable: true,
    async run() {
      const { checkNewMovies } = await import("../media/movie-watch");
      await checkNewMovies();
      return null;
    },
  },

  // -------------------------------------------------------------------------
  // Legarea la Plex a titlurilor terminate, dar rămase fără plex_rating_key —
  // prinse de un restart în fereastra de 30 de minute în care download.ts
  // încearcă legarea, deci blocate pe „se procesează” în Bibliotecă. Vezi
  // src/lib/media/plex-link-reconciler.ts. La 45s (Plex a avut timp să
  // răspundă), apoi la 10 minute; interogarea nu atinge Plex decât dacă chiar
  // există rânduri nelegate. Lucrează pe alte rânduri decât reluarea
  // descărcărilor (completed_at NOT NULL vs. NULL).
  {
    id: "plex-link",
    label: "Legare Plex",
    delayMs: 45 * SEC,
    everyMs: 10 * MIN,
    controllable: true,
    async run() {
      const { reconcilePlexLinks } = await import("../media/plex-link-reconciler");
      const r = await reconcilePlexLinks();
      if (r.checked === 0) return null;
      return `${plural(r.checked, "nelegat verificat", "nelegate verificate")}, ${r.linked} legate`;
    },
  },

  // -------------------------------------------------------------------------
  // Încărcările în Immich, trecute în Jurnalul de activitate (vezi
  // src/lib/services/immich-uploads.ts — varianta veche rula doar cât era
  // deschisă pagina Immich și pierdea totul la repornire). La 5 minute: o
  // încărcare apare în jurnal la cel mult ~10 minute după ce se termină. La
  // 60s după pornire: Immich (container separat) poate răspunde încă lent.
  {
    id: "immich-uploads",
    label: "Încărcări Immich",
    delayMs: 60 * SEC,
    everyMs: 5 * MIN,
    controllable: true,
    async run() {
      const { checkImmichUploads } = await import("../services/immich-uploads");
      await checkImmichUploads();
      return null;
    },
  },

  // -------------------------------------------------------------------------
  // Backup-ul bazei (src/lib/system/db-backup.ts), din oră în oră, dar copia
  // se face doar dacă cea mai recentă e mai veche de 23h — deci efectiv o
  // dată pe zi, iar un server repornit de cinci ori pe zi nu face cinci copii
  // identice care să împingă afară din rotație istoricul chiar util. 23h, nu
  // 24h: cu verificare din oră în oră, pauza reală e cel mult 24h.
  //
  // Ceasul e data celui mai nou fișier din data/backups/, nu un interval în
  // memorie. Varianta veche (24h, pornit la fiecare boot) se reseta la fiecare
  // deploy: în septembrie 2026 au fost pauze de 30h, 33h și 41h. La 90s după
  // pornire, ca să nu concureze cu migrările și cu celelalte sarcini.
  {
    id: "db-backup",
    label: "Backup bază de date",
    delayMs: 90 * SEC,
    everyMs: HOUR,
    controllable: true,
    async run({ manual }) {
      const { getBackupStatus, runDbBackup } = await import("../system/db-backup");
      const last = getBackupStatus().lastAt;
      if (!manual && last && Date.now() - new Date(last).getTime() < 23 * HOUR) {
        return "nu e încă scadent";
      }
      const result = runDbBackup();
      if (!result.ok) throw new Error(result.error ?? "backup eșuat");
      const mb = (result.file.size / 1024 / 1024).toFixed(1);
      const line = `${result.file.name} (${mb} MB)`;
      console.log(`[backup] ${line}${result.removed ? ` · ${result.removed} vechi șterse` : ""}`);
      return line;
    },
  },

  // -------------------------------------------------------------------------
  // Rating-urile IMDb pentru Descoperă (src/lib/imdb/imdb-ratings.ts), din oră
  // în oră, efectiv o dată la 23h, cu ceasul în baza rating-urilor; un
  // dataset neschimbat costă doar o cerere 304.
  {
    id: "imdb-ratings",
    label: "Rating-uri IMDb",
    delayMs: 2 * MIN,
    everyMs: HOUR,
    controllable: true,
    async run({ manual }) {
      const { refreshImdbRatingsIfDue } = await import("../imdb/imdb-ratings");
      const r = await refreshImdbRatingsIfDue({ force: manual });
      if (r === "skipped") return "nu e încă scadent";
      if (r === "unchanged") return "dataset neschimbat";
      return `${r.imported.toLocaleString("ro-RO")} rating-uri importate`;
    },
  },

  // -------------------------------------------------------------------------
  // Actualizările disponibile (Plex, Immich, Ubuntu, cererea de repornire —
  // src/lib/system/update-check.ts), din oră în oră, efectiv o dată la 24h,
  // cu ceasul în DB. La 5 minute după pornire: Plex și Immich au timp să
  // răspundă. Dacă nicio sursă nu răspunde, verificarea nu se marchează și
  // se reia peste o oră.
  {
    id: "update-check",
    label: "Actualizări disponibile",
    delayMs: 5 * MIN,
    everyMs: HOUR,
    controllable: true,
    async run({ manual }) {
      const { checkForUpdates } = await import("../system/update-check");
      const r = await checkForUpdates({ force: manual });
      if (r === "failed") throw new Error("nicio sursă n-a răspuns, se reia peste o oră");
      if (r === "skipped") return "nu e încă scadent";
      return r === "notified" ? "actualizări anunțate" : "nimic nou";
    },
  },

  // -------------------------------------------------------------------------
  // Reîncercarea zilnică a subtitrărilor care lipsesc (src/lib/filelist/
  // subtitle-retry.ts). Tactul e din oră în oră, dar cadența reală per
  // torrent (o dată pe zi) stă pe `subtitle_checked_at`. O rulare poate dura
  // (căutări externe, ffmpeg pe fiecare fișier). La 10 minute după pornire:
  // după reluarea descărcărilor și primul ciclu al urmăririi.
  {
    id: "subtitle-retry",
    label: "Reîncercare subtitrări",
    delayMs: 10 * MIN,
    everyMs: HOUR,
    controllable: true,
    async run() {
      const { retryMissingSubtitles } = await import("../filelist/subtitle-retry");
      const r = await retryMissingSubtitles();
      if (r.checked === 0) return "nimic de căutat";
      return `${plural(r.checked, "titlu căutat", "titluri căutate")}, ${r.found} găsite`;
    },
  },
];

export function findWatcherTask(id: string): WatcherTask | undefined {
  return WATCHER_TASKS.find((t) => t.id === id);
}
