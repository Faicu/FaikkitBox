// ---------------------------------------------------------------------------
// Urmărirea filmelor: descărcarea automată a unui film care încă nu există pe
// Filelist la calitatea cerută. Simetric cu show-watch.ts, dar mult mai mic:
// un film e o singură întrebare, pusă periodic — „a apărut?”.
//
// Diferențe față de seriale, intenționate:
// 1. Urmărirea se stinge singură la prima descărcare reușită.
// 2. Rândul unui film așteptat n-are torrent_hash și nici plex_rating_key,
//    deci e invizibil în Bibliotecă, reconciliere și descărcări fără nicio
//    excepție în cod — nu poate fi confundat cu un film pe care îl ai.
// ---------------------------------------------------------------------------

import {
  effectiveFallback,
  fallbackReady,
  parseFallbackSeen,
  type FallbackSeen,
} from "./fallback-quality";
import { getDb } from "../db";
import { rankTorrents, type RankableTorrent } from "./torrent-rank";

// 12h, nu 3h ca la seriale: un film poate lipsi luni întregi, iar fiecare
// verificare e o căutare pe Filelist.
const ITEM_INTERVAL_MS = 12 * 60 * 60 * 1000;

export interface MovieWatchOutcome {
  mediaId: number;
  title: string;
  // Numele torrentului pornit, dacă filmul a fost găsit în rularea asta.
  downloaded: string | null;
  // Calitatea de rezervă, dacă a fost luată ea.
  fallbackQuality: string | null;
  skipped: string | null;
  // Eroare Filelist sau descărcare eșuată — Watcher-ul marchează rularea eșuată.
  error: string | null;
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
  auto_download_fallback_quality: string | null;
  watch_fallback_seen: string | null;
  requested_by_user_id: number | null;
}

// Înainte de premieră nu poate exista un release, deci nu căutăm. Fără dată în
// TMDB căutăm oricum — altfel urmărirea s-ar bloca la nesfârșit.
function hasReleased(releaseDate: string | null, now: Date = new Date()): boolean {
  if (!releaseDate) return true;
  const released = new Date(`${releaseDate}T00:00:00`);
  if (Number.isNaN(released.getTime())) return true;
  return released.getTime() <= now.getTime();
}

// Candidații: potriviți pe IMDb, exact la calitatea cerută (ca la seriale — un
// 4K de 60 GB nu e o surpriză plăcută când ai cerut 1080p), fără cei excluși,
// cel mai bun primul (torrent-rank.ts).
function pickCandidates<T extends RankableTorrent & { matchedByImdb?: boolean }>(
  torrents: T[],
  wantedQuality: string,
  detect: (name: string) => string,
): T[] {
  return rankTorrents(
    torrents
      .filter((t) => t.matchedByImdb !== false)
      .filter((t) => detect(t.name) === wantedQuality),
    "movie",
  );
}

// Gardă per film: „Verifică acum” și Watcher-ul pe același film ar porni de
// două ori același torrent.
const inProgress = new Set<number>();

export async function checkMovie(movieId: number): Promise<MovieWatchOutcome> {
  if (inProgress.has(movieId)) {
    return {
      mediaId: movieId,
      title: "?",
      downloaded: null,
      fallbackQuality: null,
      skipped: "verificare deja în curs",
      error: null,
    };
  }
  inProgress.add(movieId);
  // Rezultatul ultimei verificări, afișat în Watcher. După o descărcare
  // reușită rândul de așteptare e șters, deci n-are ce afișa.
  const save = (text: string) =>
    getDb().prepare("UPDATE media SET watch_last_result = ? WHERE id = ?").run(text, movieId);
  try {
    const out = await checkMovieInner(movieId);
    if (!out.downloaded) save(out.error ? `eroare: ${out.error}` : (out.skipped ?? "verificat"));
    return out;
  } catch (e) {
    save(`eroare: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  } finally {
    inProgress.delete(movieId);
  }
}

async function checkMovieInner(movieId: number): Promise<MovieWatchOutcome> {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, title, original_title, literal_title, imdb_id, tmdb_id, year,
              poster_path, overview_ro, genres, auto_download_quality,
              auto_download_fallback_quality, watch_fallback_seen, requested_by_user_id
         FROM media
        WHERE id = ? AND media_type = 'movie'
          AND torrent_hash IS NULL AND plex_rating_key IS NULL`,
    )
    .get(movieId) as unknown as MovieRow | undefined;

  // datetime('now'), nu ISO — comparația din checkDueMovies e pe șiruri (vezi
  // show-watch.ts).
  const stamp = () =>
    db
      .prepare("UPDATE media SET watch_last_checked_at = datetime('now') WHERE id = ?")
      .run(movieId);

  if (!row) {
    return {
      mediaId: movieId,
      title: "?",
      downloaded: null,
      fallbackQuality: null,
      skipped: "film inexistent",
      error: null,
    };
  }
  const result: MovieWatchOutcome = {
    mediaId: movieId,
    title: row.title,
    downloaded: null,
    fallbackQuality: null,
    skipped: null,
    error: null,
  };

  // Căutarea pe Filelist e strict după IMDb (confirmat de suport).
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
  });
  if (search.status !== "ok") {
    stamp();
    result.skipped = search.error ?? "eroare Filelist";
    result.error = result.skipped;
    return result;
  }

  const wantedQuality = row.auto_download_quality || "1080p";
  const { detectTorrentQuality } = await import("./torrent-quality");
  let candidates = pickCandidates(search.torrents, wantedQuality, detectTorrentQuality);

  // Rezerva doar dacă principala lipsește; se descarcă la o verificare de peste
  // cel puțin 3h (fallback-quality.ts).
  const fallbackQuality = effectiveFallback(wantedQuality, row.auto_download_fallback_quality);
  const saveFallbackSeen = (seen: FallbackSeen) =>
    db
      .prepare("UPDATE media SET watch_fallback_seen = ? WHERE id = ?")
      .run(Object.keys(seen).length > 0 ? JSON.stringify(seen) : null, movieId);
  let usingFallback = false;
  if (candidates.length === 0 && fallbackQuality) {
    const fallbackCandidates = pickCandidates(
      search.torrents,
      fallbackQuality,
      detectTorrentQuality,
    );
    if (fallbackCandidates.length > 0) {
      const decision = fallbackReady(
        "film",
        parseFallbackSeen(row.watch_fallback_seen),
        Date.now(),
      );
      if (!decision.ready) {
        saveFallbackSeen({ film: decision.firstSeen });
        stamp();
        result.skipped = `doar ${fallbackQuality} — dacă ${wantedQuality} nu apare, se descarcă ${fallbackQuality} la o verificare de peste 3 ore`;
        return result;
      }
      candidates = fallbackCandidates;
      usingFallback = true;
    }
  }
  // Principala a apărut sau nu mai e nici rezerva: nimic de așteptat. Notița
  // rezervei folosite rămâne — după o descărcare eșuată se reia fără așteptare.
  if (!usingFallback) saveFallbackSeen({});

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
    result.error = result.skipped;
    return result;
  }

  // Rândul de așteptare și-a făcut treaba: downloadFilelistCore a creat rândul
  // real (rândul de așteptare n-are hash, deci n-a putut fi refolosit). Fără
  // ștergere ar rămâne două rânduri. `torrent_hash IS NULL` garantează că
  // ștergem doar fantoma.
  db.prepare("DELETE FROM media WHERE id = ? AND torrent_hash IS NULL").run(movieId);

  // Fără notificare aici: downloadFilelistCore trimite deja push-ul.
  result.downloaded = usingFallback ? `${best.name} (${fallbackQuality}, rezervă)` : best.name;
  if (usingFallback) result.fallbackQuality = fallbackQuality;
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

// Prima căutare a unui film abia adăugat — pasul „Filme noi” al sarcinii
// „Seriale și filme”, trezită de setMovieWatch după un minut. Fără ea, rândul
// ar arăta „neverificat” până la 10 minute. Minutul evită repetarea căutării
// tocmai făcute în wizard.
export async function checkNewMovies(): Promise<MovieRunReport> {
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

  const report: MovieRunReport = { started: [], errors: [] };
  for (const { id } of fresh) {
    try {
      const outcome = await checkMovie(id);
      console.log(
        `[movie-watch] prima verificare "${outcome.title}" — ${outcome.downloaded ?? outcome.skipped}`,
      );
      addToReport(report, outcome);
    } catch (e) {
      console.warn(`[movie-watch] Eroare la prima verificare a filmului ${id}:`, e);
      report.errors.push(`filmul ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return report;
}

// Pentru istoricul Watcher-ului: ce a pornit și ce a eșuat.
interface MovieRunReport {
  started: string[];
  errors: string[];
}

function addToReport(report: MovieRunReport, o: MovieWatchOutcome): void {
  if (o.downloaded) {
    report.started.push(o.fallbackQuality ? `${o.title} (${o.fallbackQuality}, rezervă)` : o.title);
  }
  if (o.error) report.errors.push(`${o.title}: ${o.error}`);
}

// Filmele cu cadența expirată, ținută în watch_last_checked_at. Cele încă
// neverificate (NULL) sunt ale lui checkNewMovies — aici ar fi verificate
// prea devreme.
export async function checkDueMovies(): Promise<MovieRunReport> {
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

  const report: MovieRunReport = { started: [], errors: [] };
  for (const { id } of due) {
    try {
      const outcome = await checkMovie(id);
      if (outcome.downloaded) {
        console.log(`[movie-watch] "${outcome.title}" — pornit ${outcome.downloaded}`);
      } else if (outcome.skipped) {
        console.log(`[movie-watch] "${outcome.title}" — sărit: ${outcome.skipped}`);
      }
      addToReport(report, outcome);
    } catch (e) {
      console.warn(`[movie-watch] Eroare la filmul ${id}:`, e);
      report.errors.push(`filmul ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return report;
}

// ---------------------------------------------------------------------------
// Pornirea / oprirea urmăririi
// ---------------------------------------------------------------------------

export interface SetMovieWatchInput {
  tmdbId: number;
  enabled: boolean;
  quality?: string;
  // Calitatea de rezervă: `undefined` = neschimbată; `null` = fără.
  fallbackQuality?: string | null;
  // Metadatele vin de la wizard și se folosesc doar la crearea rândului.
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
    // Un rând de așteptare abandonat e doar gunoi; la un film real schimbăm
    // doar steagul.
    if (isWantedRow) {
      db.prepare("DELETE FROM media WHERE id = ? AND torrent_hash IS NULL").run(existing.id);
    } else {
      db.prepare("UPDATE media SET auto_download = 0 WHERE id = ?").run(existing.id);
    }
    return;
  }

  // Filmul există deja — aruncăm, ca UI-ul s-o arate, nu să pară că a mers.
  if (existing && !isWantedRow) {
    throw new Error("Filmul există deja în bibliotecă");
  }

  const quality = input.quality ?? "1080p";

  if (isWantedRow) {
    // Deja urmărit: se schimbă calitatea, iar cadența se resetează ca
    // schimbarea să se verifice imediat. Notițele rezervei se golesc.
    db.prepare(
      `UPDATE media SET auto_download = 1, auto_download_quality = ?,
              auto_download_fallback_quality = CASE WHEN ? THEN ? ELSE auto_download_fallback_quality END,
              watch_fallback_seen = NULL, watch_last_checked_at = NULL,
              watch_last_result = NULL
        WHERE id = ?`,
    ).run(
      quality,
      input.fallbackQuality !== undefined ? 1 : 0,
      input.fallbackQuality ?? null,
      existing!.id,
    );
    return;
  }

  db.prepare(
    `INSERT INTO media (
       media_type, imdb_id, tmdb_id, title, original_title, literal_title, year,
       overview_ro, genres, poster_path, added_via, requested_by_user_id,
       auto_download, auto_download_quality, auto_download_fallback_quality
     ) VALUES ('movie',?,?,?,?,?,?,?,?,?,'watch',?,1,?,?)`,
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
    input.fallbackQuality ?? null,
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
  // Rezultatul ultimei verificări („încă niciun torrent 1080p”).
  lastResult: string | null;
  requestedByUserId: number | null;
  // true pentru cel care a pornit urmărirea sau un admin — calculat în server
  // function, unde există sesiunea.
  canManage: boolean;
}

export function listWantedMoviesCore(): Omit<WantedMovie, "canManage">[] {
  const db = getDb();
  return (
    db
      .prepare(
        `SELECT id, tmdb_id, title, year, poster_path, auto_download_quality,
                added_at, watch_last_checked_at, watch_last_result, requested_by_user_id
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
      watch_last_result: string | null;
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
    lastResult: r.watch_last_result,
    requestedByUserId: r.requested_by_user_id,
  }));
}

// Detaliile unui film așteptat, pentru drawer — separat de listă, ca să nu
// cărăm descrierea și genurile pentru toate rândurile.
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
  // Calitatea de rezervă; null = fără.
  fallbackQuality: string | null;
  addedAt: string;
  lastCheckedAt: string | null;
  requestedByUserId: number | null;
  // Contul care a pornit urmărirea; null pentru rânduri vechi sau conturi
  // șterse (de-aia LEFT JOIN — altfel rândul ar dispărea din drawer).
  requestedByUsername: string | null;
}

export function getWantedMovieDetailCore(mediaId: number): WantedMovieDetail | null {
  const db = getDb();
  const r = db
    .prepare(
      `SELECT m.id, m.tmdb_id, m.imdb_id, m.title, m.original_title, m.year,
              m.poster_path, m.overview_ro, m.genres, m.auto_download_quality,
              m.auto_download_fallback_quality, m.added_at, m.watch_last_checked_at, m.requested_by_user_id,
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
        auto_download_fallback_quality: string | null;
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
    fallbackQuality: r.auto_download_fallback_quality,
    addedAt: r.added_at,
    lastCheckedAt: r.watch_last_checked_at,
    requestedByUserId: r.requested_by_user_id,
    requestedByUsername: r.requested_by_username,
  };
}
