// ---------------------------------------------------------------------------
// Sursă unică pentru datele unui titlu media — vezi schema `media` din db.ts.
// Populată exclusiv de căile de descărcare (wizard, căutare manuală
// Filelist cu rezolvare TMDB best-effort) — vezi upsertMediaEntry.
// ---------------------------------------------------------------------------

import { getDb } from "../db";
// Doar tipuri: `import type` dispare la compilare, deci nu trage modulele Plex
// în graf — restul fișierului le încarcă dinamic, exact ca până acum.
import type { PlexItemLink } from "../services/plex-library";
import type { PlexMetadataItem } from "../services/plex-shared";

// "auto" = pornit de urmărirea serialelor (show-watch.ts), fără intervenție
// umană — singurul caz în care un torrent apare în bibliotecă fără ca cineva
// să fi apăsat ceva, deci merită deosebit în notificări.
export type AddedVia = "wizard" | "manual" | "backfill" | "auto";

export interface UpsertMediaEntryInput {
  mediaType: "movie" | "episode";
  imdbId: string | null;
  tmdbId: number | null;
  title: string;
  originalTitle?: string | null;
  literalTitle?: string | null;
  year?: number | null;
  season?: number | null;
  episode?: number | null;
  overviewRo?: string | null;
  genres?: string[];
  posterPath?: string | null;
  tvStatus?: string | null;
  torrentName?: string | null;
  torrentHash?: string | null;
  category?: number | null;
  categoryName?: string | null;
  size?: number;
  freeleech?: boolean;
  internal?: boolean;
  savePath?: string | null;
  isSeasonPack?: boolean;
  addedVia: AddedVia;
  requestedByUserId?: number | null;
}

// Găsește un rând `media` fără proveniență de torrent deja existent (rândul-
// părinte al unui serial, sau un placeholder de film creat la căutare) —
// prioritar după tmdb_id (mereu prezent odată rezolvat prin TMDB, spre
// deosebire de imdb_id, absent pentru multe titluri — reality show-uri,
// producții locale etc). SQL `imdb_id = NULL` nu se potrivește niciodată cu
// sine (semantica NULL), deci un lookup doar pe imdb_id ar crea un rând nou
// de fiecare dată pentru un titlu fără imdb_id — exact bug-ul reprodus la
// primul backfill (opt rânduri "Elita" în loc de unul). Cade pe imdb_id,
// apoi pe titlu exact (fără niciun id cunoscut), ca ultimă plasă de
// siguranță.
function findExistingMediaRow(
  mediaType: "movie" | "tv_show",
  input: { imdbId: string | null; tmdbId: number | null; title: string },
): number | null {
  const db = getDb();
  if (input.tmdbId != null) {
    const row = db
      .prepare("SELECT id FROM media WHERE media_type = ? AND tmdb_id = ?")
      .get(mediaType, input.tmdbId) as { id: number } | undefined;
    if (row) return row.id;
  }
  if (input.imdbId) {
    const row = db
      .prepare("SELECT id FROM media WHERE media_type = ? AND imdb_id = ?")
      .get(mediaType, input.imdbId) as { id: number } | undefined;
    if (row) return row.id;
  }
  // Plasa de titlu-exact e folosită DOAR când input-ul curent nu are el
  // însuși un tmdb_id/imdb_id rezolvat — altfel, pentru un titlu nou cu
  // tmdb_id rezolvat dar fără rând încă în `media`, s-ar putea potrivi din
  // greșeală cu un placeholder vechi, nerezolvat, al unui titlu DIFERIT care
  // are întâmplător exact același nume (remake-uri, titluri generice),
  // lipind greșit noul tmdb_id pe rândul altui titlu.
  if (input.tmdbId != null || input.imdbId) return null;
  const row = db
    .prepare(
      "SELECT id FROM media WHERE media_type = ? AND tmdb_id IS NULL AND imdb_id IS NULL AND title = ?",
    )
    .get(mediaType, input.title) as { id: number } | undefined;
  return row?.id ?? null;
}

export interface MediaPlaceholderInput {
  imdbId: string | null;
  tmdbId: number | null;
  title: string;
  originalTitle?: string | null;
  literalTitle?: string | null;
  year?: number | null;
  overviewRo?: string | null;
  genres?: string[];
  posterPath?: string | null;
  tvStatus?: string | null;
  addedVia: AddedVia;
  requestedByUserId?: number | null;
}

// Creează (sau actualizează, dacă există deja) rândul-părinte al unui serial
// — apelat intern la fiecare episod inserat (descărcare sau backfill).
// Actualizarea nu atinge niciodată coloanele de proveniență torrent — cele
// aparțin doar rândurilor de episod/film create la descărcare
// (upsertMediaEntry).
function ensureMediaPlaceholder(
  mediaType: "movie" | "tv_show",
  input: MediaPlaceholderInput,
): number {
  const db = getDb();
  const existingId = findExistingMediaRow(mediaType, input);
  if (existingId != null) {
    db.prepare(
      `UPDATE media SET title = ?, original_title = ?, literal_title = ?, year = ?,
       overview_ro = ?, genres = ?, poster_path = ?, tv_status = ?, tmdb_id = ?,
       requested_by_user_id = COALESCE(requested_by_user_id, ?), updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      input.title,
      input.originalTitle ?? null,
      input.literalTitle ?? null,
      input.year ?? null,
      input.overviewRo ?? null,
      JSON.stringify(input.genres ?? []),
      input.posterPath ?? null,
      input.tvStatus ?? null,
      input.tmdbId,
      input.requestedByUserId ?? null,
      existingId,
    );
    return existingId;
  }
  const res = db
    .prepare(
      `INSERT INTO media (
        media_type, imdb_id, tmdb_id, title, original_title, literal_title, year,
        overview_ro, genres, poster_path, tv_status, added_via, requested_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      mediaType,
      input.imdbId,
      input.tmdbId,
      input.title,
      input.originalTitle ?? null,
      input.literalTitle ?? null,
      input.year ?? null,
      input.overviewRo ?? null,
      JSON.stringify(input.genres ?? []),
      input.posterPath ?? null,
      input.tvStatus ?? null,
      input.addedVia,
      input.requestedByUserId ?? null,
    );
  return Number(res.lastInsertRowid);
}

export interface LibraryTitleMatch {
  mediaId: number;
  mediaType: "movie" | "tv";
  tmdbId: number | null;
  imdbId: string | null;
  title: string;
  originalTitle: string | null;
  literalTitle: string | null;
  year: number | null;
  posterPath: string | null;
  tvStatus: string | null;
}

// Căutare de titluri deja existente în bibliotecă (rânduri-rădăcină, fără
// parent_id) — folosită la descărcarea manuală de pe Filelist, ca adminul să
// poată lega explicit un torrent de un show/film corect din bibliotecă, în
// loc să lase rezolvarea automată (autoResolveManualMedia) să ghicească după
// IMDb ID-ul torrentului — greșit pentru titluri indexate pe Filelist sub
// ID-ul altei producții din aceeași franciză (vezi spinoff-uri/reunion-uri).
export async function searchLibraryTitlesCore(query: string): Promise<LibraryTitleMatch[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, media_type, tmdb_id, imdb_id, title, original_title, literal_title, year, poster_path, tv_status
         FROM media
         WHERE parent_id IS NULL AND media_type IN ('movie', 'tv_show') AND title LIKE ?
         ORDER BY title LIMIT 20`,
    )
    .all(`%${q}%`) as Array<{
    id: number;
    media_type: string;
    tmdb_id: number | null;
    imdb_id: string | null;
    title: string;
    original_title: string | null;
    literal_title: string | null;
    year: number | null;
    poster_path: string | null;
    tv_status: string | null;
  }>;
  return rows.map((r) => ({
    mediaId: r.id,
    mediaType: r.media_type === "movie" ? "movie" : "tv",
    tmdbId: r.tmdb_id,
    imdbId: r.imdb_id,
    title: r.title,
    originalTitle: r.original_title,
    literalTitle: r.literal_title,
    year: r.year,
    posterPath: r.poster_path,
    tvStatus: r.tv_status,
  }));
}

export interface DownloadingMediaEntry {
  season: number | null;
  episode: number | null;
  isSeasonPack: boolean;
  torrentName: string | null;
}

// Ce e deja în curs de descărcare pentru un titlu (torrent pornit, dar încă
// neindexat de Plex) — folosit de wizard ca să blocheze orice acțiune nouă
// pe un sezon/episod/film deja pornit, în loc să lase userul să-l pornească
// din nou din greșeală (torrent_hash e cunoscut, plex_rating_key încă nu).
export async function getDownloadingMediaForTmdbIdCore(
  tmdbId: number,
  mediaType: "movie" | "tv",
): Promise<DownloadingMediaEntry[]> {
  const db = getDb();
  const dbMediaType = mediaType === "movie" ? "movie" : "episode";
  const rows = db
    .prepare(
      `SELECT season, episode, is_season_pack, torrent_name FROM media
         WHERE tmdb_id = ? AND media_type = ? AND torrent_hash IS NOT NULL AND plex_rating_key IS NULL`,
    )
    .all(tmdbId, dbMediaType) as Array<{
    season: number | null;
    episode: number | null;
    is_season_pack: number;
    torrent_name: string | null;
  }>;
  return rows.map((r) => ({
    season: r.season,
    episode: r.episode,
    isSeasonPack: !!r.is_season_pack,
    torrentName: r.torrent_name,
  }));
}

// Un rând deja existent pentru EXACT același torrent (hash + sezon/episod) —
// posibil dacă două cereri de descărcare pornesc aproape simultan pentru
// același episod/pachet. Fără verificarea asta, upsertMediaEntry ar insera
// un al doilea rând duplicat pentru același torrent, amândouă vizibile
// separat ca "în curs" în wizard/Bibliotecă.
function findExistingDownloadRow(input: UpsertMediaEntryInput): number | null {
  if (!input.torrentHash) return null;
  const db = getDb();
  if (input.mediaType === "episode") {
    const row = db
      .prepare(
        `SELECT id FROM media WHERE media_type = 'episode' AND torrent_hash = ?
         AND season IS ? AND episode IS ?`,
      )
      .get(input.torrentHash, input.season ?? null, input.episode ?? null) as
      { id: number } | undefined;
    return row?.id ?? null;
  }
  const row = db
    .prepare(`SELECT id FROM media WHERE media_type = 'movie' AND torrent_hash = ?`)
    .get(input.torrentHash) as { id: number } | undefined;
  return row?.id ?? null;
}

export function upsertMediaEntry(input: UpsertMediaEntryInput): number {
  const db = getDb();

  const existingId = findExistingDownloadRow(input);
  if (existingId != null) return existingId;

  const parentId = input.mediaType === "episode" ? ensureMediaPlaceholder("tv_show", input) : null;

  const res = db
    .prepare(
      `INSERT INTO media (
        media_type, parent_id, imdb_id, tmdb_id, title, original_title, literal_title,
        year, season, episode, overview_ro, genres, poster_path, tv_status,
        torrent_name, torrent_hash, category, category_name, size, freeleech, internal,
        save_path, is_season_pack, added_via, requested_by_user_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      input.mediaType,
      parentId,
      input.imdbId,
      input.tmdbId,
      input.title,
      input.originalTitle ?? null,
      input.literalTitle ?? null,
      input.year ?? null,
      input.season ?? null,
      input.episode ?? null,
      input.overviewRo ?? null,
      JSON.stringify(input.genres ?? []),
      input.posterPath ?? null,
      input.tvStatus ?? null,
      input.torrentName ?? null,
      input.torrentHash ?? null,
      input.category ?? null,
      input.categoryName ?? null,
      input.size ?? 0,
      input.freeleech ? 1 : 0,
      input.internal ? 1 : 0,
      input.savePath ?? null,
      input.isSeasonPack ? 1 : 0,
      input.addedVia,
      input.requestedByUserId ?? null,
    );
  return Number(res.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// Sincronizare ulterioară — actualizează rândul/rândurile deja existente
// (create de wizard), potrivite după torrent_hash (mai multe rânduri pot
// partaja un hash pentru pachetele de sezon — vezi migrarea v13 din db.ts).
// Dacă niciun rând `media` nu corespunde (torrent pornit din afara
// wizard-ului), UPDATE/DELETE-ul nu afectează nimic — nu creăm rânduri noi
// din aceste căi, doar sincronizăm unde există deja unul.
// ---------------------------------------------------------------------------

// Sursa subtitrării, derivată din outcome-ul ensureRomanianSubtitle
// (subtitles.ts) — vezi SubtitleOutcome acolo pentru lista completă. La
// descărcări, outcome-ul nu distinge OpenSubtitles de subs.ro (numele
// `downloaded_opensubtitles` e istoric), așa că sursa reală vine ca
// argument separat și are prioritate — vezi `downloadedSource` mai jos.
const SUBTITLE_SOURCE_BY_OUTCOME: Record<string, string | null> = {
  already_embedded: "embedded",
  audio_already_romanian: "audio_ro",
  srt_already_ok: "tracked_srt",
  renamed_srt: "tracked_srt",
  reencoded_srt: "tracked_srt",
  downloaded_opensubtitles: "opensubtitles",
  downloaded_opensubtitles_approximate: "opensubtitles",
  season_corrected: "season_aggregate",
  season_already_ok: "season_aggregate",
};

const HAS_ROMANIAN_OUTCOMES = new Set([
  "already_embedded",
  "audio_already_romanian",
  "srt_already_ok",
  "renamed_srt",
  "reencoded_srt",
  "downloaded_opensubtitles",
  "downloaded_opensubtitles_approximate",
  "season_corrected",
  "season_already_ok",
]);

// Apelat după fiecare verificare/corectare de subtitrare (finalul unei
// descărcări, "Corectează subtitrare" din Lansări/Bibliotecă, backfill).
export function updateMediaSubtitleStatus(
  torrentHash: string,
  outcome: string,
  detail: string,
  downloadedSource?: "opensubtitles" | "subsro" | null,
): void {
  const source =
    downloadedSource === "subsro" ? "subsro" : (SUBTITLE_SOURCE_BY_OUTCOME[outcome] ?? null);
  getDb()
    .prepare(
      `UPDATE media SET has_romanian_subtitle = ?, subtitle_source = ?, subtitle_detail = ?,
       has_romanian_audio = CASE WHEN ? = 1 THEN 1 ELSE has_romanian_audio END,
       subtitle_checked_at = datetime('now'), updated_at = datetime('now')
       WHERE torrent_hash = ?`,
    )
    .run(
      HAS_ROMANIAN_OUTCOMES.has(outcome) ? 1 : 0,
      source,
      detail,
      outcome === "audio_already_romanian" ? 1 : 0,
      torrentHash,
    );
}

// Apelat după "Șterge subtitrare" (Lansări/Bibliotecă) — subtitrarea .srt
// sidecar a fost ștearsă de pe disk, deci starea redevine "fără RO".
export function clearMediaSubtitleStatus(torrentHash: string): void {
  getDb()
    .prepare(
      `UPDATE media SET has_romanian_subtitle = 0, subtitle_source = NULL, subtitle_detail = NULL,
       subtitle_checked_at = datetime('now'), updated_at = datetime('now')
       WHERE torrent_hash = ?`,
    )
    .run(torrentHash);
}

// Apelat când torrentul a ajuns la 100% (pollUntilComplete) — marchează
// finalizarea.
//
// Întoarce `true` doar pentru apelantul care a marcat efectiv finalizarea.
// Clauza `completed_at IS NULL` face din UPDATE-ul ăsta o gardă atomică: dacă
// două bucle de polling ajung simultan la 100% (una pornită la descărcare,
// alta reluată după restart), a doua vede changes = 0 și nu mai trimite a
// doua notificare, nu mai rulează încă o dată pipeline-ul de subtitrări.
// Înainte, garda stătea pe `downloads.id` (id-ul de torrent Filelist); pe
// hash e mai corectă pentru pachetele de sezon, unde un singur torrent are
// zeci de rânduri `media`, dar o singură finalizare.
export function markMediaCompleted(torrentHash: string): boolean {
  const res = getDb()
    .prepare(
      `UPDATE media SET completed_at = datetime('now'), updated_at = datetime('now')
       WHERE torrent_hash = ? AND completed_at IS NULL`,
    )
    .run(torrentHash);
  return Number(res.changes ?? 0) > 0;
}

export interface UnfinishedTorrent {
  torrentHash: string;
  torrentName: string;
  category: number | null;
  // Fallback pentru cazul în care categoria Filelist lipsește (titluri
  // adăugate altfel decât prin fluxul standard): media_type e mereu populat.
  isMovie: boolean;
  imdbId: string | null;
}

// Descărcările încă neterminate, pentru reluarea polling-ului după un restart
// (server/plugins/filelist-resume.ts). Un rând per torrent, nu per episod —
// un pachet de sezon cu 12 episoade are 12 rânduri `media` cu același hash,
// dar are nevoie de o singură buclă de polling.
//
// Cele două filtre suplimentare nu sunt cosmetice:
//
// `plex_rating_key IS NULL` — backfill-ul din Plex (2026-08-15) a lăsat 77 de
// rânduri cu hash și fără `completed_at`, deși titlurile erau demult pe disc
// și indexate. Fără filtru, fiecare pornire ar fi lansat 33 de bucle de
// polling pentru torrente care nu mai există în qBittorrent.
//
// `added_at` în ultimele 48h — exact fereastra după care `pollUntilComplete`
// renunță oricum. Un torrent abandonat acum o lună n-are ce relua.
export function listUnfinishedTorrents(): UnfinishedTorrent[] {
  const rows = getDb()
    .prepare(
      `SELECT torrent_hash, MIN(torrent_name) AS torrent_name,
              MIN(category) AS category, MIN(imdb_id) AS imdb_id,
              MAX(media_type = 'movie') AS is_movie
         FROM media
        WHERE completed_at IS NULL
          AND torrent_hash IS NOT NULL
          AND plex_rating_key IS NULL
          AND added_at > datetime('now', '-48 hours')
        GROUP BY torrent_hash`,
    )
    .all() as unknown as Array<{
    torrent_hash: string;
    torrent_name: string | null;
    category: number | null;
    imdb_id: string | null;
    is_movie: number;
  }>;

  return rows.map((r) => ({
    torrentHash: r.torrent_hash,
    torrentName: r.torrent_name ?? r.torrent_hash,
    category: r.category,
    isMovie: !!r.is_movie,
    imdbId: r.imdb_id,
  }));
}

// Titlu + poster deja cunoscute în `media` pentru un torrent — folosit de
// notificările de descărcare (download.ts), ca să NU-și mai recalculeze
// singure titlul/poster-ul printr-un lookup TMDB live paralel (sursă de
// adevăr unică: ce s-a scris deja în `media` la adăugare, vezi
// upsertMediaEntry) — TMDB live rămâne doar fallback, pentru torrente fără
// nicio legătură media (autoResolveManualMedia eșuat).
export function getMediaDisplayByTorrentHash(torrentHash: string): {
  title: string;
  posterPath: string | null;
  season: number | null;
  episode: number | null;
  isSeasonPack: boolean;
} | null {
  const row = getDb()
    .prepare(
      // ORDER BY, nu doar LIMIT 1: cât timp un pachet de sezon se desface,
      // rândul-pachet coexistă cu episoadele extrase din el, toate pe același
      // hash. Etichetăm o acțiune pe întreg torrentul cu "Sezonul N", deci
      // rândul-pachet are prioritate — fără ordonare, alegerea depindea de
      // ordinea implicită de scanare și notificarea putea numi un episod
      // oarecare din pachet.
      `SELECT title, poster_path, season, episode, is_season_pack FROM media
         WHERE torrent_hash = ? ORDER BY is_season_pack DESC, id LIMIT 1`,
    )
    .get(torrentHash) as
    | {
        title: string;
        poster_path: string | null;
        season: number | null;
        episode: number | null;
        is_season_pack: number;
      }
    | undefined;
  if (!row) return null;
  return {
    title: row.title,
    posterPath: row.poster_path,
    season: row.season,
    episode: row.episode,
    isSeasonPack: !!row.is_season_pack,
  };
}

// Apelat la "Șterge titlul complet" (Lansări/Bibliotecă) — elimină rândul
// din `media`, ca torrentul șters din downloads/qBittorrent/disk să dispară
// și de-aici.
export function deleteMediaByTorrentHash(torrentHash: string): void {
  getDb().prepare("DELETE FROM media WHERE torrent_hash = ?").run(torrentHash);
}

// Leagă un rând `media` de item-ul lui real din Plex — ratingKey, calitate,
// durată. Apelat cu reîncercări (pollUntilComplete), pentru că scanarea Plex
// e asincronă: la refreshPlexLibrary, fișierul poate să nu fie încă indexat.
// Sare peste pachetele de sezon (episode NULL) — un singur rând `media` nu
// poate reprezenta N ratingKey-uri diferite, câte unul per episod din pachet.
// Întoarce true dacă a găsit și a scris legătura, ca apelantul să știe când
// să oprească reîncercările.
export async function resolveMediaPlexLinkByTorrentHash(torrentHash: string): Promise<boolean> {
  const db = getDb();
  // Un hash poate acoperi mai multe rânduri: pachetul de sezon în curs de
  // desfacere coexistă cu episoadele deja extrase din el (vezi
  // resolveSeasonPackPlexLinks). Luăm întâi un rând NElegat — altfel
  // rezultatul ar depinde de ordinea implicită de scanare a tabelei, iar un
  // rând deja legat ar masca pachetul care încă are treabă.
  const row = db
    .prepare(
      `SELECT id, media_type, title, original_title, season, episode, plex_rating_key,
              torrent_name
         FROM media WHERE torrent_hash = ?
        ORDER BY plex_rating_key IS NOT NULL, id LIMIT 1`,
    )
    .get(torrentHash) as
    | {
        id: number;
        media_type: string;
        title: string;
        original_title: string | null;
        season: number | null;
        episode: number | null;
        plex_rating_key: string | null;
        torrent_name: string | null;
      }
    | undefined;
  if (!row) return false;
  // Nu mai există niciun rând nelegat pentru hash-ul ăsta — treaba e gata,
  // apelantul poate opri reîncercările.
  if (row.plex_rating_key) return true;

  const { findPlexMovieLink, findPlexEpisodeLink } = await import("../services/plex-library");
  const link =
    row.media_type === "movie"
      ? // Calea reală de pe disk, ca legarea să ia calitatea versiunii corecte
        // când filmul există în Plex în mai multe versiuni.
        await findPlexMovieLink(
          row.title,
          row.original_title ?? row.title,
          await contentPathForTorrent(torrentHash),
          row.torrent_name,
        )
      : row.media_type === "episode" && row.season != null && row.episode != null
        ? await findPlexEpisodeLink(row.title, row.season, row.episode)
        : null;
  if (!link) return false;

  db.prepare(
    `UPDATE media SET plex_rating_key = ?, quality = ?, duration_ms = ?, plex_added_at = ?,
     updated_at = datetime('now') WHERE id = ?`,
  ).run(link.ratingKey, link.quality, link.durationMs, link.addedAt, row.id);
  return true;
}

// Calea de pe disk a unui torrent, din qBittorrent. Izolată aici fiindcă o
// folosesc și legarea, și reparația de mai jos.
async function contentPathForTorrent(torrentHash: string): Promise<string | null> {
  const url = (process.env.QBIT_URL ?? "http://192.168.1.192:25556").replace(/\/$/, "");
  const user = process.env.QBIT_USERNAME;
  const pass = process.env.QBIT_PASSWORD;
  if (!user || !pass) return null;
  const { qbitContentPath } = await import("../qbit-client");
  return qbitContentPath(url, torrentHash, user, pass);
}

// Ce știe Plex despre versiunea NOASTRĂ a unui rând deja legat.
//
// Calea de pe disk se cere din qBittorrent doar când item-ul chiar are mai
// multe versiuni — altfel n-avem ce distinge, iar cererea ar fi degeaba
// (cazul covârșitor: un film, un fișier).
async function versionLinkForRow(
  item: PlexMetadataItem,
  row: { torrent_hash: string | null; torrent_name: string | null },
): Promise<PlexItemLink | null> {
  const { versionLinkFromItem } = await import("../services/plex-library");
  const hasVersions = (item.Media ?? []).length > 1;
  const contentPath =
    hasVersions && row.torrent_hash ? await contentPathForTorrent(row.torrent_hash) : null;
  return versionLinkFromItem(item, contentPath, row.torrent_name);
}

// Repară filmele legate corect de Plex, dar rămase fără calitate.
//
// Se întâmplă când filmul are mai multe versiuni în Plex (4K HDR + 1080p) și
// nu am putut decide, la momentul legării, care versiune e a noastră — caz în
// care nu ghicim, lăsăm calitatea goală. Reconcilierul obișnuit nu le vede:
// el caută rânduri cu `plex_rating_key` NULL, iar astea SUNT legate.
//
// Reîncercarea are rost fiindcă motivul obișnuit al eșecului e trecător:
// torrentul încă nu apăruse în qBittorrent, sau Plex nu terminase de analizat
// a doua versiune. Aceeași fereastră ca restul reconcilierii — peste ea, fie
// fișierul nu mai e, fie e nevoie de intervenție.
export async function repairLinkedMovieQuality(maxAgeHours: number): Promise<number> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, title, plex_rating_key, torrent_hash, torrent_name
         FROM media
        WHERE media_type = 'movie'
          AND plex_rating_key IS NOT NULL
          AND quality IS NULL
          AND torrent_hash IS NOT NULL
          AND completed_at IS NOT NULL
          AND completed_at > datetime('now', ?)`,
    )
    .all(`-${maxAgeHours} hours`) as Array<{
    id: number;
    title: string;
    plex_rating_key: string;
    torrent_hash: string;
    torrent_name: string | null;
  }>;
  if (rows.length === 0) return 0;

  // Direct pe ratingKey-ul cunoscut, nu printr-o căutare după titlu: rândul e
  // deja legat, deci item-ul lui e știut. O cerere în loc de două, și fără
  // riscul ca titlul să nimerească alt film.
  const { fetchPlexItemVersions } = await import("../services/plex-library");
  // COALESCE, nu atribuire directă: pentru un item cu mai multe versiuni,
  // `addedAt` vine null (nu putem ști a cui e data — vezi PlexItemLink). Dacă
  // și rândul VECHI al aceluiași film ar trece pe-aici, o atribuire directă
  // i-ar șterge data pe care o are pe bună dreptate. Completăm ce lipsește,
  // nu ștergem ce există.
  const update = db.prepare(
    `UPDATE media SET quality = ?, duration_ms = ?,
       plex_added_at = COALESCE(?, plex_added_at),
       updated_at = datetime('now') WHERE id = ?`,
  );
  let repaired = 0;
  for (const row of rows) {
    const item = await fetchPlexItemVersions(row.plex_rating_key);
    const link = item ? await versionLinkForRow(item, row) : null;
    if (!link?.quality) continue;
    update.run(link.quality, link.durationMs, link.addedAt, row.id);
    repaired++;
    console.log(`[media] Calitate completată pentru "${row.title}": ${link.quality}`);
  }
  return repaired;
}

interface SeasonPackMediaRow {
  id: number;
  media_type: string;
  parent_id: number | null;
  imdb_id: string | null;
  tmdb_id: number | null;
  title: string;
  original_title: string | null;
  literal_title: string | null;
  year: number | null;
  season: number | null;
  episode: number | null;
  overview_ro: string | null;
  genres: string;
  poster_path: string | null;
  tv_status: string | null;
  torrent_name: string | null;
  torrent_hash: string | null;
  category: number | null;
  category_name: string | null;
  size: number;
  freeleech: number;
  internal: number;
  save_path: string | null;
  is_season_pack: number;
  added_via: string;
  requested_by_user_id: number | null;
  completed_at: string | null;
  has_romanian_subtitle: number;
  has_romanian_audio: number;
  subtitle_source: string | null;
  subtitle_detail: string | null;
  subtitle_checked_at: string | null;
}

// Câte episoade difuzate are sezonul, după TMDB — reperul față de care
// decidem dacă Plex a terminat de indexat pachetul. Întoarce null când nu
// putem ști (fără tmdb_id, sau TMDB indisponibil); apelantul tratează
// necunoscutul ca "acceptă ce e", nu ca "mai așteaptă la nesfârșit".
async function airedEpisodeCountForSeason(
  tmdbId: number | null,
  season: number,
): Promise<number | null> {
  if (tmdbId == null) return null;
  const { getTmdbAllSeasonsInternal } = await import("../tmdb/tmdb.functions");
  const schema = await getTmdbAllSeasonsInternal(tmdbId, [season]).catch(() => []);
  const found = schema.find((s) => s.seasonNumber === season);
  if (!found) return null;
  const aired = found.episodes.filter((e) => e.aired).length;
  return aired > 0 ? aired : null;
}

// Cât mai așteptăm ca Plex să termine de indexat un pachet, înainte să
// acceptăm ca final ce a indexat până acum. Peste prag, diferența nu mai e
// "Plex încă scanează", ci un pachet chiar incomplet (uploader care a pus 8
// din 10 episoade) — iar acolo a insista la nesfârșit ar lăsa rândul blocat
// pe "Se procesează în Plex" până la expirarea ferestrei reconcilierului.
const SEASON_PACK_INDEX_GRACE_MS = 2 * 60 * 60 * 1000;

// Echivalentul lui resolveMediaPlexLinkByTorrentHash, pentru pachete de
// sezon (rândul are episode NULL, is_season_pack = 1 — vezi upsertMediaEntry,
// apelat o singură dată per torrent, indiferent dacă e episod sau pachet).
// Un singur rând `media` nu poate purta N ratingKey-uri, deci rândul-pachet
// rămânea "downloading" definitiv (resolveMediaPlexLinkByTorrentHash îl sare
// mereu). Aici desfacem pachetul: pentru fiecare episod găsit deja în Plex,
// clonăm rândul-pachet într-un rând de episod normal (sau actualizăm unul
// deja existent, dacă episodul fusese descărcat separat înainte), apoi ștergem
// placeholder-ul de pachet.
//
// Desfacerea e în două trepte, fiindcă indexarea Plex e asincronă ȘI
// per-fișier: findPlexSeasonLinks întoarce ce există în acel moment, adică
// frecvent 2-3 episoade dintr-un pachet de 10. Varianta veche ștergea rândul-
// pachet la primul episod găsit și întorcea true, ceea ce oprea definitiv
// reîncercările (pollUntilComplete face break, iar reconcilierul caută doar
// rânduri cu plex_rating_key NULL). Restul episoadelor rămâneau pe disc și în
// Plex, dar fără rând în `media`: invizibile în Bibliotecă și raportate ca
// "lipsă" de show-watch, care le redescărca individual.
//
// Acum sincronizăm ce s-a găsit la fiecare trecere (idempotent — findExisting
// le regăsește și le actualizează), dar ștergem rândul-pachet și raportăm
// succes doar când sezonul e acoperit complet, sau când a trecut fereastra de
// grație. Până atunci întoarcem false, deci apelantul reîncearcă.
export async function resolveSeasonPackPlexLinks(torrentHash: string): Promise<boolean> {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM media WHERE torrent_hash = ? AND media_type = 'episode'
       AND episode IS NULL AND is_season_pack = 1`,
    )
    .get(torrentHash) as SeasonPackMediaRow | undefined;
  if (!row || row.season == null) return false;

  const { findPlexSeasonLinks } = await import("../services/plex-library");
  const links = await findPlexSeasonLinks(row.title, row.season);
  if (!links || links.size === 0) return false;

  const expected = await airedEpisodeCountForSeason(row.tmdb_id, row.season);
  // completed_at e în formatul SQLite ("2026-09-06 07:54:16", UTC) — același
  // tratament ca în plex-browse.ts la conversia spre timestamp.
  const completedMs = row.completed_at
    ? new Date(`${row.completed_at.replace(" ", "T")}Z`).getTime()
    : null;
  const graceExpired = completedMs == null || Date.now() - completedMs > SEASON_PACK_INDEX_GRACE_MS;
  const isComplete = expected == null || links.size >= expected || graceExpired;

  const insert = db.prepare(
    `INSERT INTO media (
      media_type, parent_id, imdb_id, tmdb_id, title, original_title, literal_title,
      year, season, episode, overview_ro, genres, poster_path, tv_status,
      plex_rating_key, plex_added_at, torrent_name, torrent_hash, category, category_name,
      size, freeleech, internal, save_path, is_season_pack, added_via, requested_by_user_id,
      completed_at, has_romanian_subtitle, has_romanian_audio, subtitle_source,
      subtitle_detail, subtitle_checked_at, quality, duration_ms
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const updateExisting = db.prepare(
    `UPDATE media SET plex_rating_key = ?, quality = ?, duration_ms = ?, plex_added_at = ?,
     updated_at = datetime('now') WHERE id = ?`,
  );
  // `parent_id IS ?`, nu `parent_id = ?`: pentru un pachet fără părinte
  // rezolvat, `= NULL` nu se potrivește niciodată cu sine, deci am fi
  // reinserat la fiecare trecere rânduri pentru aceleași episoade — până la
  // prima coliziune pe indexul unic de plex_rating_key. Același idiom ca în
  // findExistingDownloadRow.
  const findExisting = db.prepare(
    `SELECT id FROM media WHERE parent_id IS ? AND season = ? AND episode = ? AND id != ?`,
  );
  // Plasă după cheia reală de unicitate: `plex_rating_key` are index UNIQUE
  // (vezi db.ts), iar un episod poate exista deja sub alt părinte decât cel al
  // pachetului — descărcat separat înainte, când placeholder-ul serialului
  // încă nu era rezolvat. Fără verificarea asta, INSERT-ul ar arunca o
  // eroare de constrângere care ar rupe bucla la mijloc și ar lăsa restul
  // episoadelor nelegate. Contează mai mult acum, când desfacerea parțială
  // repetă trecerile până la acoperirea completă.
  const findByRatingKey = db.prepare(`SELECT id FROM media WHERE plex_rating_key = ?`);

  for (const [episodeNum, link] of links) {
    const existing = (findExisting.get(row.parent_id, row.season, episodeNum, row.id) ??
      findByRatingKey.get(link.ratingKey)) as { id: number } | undefined;
    if (existing) {
      updateExisting.run(link.ratingKey, link.quality, link.durationMs, link.addedAt, existing.id);
      continue;
    }
    insert.run(
      row.media_type,
      row.parent_id,
      row.imdb_id,
      row.tmdb_id,
      row.title,
      row.original_title,
      row.literal_title,
      row.year,
      row.season,
      episodeNum,
      row.overview_ro,
      row.genres,
      row.poster_path,
      row.tv_status,
      link.ratingKey,
      link.addedAt,
      row.torrent_name,
      row.torrent_hash,
      row.category,
      row.category_name,
      row.size,
      row.freeleech,
      row.internal,
      row.save_path,
      // 0, nu row.is_season_pack: rândul creat aici e un episod concret, cu
      // numărul lui — a moștenit 1 de pe placeholder-ul de pachet, ceea ce
      // însemna un rând care se declara și pachet, și episod (`seasonEpisodeLabel`
      // din notifications.ts alege "Sezonul N" pe baza flagului, ignorând
      // episodul). Proveniența pachetului rămâne vizibilă prin torrent_name.
      0,
      row.added_via,
      row.requested_by_user_id,
      row.completed_at,
      row.has_romanian_subtitle,
      row.has_romanian_audio,
      row.subtitle_source,
      row.subtitle_detail,
      row.subtitle_checked_at,
      link.quality,
      link.durationMs,
    );
  }

  if (!isComplete) {
    // Episoadele găsite până acum au deja rânduri proprii (create/actualizate
    // mai sus). Pachetul rămâne ca marcaj de "încă se indexează": îl ține pe
    // show-watch să nu descarce individual episoadele care oricum vin din el
    // (pendingPackSeasons), iar reconcilierul îl reia peste 10 minute.
    console.log(
      `[media] Pachet sezon ${row.season} "${row.title}": ${links.size}/${expected} episoade indexate de Plex — reiau`,
    );
    return false;
  }

  db.prepare("DELETE FROM media WHERE id = ?").run(row.id);
  return true;
}

// ---------------------------------------------------------------------------
// Recalcularea etichetelor de calitate, o singură dată.
//
// Odată ce „1080p HDR" a devenit o categorie de sine stătătoare, rândurile
// scrise înainte au rămas cu eticheta veche: un fișier HDR salvat ca „1080p"
// simplu. Nu e doar cosmetic — wizard-ul decide pe baza etichetei, deci ți-ar
// fi oferit „upgrade la 1080p HDR" pentru un film care E deja HDR.
//
// Recalculăm din Plex, nu din numele torrentului: Plex știe ce e în fișier
// (colorTrc, DOVIPresent), numele minte uneori. O cerere per item Plex, nu per
// rând — mai multe rânduri pot împărți același item (versiunile aceluiași
// film).
// ---------------------------------------------------------------------------

const REDETECT_JOB = "redetect-qualities-1080p-hdr";

export async function redetectQualitiesOnce(): Promise<number> {
  const db = getDb();
  const done = db.prepare("SELECT 1 FROM one_time_jobs WHERE name = ?").get(REDETECT_JOB);
  if (done) return 0;

  const rows = db
    .prepare(
      `SELECT id, plex_rating_key, quality, torrent_hash, torrent_name
         FROM media
        WHERE plex_rating_key IS NOT NULL`,
    )
    .all() as Array<{
    id: number;
    plex_rating_key: string;
    quality: string | null;
    torrent_hash: string | null;
    torrent_name: string | null;
  }>;

  const { fetchPlexItemVersions } = await import("../services/plex-library");
  // Doar `quality`, nu și datele de timp: `plex_added_at` s-a corectat o dată
  // la migrarea v28, care a păstrat data pe cel mai vechi rând al fiecărui
  // item. Rescriind-o aici după aceeași regulă ca la legare, versiunea veche
  // a unui film cu două versiuni ar rămâne fără dată — exact ce v28 a evitat.
  const update = db.prepare(
    "UPDATE media SET quality = ?, updated_at = datetime('now') WHERE id = ?",
  );

  // Cache per ratingKey: versiunile aceluiași film sunt rânduri diferite, dar
  // un singur item Plex.
  const itemCache = new Map<string, Awaited<ReturnType<typeof fetchPlexItemVersions>>>();
  let changed = 0;
  let itemsRead = 0;

  for (const row of rows) {
    let item = itemCache.get(row.plex_rating_key);
    if (item === undefined) {
      item = await fetchPlexItemVersions(row.plex_rating_key);
      itemCache.set(row.plex_rating_key, item);
      if (item) itemsRead++;
    }
    if (!item) continue;

    const quality = (await versionLinkForRow(item, row))?.quality ?? null;
    // Nu ștergem o etichetă existentă când nu putem decide acum: mai bine una
    // veche decât niciuna.
    if (!quality || quality === row.quality) continue;
    update.run(quality, row.id);
    changed++;
    console.log(`[media] Calitate recalculată (#${row.id}): ${row.quality} → ${quality}`);
  }

  // Nu marcăm jobul ca făcut dacă Plex n-a răspuns pentru NICIUN rând: ar
  // însemna să declarăm terminată o trecere care n-a citit nimic, iar
  // etichetele vechi ar rămâne greșite pe veci. Plex picat la pornire e exact
  // scenariul (serviciul nostru repornește la fiecare deploy) — atunci lăsăm
  // jobul nemarcat și se reia la următoarea pornire.
  if (rows.length > 0 && itemsRead === 0) {
    console.warn(
      "[media] Recalcularea calităților: Plex n-a răspuns pentru niciun titlu — reiau la următoarea pornire",
    );
    return 0;
  }

  db.prepare("INSERT INTO one_time_jobs (name, done_at) VALUES (?, datetime('now'))").run(
    REDETECT_JOB,
  );
  console.log(`[media] Recalculare calități încheiată: ${changed} din ${rows.length} corectate`);
  return changed;
}
