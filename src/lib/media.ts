// ---------------------------------------------------------------------------
// Sursă unică pentru datele unui titlu media — vezi schema `media` din db.ts.
// Populată de toate cele 4 căi de descărcare (wizard, Lansări manual,
// auto-download pinned-watcher, căutare manuală Filelist cu rezolvare TMDB
// best-effort) — vezi upsertMediaEntry — plus, pentru restul bibliotecii
// deja existente în Plex înainte de acest sistem, de backfill-ul din
// media-backfill.ts — vezi upsertMediaEntryFromPlex.
// ---------------------------------------------------------------------------

import { getDb } from "./db";

export type MediaType = "movie" | "tv_show" | "episode";
export type AddedVia = "wizard" | "manual" | "auto" | "backfill";

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

// Găsește rândul-părinte deja existent al unui serial — prioritar după
// tmdb_id (mereu prezent odată rezolvat prin TMDB, spre deosebire de
// imdb_id, absent pentru multe seriale — reality show-uri, producții locale
// etc). SQL `imdb_id = NULL` nu se potrivește niciodată cu sine (semantica
// NULL), deci un lookup doar pe imdb_id ar crea un rând nou de fiecare dată
// pentru un serial fără imdb_id — exact bug-ul reprodus la primul backfill
// (opt rânduri "Elita" în loc de unul). Cade pe imdb_id, apoi pe titlu exact
// (fără niciun id cunoscut), ca ultimă plasă de siguranță.
function findExistingShowId(input: {
  imdbId: string | null;
  tmdbId: number | null;
  title: string;
}): number | null {
  const db = getDb();
  if (input.tmdbId != null) {
    const row = db
      .prepare("SELECT id FROM media WHERE media_type = 'tv_show' AND tmdb_id = ?")
      .get(input.tmdbId) as { id: number } | undefined;
    if (row) return row.id;
  }
  if (input.imdbId) {
    const row = db
      .prepare("SELECT id FROM media WHERE media_type = 'tv_show' AND imdb_id = ?")
      .get(input.imdbId) as { id: number } | undefined;
    if (row) return row.id;
  }
  const row = db
    .prepare(
      "SELECT id FROM media WHERE media_type = 'tv_show' AND tmdb_id IS NULL AND imdb_id IS NULL AND title = ?",
    )
    .get(input.title) as { id: number } | undefined;
  return row?.id ?? null;
}

// Creează (sau actualizează, dacă există deja) rândul-părinte al serialului —
// un singur rând per serial, doar cu metadate TMDB, fără proveniență de
// torrent (aia aparține fiecărui episod în parte).
function ensureShowRow(input: {
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
}): number | null {
  const db = getDb();
  const existingId = findExistingShowId(input);
  if (existingId != null) {
    db.prepare(
      `UPDATE media SET title = ?, original_title = ?, literal_title = ?, year = ?,
       overview_ro = ?, genres = ?, poster_path = ?, tv_status = ?, tmdb_id = ?,
       updated_at = datetime('now') WHERE id = ?`,
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
      existingId,
    );
    return existingId;
  }
  const res = db
    .prepare(
      `INSERT INTO media (
        media_type, imdb_id, tmdb_id, title, original_title, literal_title, year,
        overview_ro, genres, poster_path, tv_status, added_via
      ) VALUES ('tv_show', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
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
    );
  return Number(res.lastInsertRowid);
}

export function upsertMediaEntry(input: UpsertMediaEntryInput): number {
  const db = getDb();

  const parentId = input.mediaType === "episode" ? ensureShowRow(input) : null;

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
// Backfill — titluri deja existente în Plex înainte de acest sistem, fără
// nicio descărcare/torrent asociat(ă) în aplicație. Rândul se leagă direct
// de ratingKey-ul Plex (deja cunoscut, spre deosebire de upsertMediaEntry,
// unde legătura se rezolvă abia ulterior, prin resolveMediaPlexLinkByTorrentHash).
// ---------------------------------------------------------------------------

export interface UpsertMediaFromPlexInput {
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
  plexRatingKey: string;
  plexAddedAt?: number | null;
  quality?: string | null;
  durationMs?: number | null;
  hasRomanianSubtitle?: boolean;
}

export function upsertMediaEntryFromPlex(input: UpsertMediaFromPlexInput): number {
  const db = getDb();

  const parentId =
    input.mediaType === "episode" ? ensureShowRow({ ...input, addedVia: "backfill" }) : null;

  const res = db
    .prepare(
      `INSERT INTO media (
        media_type, parent_id, imdb_id, tmdb_id, title, original_title, literal_title,
        year, season, episode, overview_ro, genres, poster_path, tv_status,
        plex_rating_key, plex_added_at, quality, duration_ms, has_romanian_subtitle, added_via
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'backfill')`,
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
      input.plexRatingKey,
      input.plexAddedAt ?? null,
      input.quality ?? null,
      input.durationMs ?? null,
      input.hasRomanianSubtitle ? 1 : 0,
    );
  return Number(res.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// Sincronizare ulterioară — actualizează un rând deja existent (creat de
// wizard), potrivit după torrent_hash (unic). Dacă niciun rând `media` nu
// corespunde (torrent pornit din afara wizard-ului), UPDATE/DELETE-ul nu
// afectează nimic — nu creăm rânduri noi din aceste căi, doar sincronizăm
// unde există deja unul.
// ---------------------------------------------------------------------------

export type SubtitleOutcomeKind = "romanian_ok" | "no_romanian" | "unknown";

// Sursa subtitrării, derivată din outcome-ul ensureRomanianSubtitle
// (subtitles.ts) — vezi SubtitleOutcome acolo pentru lista completă.
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
): void {
  getDb()
    .prepare(
      `UPDATE media SET has_romanian_subtitle = ?, subtitle_source = ?, subtitle_detail = ?,
       subtitle_checked_at = datetime('now'), updated_at = datetime('now')
       WHERE torrent_hash = ?`,
    )
    .run(
      HAS_ROMANIAN_OUTCOMES.has(outcome) ? 1 : 0,
      SUBTITLE_SOURCE_BY_OUTCOME[outcome] ?? null,
      detail,
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
// finalizarea, exact ca downloads.completed_at.
export function markMediaCompleted(torrentHash: string): void {
  getDb()
    .prepare(
      `UPDATE media SET completed_at = datetime('now'), updated_at = datetime('now')
       WHERE torrent_hash = ? AND completed_at IS NULL`,
    )
    .run(torrentHash);
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
  const row = db
    .prepare(
      "SELECT id, media_type, title, original_title, season, episode FROM media WHERE torrent_hash = ?",
    )
    .get(torrentHash) as
    | {
        id: number;
        media_type: string;
        title: string;
        original_title: string | null;
        season: number | null;
        episode: number | null;
      }
    | undefined;
  if (!row) return false;

  const { findPlexMovieLink, findPlexEpisodeLink } = await import("./services/plex-library");
  const link =
    row.media_type === "movie"
      ? await findPlexMovieLink(row.title, row.original_title ?? row.title)
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
