// ---------------------------------------------------------------------------
// Sursă unică pentru datele unui titlu media — vezi schema `media` din db.ts.
// Populată de toate cele 4 căi de descărcare (wizard, Lansări manual,
// auto-download pinned-watcher, căutare manuală Filelist cu rezolvare TMDB
// best-effort) — vezi upsertMediaEntry — plus, pentru restul bibliotecii
// deja existente în Plex înainte de acest sistem, de backfill-ul din
// media-backfill.ts — vezi upsertMediaEntryFromPlex.
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";
import { getDb } from "./db";

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

// Creează (sau actualizează, dacă există deja) un rând `media` fără
// proveniență de torrent — rândul-părinte al unui serial (folosit intern la
// fiecare episod inserat) sau un rând de sine stătător pentru un film,
// creat direct la căutare/fixare, înainte de orice descărcare (vezi
// ensureMediaEntryForSearch mai jos). Actualizarea nu atinge niciodată
// coloanele de proveniență torrent — cele aparțin doar rândurilor de episod/
// film create la descărcare (upsertMediaEntry).
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

// Apelat direct din wizard (Acasă), imediat ce un titlu e identificat prin
// TMDB — indiferent dacă userul ajunge să-l descarce sau doar îl fixează
// pentru urmărire. Pentru seriale, scrie doar rândul-părinte (episoadele se
// adaugă separat, la descărcare); pentru filme, un rând de sine stătător,
// pe care upsertMediaEntry îl va completa ulterior cu proveniența torrent-
// ului dacă userul chiar descarcă.
export const ensureMediaEntryForSearch = createServerFn({ method: "POST" })
  .validator(
    (data: {
      mediaType: "movie" | "tv";
      imdbId: string | null;
      tmdbId: number;
      title: string;
      originalTitle?: string | null;
      literalTitle?: string | null;
      year?: number | null;
      overviewRo?: string | null;
      genres?: string[];
      posterPath?: string | null;
      tvStatus?: string | null;
    }) => data,
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const { requireAuth } = await import("./admin.server");
    const session = await requireAuth();
    try {
      ensureMediaPlaceholder(data.mediaType === "movie" ? "movie" : "tv_show", {
        ...data,
        addedVia: "wizard",
        requestedByUserId: session.data.userId ?? null,
      });
      return { ok: true };
    } catch (e) {
      console.warn("[media] ensureMediaEntryForSearch eșuat:", e);
      return { ok: false };
    }
  });

export function upsertMediaEntry(input: UpsertMediaEntryInput): number {
  const db = getDb();

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
  // Rezolvat retroactiv, potrivind calea fișierului din Plex cu lista de
  // torrente din qBittorrent (vezi media-backfill.ts) — dacă torrentul încă
  // seed-uiește, titlul backfill-uit devine gestionabil complet (corectare/
  // ștergere subtitrare, ștergere titlu), nu doar afișat.
  torrentHash?: string | null;
  torrentName?: string | null;
}

export function upsertMediaEntryFromPlex(input: UpsertMediaFromPlexInput): number {
  const db = getDb();

  const parentId =
    input.mediaType === "episode"
      ? ensureMediaPlaceholder("tv_show", { ...input, addedVia: "backfill" })
      : null;

  const res = db
    .prepare(
      `INSERT INTO media (
        media_type, parent_id, imdb_id, tmdb_id, title, original_title, literal_title,
        year, season, episode, overview_ro, genres, poster_path, tv_status,
        plex_rating_key, plex_added_at, quality, duration_ms, has_romanian_subtitle,
        torrent_hash, torrent_name, added_via
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'backfill')`,
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
      input.torrentHash ?? null,
      input.torrentName ?? null,
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
