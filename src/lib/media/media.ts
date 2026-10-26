// Sursă unică pentru datele unui titlu (schema `media` în db.ts), populată de
// căile de descărcare — vezi upsertMediaEntry.

import { getDb } from "../db";
// Doar tipuri: `import type` nu trage modulele Plex în graf.
import type {
  FileSubtitleReport,
  SubtitleFileReport,
  SubtitleRejectionReport,
  SubtitleSource,
} from "../filelist/subtitle-outcomes";
import type { PlexItemLink } from "../services/plex-library";
import type { PlexMetadataItem } from "../services/plex-shared";

// "auto" = pornit de urmărire, fără intervenție umană — se deosebește în
// notificări.
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
  filelistId?: number | null;
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

// Rândul fără torrent al unui titlu (părintele unui serial, placeholder de
// film) — după tmdb_id, apoi imdb_id, apoi titlu exact. Nu doar după imdb_id:
// `imdb_id = NULL` nu se potrivește niciodată, deci un titlu fără imdb_id
// primea rând nou de fiecare dată (opt rânduri „Elita” la primul backfill).
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
  // Titlul exact doar când input-ul n-are niciun id — altfel un titlu nou s-ar
  // putea lipi de placeholder-ul altui titlu cu același nume (remake-uri).
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

// Creează sau actualizează rândul-părinte al unui serial, la fiecare episod
// inserat. Nu atinge coloanele de torrent — sunt doar ale episoadelor/filmelor.
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

// Titluri existente în bibliotecă, pentru descărcarea manuală de pe Filelist:
// adminul leagă explicit torrentul de titlul corect, în loc ca rezolvarea
// automată să ghicească după IMDb-ul torrentului — greșit la spin-off-uri și
// reunion-uri indexate sub ID-ul altei producții.
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

// Ce e deja în curs de descărcare pentru un titlu — wizard-ul blochează
// pornirea lui a doua oară.
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

// Rândul existent pentru EXACT același torrent (hash + sezon/episod) — două
// cereri aproape simultane ar crea altfel două rânduri „în curs”.
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
        torrent_name, torrent_hash, filelist_id, category, category_name, size, freeleech,
        internal, save_path, is_season_pack, added_via, requested_by_user_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      input.filelistId ?? null,
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
// Sincronizare ulterioară, pe torrent_hash (un pachet de sezon are mai multe
// rânduri pe același hash). Fără rând potrivit nu se creează nimic.
// ---------------------------------------------------------------------------

// Sursa subtitrării, din outcome-ul ensureRomanianSubtitle (subtitles.ts). La
// descărcări sursa (OpenSubtitles sau subs.ro) vine ca argument separat.
const SUBTITLE_SOURCE_BY_OUTCOME: Record<string, string | null> = {
  already_embedded: "embedded",
  audio_already_romanian: "audio_ro",
  srt_already_ok: "tracked_srt",
  renamed_srt: "tracked_srt",
  reencoded_srt: "tracked_srt",
  season_corrected: "season_aggregate",
  season_already_ok: "season_aggregate",
};

const HAS_ROMANIAN_OUTCOMES = new Set([
  "already_embedded",
  "audio_already_romanian",
  "srt_already_ok",
  "renamed_srt",
  "reencoded_srt",
  "downloaded",
  "downloaded_approximate",
  "season_corrected",
  "season_already_ok",
]);

// `media.subtitle_report`: raportul unui fișier sau, pe placeholder-ul unui
// pachet, al întregului pachet.
interface PackSubtitleReport {
  files: SubtitleFileReport[];
  rejected: SubtitleRejectionReport[];
  episodeDetails: Record<string, string>;
}

function episodeReport(
  file: SubtitleFileReport,
  rejected: SubtitleRejectionReport[],
): FileSubtitleReport {
  return { file, rejected: rejected.filter((r) => r.episode === file.episode) };
}

const isDownloadOutcome = (outcome: string) =>
  outcome === "downloaded" || outcome === "downloaded_approximate";

// Starea unui episod creat din placeholder-ul unui pachet: partea lui din
// raport, sau starea pachetului dacă n-are una.
export function episodeSubtitleState(
  pack: {
    has_romanian_subtitle: number;
    subtitle_source: string | null;
    subtitle_detail: string | null;
    subtitle_approximate: number;
    subtitle_report: string | null;
  },
  season: number,
  episode: number,
) {
  const inherited = {
    hasRo: pack.has_romanian_subtitle,
    source: pack.subtitle_source,
    detail: pack.subtitle_detail,
    approximate: pack.subtitle_approximate,
    report: null as string | null,
  };
  let report: PackSubtitleReport;
  try {
    report = JSON.parse(pack.subtitle_report ?? "null");
  } catch {
    return inherited;
  }
  const key = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
  const file = Array.isArray(report?.files) ? report.files.find((f) => f.episode === key) : null;
  if (!file) return inherited;
  return {
    hasRo: HAS_ROMANIAN_OUTCOMES.has(file.outcome) ? 1 : 0,
    source: isDownloadOutcome(file.outcome)
      ? file.source
      : (SUBTITLE_SOURCE_BY_OUTCOME[file.outcome] ?? null),
    detail: report.episodeDetails?.[key] ?? pack.subtitle_detail,
    approximate: file.outcome === "downloaded_approximate" ? 1 : 0,
    report: JSON.stringify(episodeReport(file, report.rejected ?? [])),
  };
}

// După fiecare verificare/corectare de subtitrare: întâi starea torrentului,
// apoi, la un pachet, fiecare episod cu rezultatul lui. Înainte, fiecare
// episod primea agregatul sezonului — „are subtitrare” pentru tot sezonul de
// îndată ce un singur episod fusese corectat.
export function updateMediaSubtitleStatus(
  torrentHash: string,
  result: {
    outcome: string;
    detail: string;
    source?: SubtitleSource | null;
    files?: SubtitleFileReport[];
    rejected?: SubtitleRejectionReport[];
    episodeDetails?: Record<string, string>;
  },
): void {
  const files = result.files ?? [];
  const isPack = result.episodeDetails !== undefined;
  const reportOf = (file: SubtitleFileReport) =>
    JSON.stringify(episodeReport(file, result.rejected ?? []));
  // Rândurile fără raport propriu (placeholder-ul pachetului) primesc raportul
  // întreg — din el resolveSeasonPackPlexLinks scoate starea fiecărui episod.
  const packReport: PackSubtitleReport | null = isPack
    ? { files, rejected: result.rejected ?? [], episodeDetails: result.episodeDetails ?? {} }
    : null;
  // Episoadele cu raport propriu se scriu mai jos — scrise și aici, agregatul
  // le-ar suprascrie, iar `srt_already_ok` n-ar mai avea ce păstra.
  const ownKeys = isPack
    ? files.map((f) => f.episode).filter((k): k is string => !!k && /^S\d+E\d+$/.test(k))
    : [];
  const exclude = ownKeys.length
    ? ` AND (season IS NULL OR episode IS NULL OR printf('S%02dE%02d', season, episode) NOT IN (${ownKeys.map(() => "?").join(", ")}))`
    : "";
  writeSubtitleStatus(
    `WHERE torrent_hash = ?${exclude}`,
    [torrentHash, ...ownKeys],
    result.outcome,
    result.detail,
    result.source ?? null,
    packReport ? JSON.stringify(packReport) : files.length === 1 ? reportOf(files[0]) : null,
  );
  if (!isPack) return;
  for (const file of files) {
    const m = file.episode?.match(/^S(\d+)E(\d+)$/);
    if (!m) continue;
    writeSubtitleStatus(
      "WHERE torrent_hash = ? AND season = ? AND episode = ?",
      [torrentHash, Number(m[1]), Number(m[2])],
      file.outcome,
      result.episodeDetails?.[file.episode!] ?? result.detail,
      file.source,
      reportOf(file),
    );
  }
}

function writeSubtitleStatus(
  where: string,
  whereArgs: Array<string | number>,
  outcome: string,
  detail: string,
  downloadedSource: SubtitleSource | null,
  report: string | null,
): void {
  // Sursa contează doar la o descărcare reușită — la `download_failed` pe disc
  // n-a ajuns nimic.
  const source = isDownloadOutcome(outcome)
    ? downloadedSource
    : (SUBTITLE_SOURCE_BY_OUTCOME[outcome] ?? null);
  // O reverificare fără schimbări pe disc (`srt_already_ok`,
  // `season_already_ok`) nu rescrie sursa, detaliul și raportul — altfel un
  // .srt de pe subs.ro devenea „.srt din torrent” la primul „Corectează”
  // (S.W.A.T. Exiles, 9 oct. 2026). Se actualizează doar data verificării.
  const keepPrevious = outcome === "srt_already_ok" || outcome === "season_already_ok";
  const keep = keepPrevious ? 1 : 0;
  getDb()
    .prepare(
      `UPDATE media SET has_romanian_subtitle = ?,
       subtitle_source = CASE WHEN ? AND subtitle_source IS NOT NULL THEN subtitle_source ELSE ? END,
       subtitle_detail = CASE WHEN ? AND subtitle_source IS NOT NULL AND subtitle_detail IS NOT NULL
                              THEN subtitle_detail ELSE ? END,
       subtitle_report = CASE WHEN ? AND subtitle_source IS NOT NULL AND subtitle_report IS NOT NULL
                              THEN subtitle_report ELSE ? END,
       subtitle_approximate = CASE WHEN ? AND subtitle_source IS NOT NULL
                                   THEN subtitle_approximate ELSE ? END,
       has_romanian_audio = CASE WHEN ? = 1 THEN 1 ELSE has_romanian_audio END,
       subtitle_checked_at = datetime('now'), updated_at = datetime('now')
       ${where}`,
    )
    .run(
      HAS_ROMANIAN_OUTCOMES.has(outcome) ? 1 : 0,
      keep,
      source,
      keep,
      detail,
      keep,
      report,
      keep,
      outcome === "downloaded_approximate" ? 1 : 0,
      outcome === "audio_already_romanian" ? 1 : 0,
      ...whereArgs,
    );
}

// După „Șterge subtitrare”: .srt-ul a dispărut, starea redevine „fără RO”.
export function clearMediaSubtitleStatus(torrentHash: string): void {
  getDb()
    .prepare(
      `UPDATE media SET has_romanian_subtitle = 0, subtitle_source = NULL, subtitle_detail = NULL,
       subtitle_report = NULL, subtitle_approximate = 0,
       subtitle_checked_at = datetime('now'), updated_at = datetime('now')
       WHERE torrent_hash = ?`,
    )
    .run(torrentHash);
}

// Marchează finalizarea unui torrent ajuns la 100% (finalizeDownload).
// Întoarce `true` doar pentru apelantul care a marcat efectiv: `completed_at
// IS NULL` face din UPDATE o gardă atomică, deci a doua finalizare a aceluiași
// hash nu mai trimite notificare și nu mai rulează subtitrările. Pe hash, nu pe
// id-ul Filelist: un pachet are zeci de rânduri, dar o singură finalizare.
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
  // Din media_type: decide biblioteca Plex de rescanat.
  isMovie: boolean;
  imdbId: string | null;
}

// Descărcările neterminate, urmărite de sarcina „downloads”. Un rând per
// torrent (un pachet are N rânduri pe același hash). Filtrele:
// - `plex_rating_key IS NULL`: backfill-ul din Plex (15 aug.) a lăsat 77 de
//   rânduri cu hash și fără `completed_at`, deși erau demult în Plex;
// - `added_at` în ultimele 14 zile: un torrent abandonat n-are ce aștepta. Era
//   48h, de la buclele în memorie; un sezon 4K cu un singur seeder (45 GB)
//   poate depăși ușor două zile.
export function listUnfinishedTorrents(): UnfinishedTorrent[] {
  const rows = getDb()
    .prepare(
      `SELECT torrent_hash, MIN(torrent_name) AS torrent_name,
              MIN(imdb_id) AS imdb_id,
              MAX(media_type = 'movie') AS is_movie
         FROM media
        WHERE completed_at IS NULL
          AND torrent_hash IS NOT NULL
          AND plex_rating_key IS NULL
          AND added_at > datetime('now', '-14 days')
        GROUP BY torrent_hash`,
    )
    .all() as unknown as Array<{
    torrent_hash: string;
    torrent_name: string | null;
    imdb_id: string | null;
    is_movie: number;
  }>;

  return rows.map((r) => ({
    torrentHash: r.torrent_hash,
    torrentName: r.torrent_name ?? r.torrent_hash,
    isMovie: !!r.is_movie,
    imdbId: r.imdb_id,
  }));
}

// Torrentele terminate de cel mult `minutes` minute și încă nelegate — sarcina
// „downloads” încearcă legarea la fiecare tact, apoi le ia reconcilierea.
export function listRecentlyCompletedUnlinked(minutes: number): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT torrent_hash FROM media
        WHERE torrent_hash IS NOT NULL
          AND plex_rating_key IS NULL
          AND completed_at IS NOT NULL
          AND completed_at > datetime('now', ?)`,
    )
    .all(`-${minutes} minutes`) as Array<{ torrent_hash: string }>;
  return rows.map((r) => r.torrent_hash);
}

// Titlul și posterul deja scrise în `media` pentru un torrent — notificările
// le citesc de aici, nu recalculează printr-un lookup TMDB paralel (TMDB rămâne
// doar rezervă, pentru torrente fără rând).
export function getMediaDisplayByTorrentHash(torrentHash: string): {
  title: string;
  posterPath: string | null;
  season: number | null;
  episode: number | null;
  isSeasonPack: boolean;
} | null {
  const row = getDb()
    .prepare(
      // ORDER BY: cât se desface un pachet, rândul-pachet coexistă cu
      // episoadele lui pe același hash — notificarea trebuie să spună
      // „Sezonul N”, nu un episod oarecare.
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

// La „Șterge titlul complet”: torrentul șters dispare și din `media`.
export function deleteMediaByTorrentHash(torrentHash: string): void {
  getDb().prepare("DELETE FROM media WHERE torrent_hash = ?").run(torrentHash);
}

// Leagă un rând de item-ul lui din Plex (ratingKey, calitate, durată). Apelat
// cu reîncercări — scanarea Plex e asincronă. Sare peste pachete (un rând nu
// poate purta N ratingKey-uri). true = legat, deci reîncercările se opresc.
export async function resolveMediaPlexLinkByTorrentHash(torrentHash: string): Promise<boolean> {
  const db = getDb();
  // Întâi un rând NElegat: un pachet în desfacere coexistă cu episoadele deja
  // extrase, iar un rând legat l-ar masca pe cel care încă are treabă.
  const row = db
    .prepare(
      `SELECT id, media_type, tmdb_id, title, original_title, season, episode, plex_rating_key,
              torrent_name
         FROM media WHERE torrent_hash = ?
        ORDER BY plex_rating_key IS NOT NULL, id LIMIT 1`,
    )
    .get(torrentHash) as
    | {
        id: number;
        media_type: string;
        tmdb_id: number | null;
        title: string;
        original_title: string | null;
        season: number | null;
        episode: number | null;
        plex_rating_key: string | null;
        torrent_name: string | null;
      }
    | undefined;
  if (!row) return false;
  // Niciun rând nelegat — gata.
  if (row.plex_rating_key) return true;

  const { findPlexMovieLink, findPlexEpisodeLink } = await import("../services/plex-library");
  const link =
    row.media_type === "movie"
      ? // Calea reală de pe disk, ca legarea să ia calitatea versiunii corecte
        // când filmul există în Plex în mai multe versiuni.
        await findPlexMovieLink(
          { tmdbId: row.tmdb_id, titles: [row.title, row.original_title ?? row.title] },
          await contentPathForTorrent(torrentHash),
          row.torrent_name,
        )
      : row.media_type === "episode" && row.season != null && row.episode != null
        ? await findPlexEpisodeLink(
            // Pe rândurile de episod, tmdb_id e al SERIALULUI (vezi upsertMediaEntry).
            { tmdbId: row.tmdb_id, titles: [row.title] },
            row.season,
            row.episode,
          )
        : null;
  if (!link) return false;

  db.prepare(
    `UPDATE media SET plex_rating_key = ?, quality = ?, duration_ms = ?, plex_added_at = ?,
     updated_at = datetime('now') WHERE id = ?`,
  ).run(link.ratingKey, link.quality, link.durationMs, link.addedAt, row.id);
  return true;
}

// Calea de pe disk a unui torrent, din qBittorrent.
async function contentPathForTorrent(torrentHash: string): Promise<string | null> {
  const url = (process.env.QBIT_URL ?? "http://192.168.1.192:25556").replace(/\/$/, "");
  const user = process.env.QBIT_USERNAME;
  const pass = process.env.QBIT_PASSWORD;
  if (!user || !pass) return null;
  const { qbitContentPath } = await import("../qbit-client");
  return qbitContentPath(url, torrentHash, user, pass);
}

// Ce știe Plex despre versiunea NOASTRĂ a unui rând legat. Calea din
// qBittorrent se cere doar când item-ul are mai multe versiuni.
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

// Filmele legate, dar fără calitate: cu mai multe versiuni în Plex (4K + 1080p)
// nu ghicim care e a noastră. Reconcilierea obișnuită nu le vede (sunt
// legate), iar motivul eșecului e de obicei trecător (torrent încă absent din
// qBittorrent, versiune încă neanalizată de Plex).
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

  // Direct pe ratingKey: o cerere, fără riscul ca titlul să nimerească alt film.
  const { fetchPlexItemVersions } = await import("../services/plex-library");
  // COALESCE: la mai multe versiuni `addedAt` vine null — o atribuire directă
  // ar șterge data corectă a unui rând vechi.
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
  filelist_id: number | null;
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
  subtitle_approximate: number;
  subtitle_report: string | null;
}

// Câte episoade difuzate are sezonul, după TMDB — reperul pentru „Plex a
// terminat pachetul”. null = nu știm, iar apelantul acceptă ce e.
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

// Cât mai așteptăm indexarea unui pachet înainte să acceptăm ce s-a găsit.
// Peste prag, pachetul e chiar incomplet (8 din 10 episoade), iar insistența
// l-ar ține pe „Se procesează în Plex”.
const SEASON_PACK_INDEX_GRACE_MS = 2 * 60 * 60 * 1000;

// Legarea pachetelor de sezon: un rând nu poate purta N ratingKey-uri, deci
// pentru fiecare episod găsit în Plex clonăm rândul-pachet într-un rând de
// episod (sau actualizăm unul existent), apoi ștergem placeholder-ul.
//
// În două trepte: Plex indexează fișier cu fișier, deci o trecere găsește
// adesea 2–3 episoade din 10. Ștergerea pachetului la primul episod găsit
// oprea reîncercările, iar restul episoadelor rămâneau fără rând — invizibile
// în Bibliotecă și redescărcate de urmărire. Acum fiecare trecere sincronizează
// ce a găsit (idempotent), iar pachetul se șterge doar la sezon complet sau
// după fereastra de grație; până atunci întoarcem false.
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
  const links = await findPlexSeasonLinks({ tmdbId: row.tmdb_id, titles: [row.title] }, row.season);
  if (!links || links.size === 0) return false;

  const expected = await airedEpisodeCountForSeason(row.tmdb_id, row.season);
  // completed_at e în formatul SQLite (UTC), ca în plex-browse.ts.
  const completedMs = row.completed_at
    ? new Date(`${row.completed_at.replace(" ", "T")}Z`).getTime()
    : null;
  const graceExpired = completedMs == null || Date.now() - completedMs > SEASON_PACK_INDEX_GRACE_MS;
  const isComplete = expected == null || links.size >= expected || graceExpired;

  const insert = db.prepare(
    `INSERT INTO media (
      media_type, parent_id, imdb_id, tmdb_id, title, original_title, literal_title,
      year, season, episode, overview_ro, genres, poster_path, tv_status,
      plex_rating_key, plex_added_at, torrent_name, torrent_hash, filelist_id, category,
      category_name, size, freeleech, internal, save_path, is_season_pack, added_via,
      requested_by_user_id, completed_at, has_romanian_subtitle, has_romanian_audio,
      subtitle_source, subtitle_detail, subtitle_checked_at, subtitle_approximate,
      subtitle_report, quality, duration_ms
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const updateExisting = db.prepare(
    `UPDATE media SET plex_rating_key = ?, quality = ?, duration_ms = ?, plex_added_at = ?,
     updated_at = datetime('now') WHERE id = ?`,
  );
  // `parent_id IS ?`: `= NULL` nu se potrivește niciodată, deci am fi reinserat
  // aceleași episoade la fiecare trecere.
  const findExisting = db.prepare(
    `SELECT id FROM media WHERE parent_id IS ? AND season = ? AND episode = ? AND id != ?`,
  );
  // După cheia reală de unicitate (`plex_rating_key` UNIQUE): un episod poate
  // exista deja sub alt părinte (descărcat separat). Fără asta, INSERT-ul ar
  // arunca și ar rupe bucla, lăsând restul episoadelor nelegate.
  const findByRatingKey = db.prepare(`SELECT id FROM media WHERE plex_rating_key = ?`);

  let inserted = 0;
  for (const [episodeNum, link] of links) {
    const existing = (findExisting.get(row.parent_id, row.season, episodeNum, row.id) ??
      findByRatingKey.get(link.ratingKey)) as { id: number } | undefined;
    if (existing) {
      updateExisting.run(link.ratingKey, link.quality, link.durationMs, link.addedAt, existing.id);
      continue;
    }
    const sub = episodeSubtitleState(row, row.season, episodeNum);
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
      row.filelist_id,
      row.category,
      row.category_name,
      row.size,
      row.freeleech,
      row.internal,
      row.save_path,
      // 0, nu row.is_season_pack: rândul e un episod concret (cu 1 moștenit,
      // notificările îl numeau „Sezonul N”). Pachetul se vede din torrent_name.
      0,
      row.added_via,
      row.requested_by_user_id,
      row.completed_at,
      sub.hasRo,
      row.has_romanian_audio,
      sub.source,
      sub.detail,
      row.subtitle_checked_at,
      sub.approximate,
      sub.report,
      link.quality,
      link.durationMs,
    );
    inserted++;
  }

  // Detaliile episoadelor tocmai create — doar dacă s-au creat rânduri (o
  // trecere fără nimic nou n-are ce cere de la TMDB).
  if (inserted > 0) {
    const { syncEpisodeDetailsForShow } = await import("./show-watch");
    syncEpisodeDetailsForShow(row.parent_id);
  }

  if (!isComplete) {
    // Pachetul rămâne ca marcaj „încă se indexează”: urmărirea nu descarcă
    // individual episoadele care vin din el, iar reconcilierea îl reia.
    console.log(
      `[media] Pachet sezon ${row.season} "${row.title}": ${links.size}/${expected} episoade indexate de Plex — reiau`,
    );
    return false;
  }

  db.prepare("DELETE FROM media WHERE id = ?").run(row.id);
  return true;
}
