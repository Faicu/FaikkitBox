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

export type WatcherOutcome = string | null | { summary: string | null; nextAt: number | null };

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
  // Ritmul afișat în Tehnic, când diferă de interval: la sarcinile cu ceas
  // propriu sau per titlu, intervalul e doar tactul (ori ritmul de
  // reîncercare), nu cât de des se întâmplă ceva.
  cadenceLabel?: string;
  // Rulările unice de la pornire nu se pot pune pe pauză și nici porni manual:
  // „Acțiuni întrerupte” ar marca drept întreruptă o acțiune care chiar
  // rulează acum.
  controllable: boolean;
  // Textul scurt din istoric („2 legate la Plex”). Null = n-a avut ce face
  // (rularea nu intră în istoric). Varianta cu `nextAt`: sarcina știe singură
  // când îi vine rândul (backup-ul, peste 23h de la ultima copie) — vezi
  // runner.ts pentru limite.
  run(ctx: WatcherRunContext): Promise<WatcherOutcome>;
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
  // Sesiunile Plex active — vezi src/lib/services/plex-session-poll.ts. La
  // 10s (era 30s): începutul unei vizionări apare în cel mult 10s; oprirea
  // se confirmă la două verificări la rând fără sesiune (trackPlexSessions),
  // ca o sesiune pierdută o clipă de Plex să nu dea o oprire falsă.
  {
    id: "plex-sessions",
    label: "Sesiuni Plex",
    delayMs: 10 * SEC,
    everyMs: 10 * SEC,
    controllable: true,
    async run() {
      const { pollPlexSessions } = await import("../services/plex-session-poll");
      await pollPlexSessions();
      return null;
    },
  },

  // -------------------------------------------------------------------------
  // Descărcările pornite din aplicație, până la titlul gata în Plex: torrentele
  // terminate în qBittorrent primesc ID-ul IMDb în nume, completed_at,
  // notificare, subtitrare RO și refresh Plex, apoi legarea la Plex — în
  // primele 30 de minute la fiecare rulare, apoi prin reconciliere la 10
  // minute, până la 72h. Vezi src/lib/filelist/download-tracker.ts.
  //
  // Înlocuiește buclele per torrent din memorie (30s, până la 48h), reluarea
  // lor după restart și fosta sarcină „Legare Plex”: totul se citește din
  // `media`, deci un restart nu mai are ce întrerupe.
  //
  // Ritmul îl cere sarcina: 10s cât e ceva în curs, 10 minute cât rămân doar
  // titluri nelegate mai vechi, altfel o oră — o descărcare nouă o trezește
  // imediat (pokeWatcher în finishFilelistDownload). La 15s după pornire:
  // serverul a pornit, qBittorrent e gata.
  {
    id: "downloads",
    label: "Descărcări",
    cadenceLabel: "la 10s cât se descarcă",
    delayMs: 15 * SEC,
    everyMs: 10 * SEC,
    controllable: true,
    async run() {
      const { trackDownloads } = await import("../filelist/download-tracker");
      return trackDownloads();
    },
  },

  // -------------------------------------------------------------------------
  // Ștergerile programate (src/lib/media/scheduled-delete.ts). Un titlu cerut
  // spre ștergere în primele 24 h de la descărcare (hit and run pe Filelist)
  // se șterge abia la împlinirea lor; termenul stă în `media`, deci o ștergere
  // ratată cât serverul a fost oprit se face la pornirea următoare.
  //
  // Sarcina rulează exact la termenul celei mai apropiate ștergeri (timerul
  // din Bibliotecă e ținut la secundă), iar fără nimic programat doarme — o
  // programare nouă o trezește (pokeWatcher în log.ts); verificarea din oră în
  // oră e plasă de siguranță. O ștergere eșuată, sau un torrent încă în
  // finalizare (vezi finalizingHashes în download-tracker.ts), rămâne scadentă
  // și se reîncearcă la minut. La 30s după pornire: qBittorrent e gata.
  {
    id: "scheduled-delete",
    label: "Ștergeri programate",
    cadenceLabel: "la termenul ștergerii",
    delayMs: 30 * SEC,
    everyMs: MIN,
    controllable: true,
    async run() {
      const { runDueDeletions } = await import("../filelist/delete-title");
      const { nextScheduledDeletionAt } = await import("../media/scheduled-delete");
      const n = await runDueDeletions();
      return {
        summary: n > 0 ? plural(n, "titlu șters", "titluri șterse") : null,
        nextAt: nextScheduledDeletionAt() ?? Date.now() + HOUR,
      };
    },
  },

  // -------------------------------------------------------------------------
  // Urmărirea serialelor și a filmelor așteptate, plus detaliile lor (vezi
  // src/lib/media/show-watch.ts pentru logica propriu-zisă). Cadența reală
  // per serial (3 ore; 1 oră în zilele de lansare, vezi checkDueShows) stă pe
  // `media.watch_last_checked_at`.
  //
  // La 45s după pornire: după primul tact al descărcărilor (15s), ca
  // torrentele terminate cât serverul a fost oprit să fie deja marcate.
  //
  // Un film adăugat la urmărire trezește sarcina după un minut (pokeWatcher
  // în setMovieWatch): destul cât să nu repete căutarea tocmai făcută în
  // wizard, destul de repede cât rândul să se completeze cât te uiți la el.
  // Pornirea urmăririi unui serial o trezește imediat (setShowWatch).
  {
    id: "show-watch",
    label: "Seriale și filme",
    cadenceLabel: "la 3h / serial",
    delayMs: 45 * SEC,
    everyMs: 10 * MIN,
    controllable: true,
    async run() {
      const failed: string[] = [];
      // Descărcările întâi — sunt motivul pentru care există sarcina, iar
      // fiecare verificare își cere singură detaliile de care are nevoie.
      // Filmele, la coadă și în aceeași rulare: toate caută pe Filelist, deci
      // rămân strict secvențiale. „Filme noi” = prima verificare a unui film
      // abia adăugat la urmărire (era o sarcină separată, la 30s).
      await steps(
        [
          [
            "Filme noi",
            async () => {
              const { checkNewMovies } = await import("../media/movie-watch");
              await checkNewMovies();
            },
          ],
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
      // scrisă doar dacă a adus schimbări reale sau a avut titluri eșuate —
      // chiar dacă o jumătate a eșuat. Rezumatul rulării e același text.
      const { newMetaReport, logMetaReport, hasMetaNews, buildMetaRefreshMessage } =
        await import("../media/metadata-report");
      const report = newMetaReport();
      await steps(
        [
          [
            "Detalii seriale",
            async () => {
              const { refreshShowMetadata } = await import("../media/show-watch");
              await refreshShowMetadata(report);
            },
          ],
          [
            "Detalii filme",
            async () => {
              const { refreshMovieMetadata } = await import("../media/movie-metadata");
              await refreshMovieMetadata(report);
            },
          ],
        ],
        failed,
      );
      await logMetaReport(report);
      if (failed.length) throw new Error(`Pași eșuați: ${failed.join(", ")}`);
      return hasMetaNews(report)
        ? buildMetaRefreshMessage(report).replace(/^Metadate: /, "")
        : null;
    },
  },

  // -------------------------------------------------------------------------
  // Încărcările în Immich, trecute în Jurnalul de activitate (vezi
  // src/lib/services/immich-uploads.ts — varianta veche rula doar cât era
  // deschisă pagina Immich și pierdea totul la repornire). La 2 minute: o
  // încărcare apare în jurnal la cel mult ~4 minute după ce se termină (o
  // verificare care o prinde + una care nu mai găsește nimic nou). La
  // 60s după pornire: Immich (container separat) poate răspunde încă lent.
  {
    id: "immich-uploads",
    label: "Încărcări Immich",
    delayMs: 60 * SEC,
    everyMs: 2 * MIN,
    controllable: true,
    async run() {
      const { checkImmichUploads } = await import("../services/immich-uploads");
      await checkImmichUploads();
      return null;
    },
  },

  // -------------------------------------------------------------------------
  // Backup-ul bazei (src/lib/system/db-backup.ts): o copie la 23h după cea
  // mai recentă — sarcina își cere singură ora următoare, deci nu mai rulează
  // degeaba din oră în oră. Un server repornit de cinci ori pe zi nu face
  // cinci copii identice care să împingă afară din rotație istoricul chiar
  // util. Ora (1h) rămâne ritmul de reîncercare după un backup eșuat.
  //
  // Ceasul e data celui mai nou fișier din data/backups/, nu un interval în
  // memorie. Varianta veche (24h, pornit la fiecare boot) se reseta la fiecare
  // deploy: în septembrie 2026 au fost pauze de 30h, 33h și 41h. La 90s după
  // pornire, ca să nu concureze cu migrările și cu celelalte sarcini.
  {
    id: "db-backup",
    label: "Backup bază de date",
    cadenceLabel: "zilnic",
    delayMs: 90 * SEC,
    everyMs: HOUR,
    controllable: true,
    async run({ manual }) {
      const { getBackupStatus, runDbBackup } = await import("../system/db-backup");
      const last = getBackupStatus().lastAt;
      const due = last ? new Date(last).getTime() + 23 * HOUR : 0;
      if (!manual && Date.now() < due) return { summary: null, nextAt: due };
      const result = runDbBackup();
      if (!result.ok) throw new Error(result.error ?? "backup eșuat");
      const mb = (result.file.size / 1024 / 1024).toFixed(1);
      const line = `${result.file.name} (${mb} MB)`;
      console.log(`[backup] ${line}${result.removed ? ` · ${result.removed} vechi șterse` : ""}`);
      return { summary: line, nextAt: Date.now() + 23 * HOUR };
    },
  },

  // -------------------------------------------------------------------------
  // Rating-urile IMDb pentru Descoperă (src/lib/imdb/imdb-ratings.ts), o dată
  // la 23h, cu ceasul în baza rating-urilor (ora următoare o cere sarcina; ora
  // din registru e doar ritmul de reîncercare după o eroare); un dataset
  // neschimbat costă doar o cerere 304.
  {
    id: "imdb-ratings",
    label: "Rating-uri IMDb",
    cadenceLabel: "zilnic",
    delayMs: 2 * MIN,
    everyMs: HOUR,
    controllable: true,
    async run({ manual }) {
      const { refreshImdbRatingsIfDue, nextImdbCheckAt } = await import("../imdb/imdb-ratings");
      const r = await refreshImdbRatingsIfDue({ force: manual });
      const summary =
        r === "skipped"
          ? null
          : r === "unchanged"
            ? "dataset neschimbat"
            : `${r.imported.toLocaleString("ro-RO")} rating-uri importate`;
      return { summary, nextAt: nextImdbCheckAt() };
    },
  },

  // -------------------------------------------------------------------------
  // Actualizările disponibile (Plex, Immich, Ubuntu, cererea de repornire —
  // src/lib/system/update-check.ts), o dată la 24h, cu ceasul în DB — ora
  // următoare o cere sarcina; ora din registru e ritmul de reîncercare. La 5
  // minute după pornire: Plex și Immich au timp să răspundă. Dacă nicio sursă
  // nu răspunde, verificarea nu se marchează și se reia peste o oră.
  {
    id: "update-check",
    label: "Actualizări disponibile",
    cadenceLabel: "zilnic",
    delayMs: 5 * MIN,
    everyMs: HOUR,
    controllable: true,
    async run({ manual }) {
      const { checkForUpdates, nextUpdateCheckAt } = await import("../system/update-check");
      const r = await checkForUpdates({ force: manual });
      if (r === "failed") throw new Error("nicio sursă n-a răspuns, se reia peste o oră");
      const summary =
        r === "skipped" ? null : r === "notified" ? "actualizări anunțate" : "nimic nou";
      return { summary, nextAt: nextUpdateCheckAt() };
    },
  },

  // -------------------------------------------------------------------------
  // Reîncercarea zilnică a subtitrărilor care lipsesc (src/lib/filelist/
  // subtitle-retry.ts). Tactul e din oră în oră, dar cadența reală per
  // torrent (o dată pe zi) stă pe `subtitle_checked_at`. O rulare poate dura
  // (căutări externe, ffmpeg pe fiecare fișier). La 10 minute după pornire:
  // după primele tacte ale descărcărilor și primul ciclu al urmăririi.
  {
    id: "subtitle-retry",
    label: "Reîncercare subtitrări",
    cadenceLabel: "zilnic / titlu",
    delayMs: 10 * MIN,
    everyMs: HOUR,
    controllable: true,
    async run() {
      const { retryMissingSubtitles } = await import("../filelist/subtitle-retry");
      const r = await retryMissingSubtitles();
      if (r.checked === 0) return null;
      return `${plural(r.checked, "titlu căutat", "titluri căutate")}, ${r.found} găsite`;
    },
  },
];

export function findWatcherTask(id: string): WatcherTask | undefined {
  return WATCHER_TASKS.find((t) => t.id === id);
}
