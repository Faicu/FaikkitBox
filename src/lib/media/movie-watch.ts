// ---------------------------------------------------------------------------
// Urmărirea filmelor: descărcarea automată a unui film care încă nu există pe
// Filelist la calitatea cerută.
//
// Simetric cu show-watch.ts, dar deliberat modul separat și mult mai mic. La
// seriale complexitatea vine din episoade — diferența cu TMDB, pachetele de
// sezon, punctul de pornire, cadența per serial. Aici nu există niciuna: un
// film e o singură întrebare, pusă periodic, „a apărut?".
//
// Două diferențe de fond față de seriale, ambele intenționate:
//
// 1. Urmărirea unui serial e permanentă (mereu vor apărea episoade noi), pe
//    când urmărirea unui film se stinge singură la prima descărcare reușită.
//    Altfel ar căuta la nesfârșit un film pe care deja îl ai.
//
// 2. Un film urmărit nu e un film pe care îl deții. Rândul lui din `media` n-are
//    torrent_hash și n-are plex_rating_key, iar asta îl face invizibil peste
//    tot în rest fără nicio modificare: Biblioteca cere explicit una dintre
//    cele două coloane (plex-browse.ts), la fel reconcilierea Plex
//    (plex-link-reconciler.ts) și reluarea descărcărilor întrerupte. Nu poate
//    fi confundat cu un film pe care chiar îl ai.
// ---------------------------------------------------------------------------

import { getDb } from "../db";

// 12h, nu 3h ca la seriale. Un episod are oră de difuzare anunțată și apare pe
// Filelist în câteva ore, deci acolo o cadență scurtă chiar prinde ceva. Un
// film poate sta luni întregi, iar fiecare verificare e o căutare pe Filelist —
// bătută la 3 ore n-ar găsi nimic în plus, ar consuma doar cereri.
const ITEM_INTERVAL_MS = 12 * 60 * 60 * 1000;

export interface MovieWatchOutcome {
  mediaId: number;
  title: string;
  // Numele torrentului pornit, dacă filmul a fost găsit în rularea asta.
  downloaded: string | null;
  skipped: string | null;
}

interface MovieRow {
  id: number;
  title: string;
  original_title: string | null;
  literal_title: string | null;
  imdb_id: string | null;
  tmdb_id: number | null;
  year: number | null;
  poster_path: string | null;
  overview_ro: string | null;
  genres: string;
  auto_download_quality: string | null;
  requested_by_user_id: number | null;
}

// Poarta pe data de lansare: înainte de premieră nu POATE exista un release,
// deci căutarea e sigur irosită. Filmul apare pe Filelist mult mai târziu
// (după lansarea digitală), deci asta nu e o predicție a disponibilității — e
// doar limita de jos sub care nu are rost să întrebăm.
//
// Fără dată în TMDB căutăm oricum: o dată lipsă nu e o dovadă că filmul n-a
// apărut, iar a refuza să căutăm ar bloca urmărirea la nesfârșit.
export function hasReleased(releaseDate: string | null, now: Date = new Date()): boolean {
  if (!releaseDate) return true;
  const released = new Date(`${releaseDate}T00:00:00`);
  if (Number.isNaN(released.getTime())) return true;
  return released.getTime() <= now.getTime();
}

// Candidații pentru un film urmărit: potriviți pe IMDb de Filelist, exact la
// calitatea cerută, cel mai bine sămânțat primul.
//
// Calitate exactă, nu „cel puțin": aceeași semantică cu urmărirea serialelor
// (show-watch.ts), unde e tot `detectTorrentQuality(...) === calitatea cerută`.
// Dacă ai cerut 1080p, un 4K de 60GB n-ar fi o surpriză plăcută.
export function pickCandidates<
  T extends { name: string; seeders: number; matchedByImdb?: boolean },
>(torrents: T[], wantedQuality: string, detect: (name: string) => string): T[] {
  return torrents
    .filter((t) => t.matchedByImdb !== false)
    .filter((t) => detect(t.name) === wantedQuality)
    .sort((a, b) => b.seeders - a.seeders);
}

// Gardă per film, ca la checkShow: „Verifică acum" din UI și bucla plugin-ului
// pot cădea pe același film în același moment, iar două rulări paralele ar
// porni de două ori același torrent.
const inProgress = new Set<number>();

export async function checkMovie(
  movieId: number,
  opts: { skipCache?: boolean } = {},
): Promise<MovieWatchOutcome> {
  if (inProgress.has(movieId)) {
    return { mediaId: movieId, title: "?", downloaded: null, skipped: "verificare deja în curs" };
  }
  inProgress.add(movieId);
  try {
    return await checkMovieInner(movieId, opts);
  } finally {
    inProgress.delete(movieId);
  }
}

async function checkMovieInner(
  movieId: number,
  opts: { skipCache?: boolean },
): Promise<MovieWatchOutcome> {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, title, original_title, literal_title, imdb_id, tmdb_id, year,
              poster_path, overview_ro, genres, auto_download_quality, requested_by_user_id
         FROM media
        WHERE id = ? AND media_type = 'movie'
          AND torrent_hash IS NULL AND plex_rating_key IS NULL`,
    )
    .get(movieId) as unknown as MovieRow | undefined;

  // datetime('now'), nu ISO — vezi nota din show-watch.ts: restul coloanelor de
  // timp din `media` sunt în formatul SQLite, iar comparația din
  // checkDueMovies e pe șiruri.
  const stamp = () =>
    db
      .prepare("UPDATE media SET watch_last_checked_at = datetime('now') WHERE id = ?")
      .run(movieId);

  if (!row) {
    return { mediaId: movieId, title: "?", downloaded: null, skipped: "film inexistent" };
  }
  const result: MovieWatchOutcome = {
    mediaId: movieId,
    title: row.title,
    downloaded: null,
    skipped: null,
  };

  // Căutarea pe Filelist e strict pe IMDb (fallback-ul pe titlu a fost eliminat
  // definitiv, confirmat de suportul Filelist), deci fără id n-avem ce face.
  if (!row.imdb_id) {
    stamp();
    result.skipped = "lipsește imdb_id";
    return result;
  }

  const { getTmdbDetailsInternal } = await import("../tmdb/tmdb.functions");
  const details = row.tmdb_id
    ? await getTmdbDetailsInternal(row.tmdb_id, "movie").catch(() => null)
    : null;

  if (!hasReleased(details?.releaseDate ?? null)) {
    stamp();
    result.skipped = `nelansat încă (${details?.releaseDate})`;
    return result;
  }

  const { checkFilelistForItemInternal } = await import("../filelist/filelist-client");
  const search = await checkFilelistForItemInternal({
    title: row.title,
    originalTitle: row.literal_title || row.original_title || row.title,
    imdbId: row.imdb_id,
    mediaType: "movie",
    skipCache: opts.skipCache,
  });
  if (search.status !== "ok") {
    stamp();
    result.skipped = search.error ?? "eroare Filelist";
    return result;
  }

  const wantedQuality = row.auto_download_quality || "1080p";
  const { detectTorrentQuality } = await import("./torrent-quality");
  const candidates = pickCandidates(search.torrents, wantedQuality, detectTorrentQuality);

  if (candidates.length === 0) {
    stamp();
    result.skipped = `încă niciun torrent ${wantedQuality}`;
    return result;
  }

  const best = candidates[0];
  const { downloadFilelistCore } = await import("../filelist/download");
  const dl = await downloadFilelistCore({
    torrentId: best.id,
    torrentName: best.name,
    categoryId: best.category,
    categoryName: best.categoryName,
    size: best.size,
    freeleech: best.freeleech,
    internal: best.internal,
    imdb: best.imdb ?? row.imdb_id,
    requestedByUserId: row.requested_by_user_id,
    media: {
      mediaType: "movie",
      imdbId: best.imdb ?? row.imdb_id,
      tmdbId: row.tmdb_id,
      title: row.title,
      originalTitle: row.original_title,
      literalTitle: row.literal_title,
      year: row.year,
      overviewRo: row.overview_ro,
      genres: safeGenres(row.genres),
      posterPath: row.poster_path,
      season: null,
      episode: null,
      isSeasonPack: false,
      addedVia: "auto",
    },
  });

  if (dl.status !== "ok") {
    stamp();
    result.skipped = `descărcare eșuată: ${dl.error}`;
    return result;
  }

  // Rândul de așteptare și-a făcut treaba: downloadFilelistCore a creat deja
  // rândul real prin upsertMediaEntry. Nu e un update, ci un rând nou —
  // findExistingDownloadRow potrivește exclusiv pe torrent_hash, iar rândul de
  // așteptare n-are niciunul, deci n-avea cum să fie reutilizat. Fără ștergerea
  // asta ar rămâne două rânduri pentru același film.
  //
  // Condiția pe torrent_hash IS NULL nu e decorativă: e garanția că ștergem
  // exact rândul-fantomă, niciodată filmul proaspăt descărcat.
  db.prepare("DELETE FROM media WHERE id = ? AND torrent_hash IS NULL").run(movieId);

  // Fără notificare proprie: downloadFilelistCore loghează torrent_added și
  // trimite push-ul, iar addedVia "auto" îi pune titlul „🤖 Descărcare
  // Automată". Un push în plus de aici ar dubla fiecare film.
  result.downloaded = best.name;
  return result;
}

function safeGenres(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Prima verificare a unui film abia adăugat, la un minut după adăugare.
//
// Separată de bucla de 12h din două motive. Întâi, ritmul: fără ea, un film
// nou aștepta până la 10 minute (cadența de poll a plugin-ului) și rândul
// arăta „neverificat" tot timpul ăsta, ca și cum urmărirea ar fi moartă.
//
// Al doilea, și mai important: ocolește cache-ul Filelist. Wizard-ul tocmai a
// căutat același IMDb ca să-ți poată spune „nu există încă la calitatea X",
// iar cache-ul ăla ține 10 minute — exact cât ciclul plugin-ului. O verificare
// care nimerește în el ar scrie un timestamp fără să fi întrebat pe nimeni.
//
// Minutul de așteptare nu e arbitrar: e cât să nu repetăm căutarea wizard-ului
// în aceeași suflare, dar destul de scurt cât rândul să se completeze cât încă
// te uiți la el.
export async function checkNewMovies(): Promise<void> {
  const db = getDb();
  const fresh = db
    .prepare(
      `SELECT id FROM media
         WHERE media_type = 'movie' AND auto_download = 1
           AND torrent_hash IS NULL AND plex_rating_key IS NULL
           AND watch_last_checked_at IS NULL
           AND added_at <= datetime('now', '-60 seconds')`,
    )
    .all() as unknown as Array<{ id: number }>;

  for (const { id } of fresh) {
    try {
      const outcome = await checkMovie(id, { skipCache: true });
      console.log(
        `[movie-watch] prima verificare "${outcome.title}" — ${outcome.downloaded ?? outcome.skipped}`,
      );
    } catch (e) {
      console.warn(`[movie-watch] Eroare la prima verificare a filmului ${id}:`, e);
    }
  }
}

// Bucla periodică, analog cu checkDueShows. Cadența e persistată în
// watch_last_checked_at, nu într-un timer în memorie, ca să supraviețuiască
// restartului serviciului.
//
// Rândurile cu watch_last_checked_at NULL sunt lăsate intenționat pe seama lui
// checkNewMovies: dacă ar intra și aici, un poll care se nimerește la câteva
// secunde după adăugare ar face verificarea prea devreme și, mai rău, cu
// cache-ul wizard-ului încă valid.
export async function checkDueMovies(): Promise<void> {
  const db = getDb();
  const due = db
    .prepare(
      `SELECT id FROM media
         WHERE media_type = 'movie' AND auto_download = 1
           AND torrent_hash IS NULL AND plex_rating_key IS NULL
           AND watch_last_checked_at IS NOT NULL
           AND watch_last_checked_at <= datetime('now', ?)`,
    )
    .all(`-${Math.round(ITEM_INTERVAL_MS / 1000)} seconds`) as unknown as Array<{ id: number }>;

  for (const { id } of due) {
    try {
      const outcome = await checkMovie(id);
      if (outcome.downloaded) {
        console.log(`[movie-watch] "${outcome.title}" — pornit ${outcome.downloaded}`);
      } else if (outcome.skipped) {
        console.log(`[movie-watch] "${outcome.title}" — sărit: ${outcome.skipped}`);
      }
    } catch (e) {
      console.warn(`[movie-watch] Eroare la filmul ${id}:`, e);
    }
  }
}

// ---------------------------------------------------------------------------
// Pornirea / oprirea urmăririi
// ---------------------------------------------------------------------------

export interface SetMovieWatchInput {
  tmdbId: number;
  enabled: boolean;
  quality?: string;
  // Metadatele vin de la apelant (wizard-ul le are deja din TMDB) și se
  // folosesc doar la crearea rândului.
  imdbId?: string | null;
  title?: string;
  originalTitle?: string | null;
  literalTitle?: string | null;
  year?: number | null;
  posterPath?: string | null;
  overviewRo?: string | null;
  genres?: string[];
  requestedByUserId?: number | null;
}

export async function setMovieWatchCore(input: SetMovieWatchInput): Promise<void> {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id, torrent_hash, plex_rating_key FROM media
        WHERE tmdb_id = ? AND media_type = 'movie'`,
    )
    .get(input.tmdbId) as
    { id: number; torrent_hash: string | null; plex_rating_key: string | null } | undefined;

  const isWantedRow = existing != null && !existing.torrent_hash && !existing.plex_rating_key;

  if (!input.enabled) {
    if (!existing) return;
    // Un rând de așteptare abandonat nu are ce lăsa în urmă: n-are fișier,
    // n-are torrent și e invizibil peste tot, deci l-am păstra doar ca gunoi.
    // Un film real, în schimb, se atinge cât mai puțin — doar steagul.
    if (isWantedRow) {
      db.prepare("DELETE FROM media WHERE id = ? AND torrent_hash IS NULL").run(existing.id);
    } else {
      db.prepare("UPDATE media SET auto_download = 0 WHERE id = ?").run(existing.id);
    }
    return;
  }

  // Filmul e deja descărcat sau deja în Plex — nu are ce urmări. Aruncăm, nu
  // ignorăm în tăcere: e o stare pe care UI-ul trebuie s-o arate, nu una care
  // să pară că a mers.
  if (existing && !isWantedRow) {
    throw new Error("Filmul există deja în bibliotecă");
  }

  const quality = input.quality ?? "1080p";

  if (isWantedRow) {
    // Deja urmărit: singurul lucru care se schimbă e calitatea. Cadența se
    // resetează, ca schimbarea să fie verificată la următorul ciclu și nu
    // peste 12 ore.
    db.prepare(
      `UPDATE media SET auto_download = 1, auto_download_quality = ?,
              watch_last_checked_at = NULL WHERE id = ?`,
    ).run(quality, existing!.id);
    return;
  }

  db.prepare(
    `INSERT INTO media (
       media_type, imdb_id, tmdb_id, title, original_title, literal_title, year,
       overview_ro, genres, poster_path, added_via, requested_by_user_id,
       auto_download, auto_download_quality
     ) VALUES ('movie',?,?,?,?,?,?,?,?,?,'watch',?,1,?)`,
  ).run(
    input.imdbId ?? null,
    input.tmdbId,
    input.title ?? "Film",
    input.originalTitle ?? null,
    input.literalTitle ?? null,
    input.year ?? null,
    input.overviewRo ?? null,
    JSON.stringify(input.genres ?? []),
    input.posterPath ?? null,
    input.requestedByUserId ?? null,
    quality,
  );
}

// ---------------------------------------------------------------------------
// Citire pentru UI
// ---------------------------------------------------------------------------

export interface WantedMovie {
  mediaId: number;
  tmdbId: number | null;
  title: string;
  year: number | null;
  posterPath: string | null;
  quality: string;
  addedAt: string;
  lastCheckedAt: string | null;
  requestedByUserId: number | null;
  // true doar pentru cel care a pornit urmărirea sau pentru un admin — la fel
  // ca la titlurile din bibliotecă (vezi canManage din plex-browse.ts). Se
  // calculează în server function, unde există sesiunea; aici, în stratul de
  // DB, n-avem cine e cel care întreabă.
  canManage: boolean;
}

export function listWantedMoviesCore(): Omit<WantedMovie, "canManage">[] {
  const db = getDb();
  return (
    db
      .prepare(
        `SELECT id, tmdb_id, title, year, poster_path, auto_download_quality,
                added_at, watch_last_checked_at, requested_by_user_id
           FROM media
          WHERE media_type = 'movie' AND auto_download = 1
            AND torrent_hash IS NULL AND plex_rating_key IS NULL
          ORDER BY added_at DESC`,
      )
      .all() as unknown as Array<{
      id: number;
      tmdb_id: number | null;
      title: string;
      year: number | null;
      poster_path: string | null;
      auto_download_quality: string | null;
      added_at: string;
      watch_last_checked_at: string | null;
      requested_by_user_id: number | null;
    }>
  ).map((r) => ({
    mediaId: r.id,
    tmdbId: r.tmdb_id,
    title: r.title,
    year: r.year,
    posterPath: r.poster_path,
    quality: r.auto_download_quality || "1080p",
    addedAt: r.added_at,
    lastCheckedAt: r.watch_last_checked_at,
    requestedByUserId: r.requested_by_user_id,
  }));
}

// Detaliile unui film așteptat, pentru drawer. Separat de listă intenționat:
// descrierea, genurile și numele celui care a pornit urmărirea se văd doar la
// deschidere, deci n-are rost cărate pentru toate rândurile.
export interface WantedMovieDetail {
  mediaId: number;
  tmdbId: number | null;
  imdbId: string | null;
  title: string;
  originalTitle: string | null;
  year: number | null;
  posterPath: string | null;
  overview: string | null;
  genres: string[];
  quality: string;
  addedAt: string;
  lastCheckedAt: string | null;
  requestedByUserId: number | null;
  // Numele contului care a pornit urmărirea. Null când rândul e mai vechi
  // decât urmărirea per utilizator, sau când contul a fost șters între timp —
  // de-aia LEFT JOIN, nu JOIN: altfel rândul ar dispărea cu totul din drawer.
  requestedByUsername: string | null;
}

export function getWantedMovieDetailCore(mediaId: number): WantedMovieDetail | null {
  const db = getDb();
  const r = db
    .prepare(
      `SELECT m.id, m.tmdb_id, m.imdb_id, m.title, m.original_title, m.year,
              m.poster_path, m.overview_ro, m.genres, m.auto_download_quality,
              m.added_at, m.watch_last_checked_at, m.requested_by_user_id,
              u.username AS requested_by_username
         FROM media m
         LEFT JOIN users u ON u.id = m.requested_by_user_id
        WHERE m.id = ? AND m.media_type = 'movie'
          AND m.torrent_hash IS NULL AND m.plex_rating_key IS NULL`,
    )
    .get(mediaId) as unknown as
    | {
        id: number;
        tmdb_id: number | null;
        imdb_id: string | null;
        title: string;
        original_title: string | null;
        year: number | null;
        poster_path: string | null;
        overview_ro: string | null;
        genres: string;
        auto_download_quality: string | null;
        added_at: string;
        watch_last_checked_at: string | null;
        requested_by_user_id: number | null;
        requested_by_username: string | null;
      }
    | undefined;
  if (!r) return null;
  return {
    mediaId: r.id,
    tmdbId: r.tmdb_id,
    imdbId: r.imdb_id,
    title: r.title,
    originalTitle: r.original_title,
    year: r.year,
    posterPath: r.poster_path,
    overview: r.overview_ro,
    genres: safeGenres(r.genres),
    quality: r.auto_download_quality || "1080p",
    addedAt: r.added_at,
    lastCheckedAt: r.watch_last_checked_at,
    requestedByUserId: r.requested_by_user_id,
    requestedByUsername: r.requested_by_username,
  };
}
