// ---------------------------------------------------------------------------
// Sursă unică pentru datele unui titlu media — vezi schema `media` din db.ts.
// Populată deocamdată doar din wizard-ul de adăugare (AddMediaWizard), care
// are deja toate metadatele TMDB la momentul descărcării; căutarea manuală
// din Lansări și auto-download-ul din pinned-watcher rămân neatinse (folosesc
// în continuare doar `downloads`), urmează într-o rundă viitoare.
// ---------------------------------------------------------------------------

import { getDb } from "./db";

export type MediaType = "movie" | "tv_show" | "episode";
export type AddedVia = "wizard" | "manual" | "auto";

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

// Creează (sau actualizează, dacă există deja) rândul-părinte al serialului —
// un singur rând per imdb_id, doar cu metadate TMDB, fără proveniență de
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
}): number | null {
  const db = getDb();
  if (input.imdbId) {
    const existing = db
      .prepare("SELECT id FROM media WHERE media_type = 'tv_show' AND imdb_id = ?")
      .get(input.imdbId) as { id: number } | undefined;
    if (existing) {
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
        existing.id,
      );
      return existing.id;
    }
  }
  const res = db
    .prepare(
      `INSERT INTO media (
        media_type, imdb_id, tmdb_id, title, original_title, literal_title, year,
        overview_ro, genres, poster_path, tv_status, added_via
      ) VALUES ('tv_show', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'wizard')`,
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
