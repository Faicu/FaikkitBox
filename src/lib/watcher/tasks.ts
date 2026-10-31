// ---------------------------------------------------------------------------
// Registrul Watcher-ului: ce sarcini de fundal rulează, când și de ce.
// Motorul (tact, gărzi, stare) e în runner.ts.
//
// Reguli comune:
// - Munca de la pornire pleacă din plugin-ul Watcher, nu din efecte de modul:
//   un `setTimeout` de modul rulează doar cât cineva importă static modulul
//   (două bug-uri identice din asta).
// - Cadențele per element (serial la 3h, subtitrare zilnic) stau în DB;
//   sarcina decide ce e scadent, deci o rulare în plus nu strică nimic.
// - Importuri leneșe în `run`: registrul e citit și de server functions.
// ---------------------------------------------------------------------------

interface WatcherRunContext {
  // „Rulează acum”: sarcinile cu ceas global (backup, IMDb, actualizări) îl
  // ocolesc; cele cu ceas per element verifică doar ce e scadent.
  manual: boolean;
}

export type WatcherOutcome =
  | string
  | null
  // `error`: rularea a eșuat parțial — rezumatul (ce s-a făcut) se păstrează.
  | { summary: string | null; nextAt: number | null; error?: string };

export interface WatcherTask {
  id: string;
  label: string;
  // Prima rulare după pornire — doar dacă ora salvată e deja depășită.
  delayMs: number;
  // Null = o singură dată, la pornire. Se numără de la TERMINAREA rulării.
  everyMs: number | null;
  // Ritmul afișat în Tehnic, când intervalul e doar tactul sau reîncercarea.
  cadenceLabel?: string;
  // Fără pauză și „Rulează acum”: „Acțiuni întrerupte”, pornită manual, ar
  // marca întreruptă o acțiune care chiar rulează.
  controllable: boolean;
  // Rezumatul pentru istoric; null = n-a avut ce face (nu intră în istoric).
  // Cu `nextAt`, sarcina își cere singură ora următoare (limite în runner.ts).
  run(ctx: WatcherRunContext): Promise<WatcherOutcome>;
}

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Un pas eșuat nu-i oprește pe ceilalți; la final, rularea e marcată eșuată
// cu numele pașilor.
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
  // Acțiunile pe servicii (service-jobs.ts) rămase „în curs” au murit cu
  // procesul anterior; altfel ar bloca butoanele pe veci („rulează deja”).
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
  // Sesiunile Plex active (plex-session-poll.ts). Oprirea se confirmă la două
  // verificări la rând fără sesiune (trackPlexSessions) — fără opriri false.
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
  // Descărcările, de la pornire până la titlul legat în Plex — vezi
  // download-tracker.ts. Totul se citește din `media`, deci un restart nu
  // întrerupe nimic (înainte: o buclă în memorie per torrent). Ritmul îl cere
  // sarcina; o descărcare nouă o trezește (pokeWatcher).
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
  // Ștergerile programate în primele 48 h după finalizare (hit and run pe Filelist) — vezi
  // scheduled-delete.ts. Rulează la termenul celei mai apropiate, doarme fără
  // nimic programat (o programare nouă o trezește), iar o ștergere eșuată sau
  // un torrent în finalizare (finalizingHashes) se reîncearcă la minut.
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
  // Serialele și filmele urmărite, plus detaliile lor din TMDB (show-watch.ts,
  // movie-watch.ts). Cadența per serial stă pe `watch_last_checked_at`.
  // Pornește după primul tact al descărcărilor, ca torrentele terminate cât
  // serverul a fost oprit să fie deja marcate. Trezită de setShowWatch
  // (imediat) și setMovieWatch (după un minut, ca să nu repete căutarea din
  // wizard).
  {
    id: "show-watch",
    label: "Seriale și filme",
    // Tactul e la 10 min; fiecare titlu își are ritmul lui.
    cadenceLabel: "serial 1–3h · film 12h",
    delayMs: 45 * SEC,
    everyMs: 10 * MIN,
    controllable: true,
    async run() {
      const failed: string[] = [];
      // Ce au pornit pașii de descărcare și titlurile la care au eșuat.
      const started: string[] = [];
      const itemErrors: string[] = [];
      const collect = (r: { started: string[]; errors: string[] }) => {
        started.push(...r.started);
        itemErrors.push(...r.errors);
      };
      // Descărcările întâi, strict secvențial: toate caută pe Filelist, iar
      // căutările de fundal nu se fac niciodată deodată.
      await steps(
        [
          [
            "Filme noi",
            async () => {
              const { checkNewMovies } = await import("../media/movie-watch");
              collect(await checkNewMovies());
            },
          ],
          [
            "Episoade noi",
            async () => {
              const { checkDueShows } = await import("../media/show-watch");
              collect(await checkDueShows());
            },
          ],
          [
            "Filme așteptate",
            async () => {
              const { checkDueMovies } = await import("../media/movie-watch");
              collect(await checkDueMovies());
            },
          ],
        ],
        failed,
      );
      // Detaliile tuturor titlurilor, la 12h fiecare — și ale celor neurmărite:
      // tv_status decide dacă vezi butonul de urmărire. Un raport comun, scris
      // doar cu schimbări reale (metadata-report.ts).
      const { newMetaReport, logMetaReport } = await import("../media/metadata-report");
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
      // Metadatele intră doar în jurnal (logMetaReport); istoricul din Tehnic
      // le amestecă singur cu rulările (watcher-cards.tsx) — în rezumat s-ar
      // vedea de două ori.
      await logMetaReport(report);
      const errors = [
        ...itemErrors,
        ...(failed.length ? [`pași eșuați: ${failed.join(", ")}`] : []),
      ];
      return {
        summary: started.length > 0 ? `Pornite: ${started.join(", ")}` : null,
        nextAt: null,
        error: errors.length > 0 ? errors.join("; ") : undefined,
      };
    },
  },

  // -------------------------------------------------------------------------
  // Încărcările în Immich, în jurnal (immich-uploads.ts): apar la cel mult
  // ~4 minute după ce se termină. Prima, la un minut — Immich pornește lent.
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
  // Backup-ul bazei (db-backup.ts): o copie la 23h după cea mai recentă de pe
  // disc. Ceasul e data fișierului, nu un timer — un timer de 24h se reseta la
  // fiecare deploy (pauze de 30–41h în sept. 2026). Ora din registru e doar
  // reîncercarea după un eșec.
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
  // Rating-urile IMDb pentru Descoperă (imdb-ratings.ts), la 23h; un dataset
  // neschimbat costă o cerere 304. Ora din registru = reîncercarea.
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
  // Actualizările disponibile (update-check.ts), la 24h. Fără niciun răspuns
  // (fără rețea), se reia peste o oră.
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
  // Subtitrările care lipsesc, reîncercate zilnic per titlu
  // (subtitle-retry.ts, cadența pe `subtitle_checked_at`).
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
