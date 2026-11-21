// ---------------------------------------------------------------------------
// Fișa unui titlu din Bibliotecă — la click pe un rând din listă. Citită din
// `media`; „cine a văzut” rămâne live (istoricul Plex, în cache).
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";
import { SUBTITLE_RETRY_DAYS as RETRY_DAYS } from "../filelist/subtitle-outcomes";
import type { FileSubtitleReport } from "../filelist/subtitle-outcomes";
import { sqliteUtcMs } from "../format";
import { seasonEpisodeLabel, secondaryTitle } from "../media/title-label";
import {
  fetchQbitProgress,
  getOwnerViewedAtByRatingKey,
  myPlexIdentity,
  progressPercent,
  rowAddedAt,
  rowDeleteScheduled,
  rowStatus,
  sqliteToUnix,
  type MediaStatus,
} from "./plex-browse-shared";

export interface ShowEpisodeEntry {
  mediaId: number;
  season: number | null;
  episode: number | null;
  // Null până ajunge completarea din TMDB — UI-ul arată atunci doar SxxEyy.
  episodeTitle: string | null;
  addedAt: number;
  status: MediaStatus;
  watchedByMe: boolean;
  isSeasonPack: boolean;
  // Procentul din qBittorrent, cât episodul se descarcă; null dacă torrentul nu
  // mai e acolo (rândul nu rămâne blocat la 0%).
  progress: number | null;
  // Cadrul, data difuzării și durata — din același SELECT.
  stillUrl: string | null;
  airDate: string | null;
  durationMs: number | null;
  // Ștergere programată: termenul (SQLite, UTC; null = la 48 h după finalizare).
  deleteScheduled: { at: string | null } | null;
}

export interface PlexTitleDetail {
  mediaId: number;
  ratingKey: string | null;
  title: string;
  type: "movie" | "episode" | "tv_show";
  show: string | null;
  season: number | null;
  episode: number | null;
  // Link TMDB; pe episoade, posterul sezonului.
  thumbUrl: string | null;
  // Pe episoade: cadrul din episod (orizontal).
  stillUrl: string | null;
  // Pe episoade: data difuzării (`year` e anul serialului).
  airDate: string | null;
  addedAt: number;
  durationMs: number;
  year: number | null;
  quality: string | null;
  hasRomanianSubtitle: boolean;
  // Subtitrarea română e „aproximativă” (de verificat sincronizarea).
  subtitleApproximate: boolean;
  hasRomanianAudio: boolean;
  summary: string | null;
  genres: string[];
  watchedByMe: boolean;
  watchedByMeAt: number | null;
  // La serial: ultimul episod văzut (după dată) și câte, din `episodes.length`.
  watchedByOthers: Array<{
    username: string;
    viewedAt: number;
    lastEpisode?: string | null;
    episodesWatched?: number;
  }>;
  addedByUsername: string | null;
  status: MediaStatus;
  // Progres live din qBittorrent — vezi PlexBrowseItem.
  progress: number | null;
  dlspeed: number | null;
  eta: number | null;
  // Acțiunile pe subtitrare și ștergerea lucrează pe media.id + torrentHash.
  torrentHash: string | null;
  // Pagina pe Filelist — doar descărcările de după v36.
  filelistId: number | null;
  // Reîncercarea zilnică a subtitrării: „se caută zilnic până pe…” sau
  // „căutarea s-a încheiat”; null când nu e cazul.
  subtitleRetry: {
    state: "searching" | "ended";
    kind: "missing" | "approximate";
    // Formatul SQLite, UTC.
    until: string;
    lastCheckedAt: string | null;
  } | null;
  // true = intrarea e un pachet de sezon — acțiunile afectează tot pachetul.
  isSeasonPack: boolean;
  // true pentru cel care a adăugat titlul sau un admin.
  canManage: boolean;
  // O ștergere cerută acum doar se programează: termenul (SQLite, UTC), null
  // cât se descarcă. null = pe loc (după 48 h) sau pentru cine nu poate șterge.
  deleteDelay: { until: string | null } | null;
  // Ștergerea programată: când (null = la 48 h după finalizare) și cine.
  // Oricine o poate anula.
  deleteScheduled: { at: string | null; byUsername: string | null } | null;
  // Doar adminul poate ocoli programarea și șterge pe loc.
  canDeleteImmediately: boolean;
  tmdbId: number | null;
  // Rândul de sub nume (secondaryTitle din title-label.ts).
  secondaryTitle: string | null;
  // Vizibil pentru toți — butonul spre IMDb.
  imdbId: string | null;
  // La 'tv_show': episoadele deținute, în ordine, pentru lista pe sezoane.
  episodes: ShowEpisodeEntry[];
  // La 'tv_show': starea urmăririi.
  tvStatus: string | null;
  autoDownload: boolean;
  autoDownloadQuality: string | null;
  autoDownloadFallbackQuality: string | null;
  autoDownloadFrom: string | null;
  watchLastCheckedAt: string | null;
  // Următorul episod anunțat (cod, data TMDB, ora TVmaze) — din `media`.
  nextEpisode: string | null;
  nextEpisodeAirDate: string | null;
  nextEpisodeAirstamp: string | null;
  // Detalii tehnice — doar pentru admin.
  tech: {
    imdbId: string | null;
    torrentName: string | null;
    categoryName: string | null;
    sizeBytes: number;
    freeleech: boolean;
    internal: boolean;
    savePath: string | null;
    sourceUrl: string | null;
    addedVia: string | null;
    completedAt: string | null;
    subtitleSource: string | null;
    subtitleDetail: string | null;
    // Raportul structurat; null la rânduri vechi sau la placeholder-ul unui
    // pachet (rămâne detaliul text).
    subtitleReport: FileSubtitleReport | null;
    subtitleCheckedAt: string | null;
    plexRatingKey: string | null;
  } | null;
}

// Doar raportul unui fișier; al unui pachet întreg nu se afișează pe rând.
function parseFileSubtitleReport(raw: string | null): FileSubtitleReport | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<FileSubtitleReport>;
    return parsed.file ? { file: parsed.file, rejected: parsed.rejected ?? [] } : null;
  } catch {
    return null;
  }
}

interface MediaRow {
  id: number;
  media_type: string;
  title: string;
  original_title: string | null;
  english_title: string | null;
  imdb_id: string | null;
  tmdb_id: number | null;
  season: number | null;
  episode: number | null;
  poster_path: string | null;
  year: number | null;
  overview_ro: string | null;
  genres: string;
  quality: string | null;
  has_romanian_subtitle: number;
  has_romanian_audio: number;
  duration_ms: number | null;
  torrent_name: string | null;
  torrent_hash: string | null;
  filelist_id: number | null;
  category_name: string | null;
  size: number;
  freeleech: number;
  internal: number;
  save_path: string | null;
  source_url: string | null;
  added_via: string | null;
  plex_rating_key: string | null;
  is_season_pack: number;
  requested_by_user_id: number | null;
  added_at: string;
  completed_at: string | null;
  subtitle_source: string | null;
  subtitle_detail: string | null;
  subtitle_report: string | null;
  subtitle_checked_at: string | null;
  subtitle_approximate: number;
  episode_title: string | null;
  episode_overview: string | null;
  episode_still: string | null;
  episode_air_date: string | null;
  tv_status: string | null;
  auto_download: number;
  auto_download_quality: string | null;
  auto_download_fallback_quality: string | null;
  auto_download_from: string | null;
  watch_last_checked_at: string | null;
  next_episode: string | null;
  next_episode_air_date: string | null;
  next_episode_airstamp: string | null;
}

// Aceeași regulă ca listTorrentsDueForSubtitleRetry.
function subtitleRetryOf(row: MediaRow): PlexTitleDetail["subtitleRetry"] {
  if (row.media_type === "tv_show" || !row.torrent_hash || !row.completed_at) return null;
  const missing = !row.has_romanian_subtitle && !row.has_romanian_audio;
  const approximate = !!row.has_romanian_subtitle && !!row.subtitle_approximate;
  if (!missing && !approximate) return null;
  const completed = sqliteUtcMs(row.completed_at);
  if (!Number.isFinite(completed)) return null;
  const untilMs = completed + RETRY_DAYS * 24 * 60 * 60 * 1000;
  const until = new Date(untilMs).toISOString().slice(0, 19).replace("T", " ");
  if (untilMs > Date.now()) {
    return {
      state: "searching",
      kind: missing ? "missing" : "approximate",
      until,
      lastCheckedAt: row.subtitle_checked_at,
    };
  }
  // După fereastră, o aproximativă rămâne subtitrarea titlului — butonul
  // poate căuta în continuare una mai bună.
  return {
    state: "ended",
    kind: missing ? "missing" : "approximate",
    until,
    lastCheckedAt: row.subtitle_checked_at,
  };
}

// Detaliile unui titlu, doar din SELECT-uri; „cine a văzut” rămâne live
// (istoricul Plex, cache 60s) — static s-ar dezactualiza.
async function buildDetailFromMediaRow(
  row: MediaRow,
  session: { data: { userId?: number; admin?: boolean } },
): Promise<PlexTitleDetail> {
  const { getDb } = await import("../db");
  const { isAdminOrOwner } = await import("../auth/admin.server");
  const db = getDb();

  const isEpisode = row.media_type === "episode";
  const isShow = row.media_type === "tv_show";

  const { historyName: myHistoryName, plexUsername: myPlexUsername } = await myPlexIdentity(
    db,
    session.data.userId,
  );

  // La un serial: episoadele, pentru lista pe sezoane și „cine a văzut”.
  const epRows = isShow
    ? (db
        .prepare(
          `SELECT id, season, episode, original_title, title, episode_title,
                  plex_rating_key, plex_added_at, added_at, completed_at, is_season_pack,
                  torrent_hash, episode_still, episode_air_date, duration_ms,
                  delete_requested_at, delete_scheduled_at
             FROM media WHERE parent_id = ?
             ORDER BY season, episode`,
        )
        .all(row.id) as unknown as Array<{
        id: number;
        season: number | null;
        episode: number | null;
        original_title: string | null;
        title: string;
        episode_title: string | null;
        plex_rating_key: string | null;
        plex_added_at: number | null;
        added_at: string;
        completed_at: string | null;
        is_season_pack: number;
        torrent_hash: string | null;
        episode_still: string | null;
        episode_air_date: string | null;
        duration_ms: number | null;
        delete_requested_at: string | null;
        delete_scheduled_at: string | null;
      }>)
    : [];

  const { getAllPlexWatchedIndexes, getWatchedAt } = await import("./plex");
  const titleForMatch = row.original_title || row.title;
  const allWatchedIndexes = await getAllPlexWatchedIndexes();
  const matchUnits = isShow
    ? epRows.map((e) => ({
        ratingKey: e.plex_rating_key,
        title: e.original_title || e.title,
        show: e.original_title || e.title,
        season: e.season,
        episode: e.episode,
      }))
    : [
        {
          ratingKey: row.plex_rating_key,
          title: titleForMatch,
          show: isEpisode ? titleForMatch : null,
          season: row.season,
          episode: row.episode,
        },
      ];
  const watchedByAll: PlexTitleDetail["watchedByOthers"] = [];
  for (const [username, index] of Object.entries(allWatchedIndexes)) {
    // La serial: cea mai recentă vizionare, un rând per utilizator.
    let last: { unit: (typeof matchUnits)[number]; viewedAt: number } | null = null;
    let count = 0;
    for (const u of matchUnits) {
      const viewedAt = getWatchedAt(index, u);
      if (viewedAt == null) continue;
      count++;
      if (!last || viewedAt >= last.viewedAt) last = { unit: u, viewedAt };
    }
    if (!last) continue;
    watchedByAll.push({
      username,
      viewedAt: last.viewedAt,
      ...(isShow && {
        lastEpisode: seasonEpisodeLabel(last.unit.season, last.unit.episode),
        episodesWatched: count,
      }),
    });
  }

  if (!isShow && row.plex_rating_key && !watchedByAll.some((w) => w.username === myHistoryName)) {
    const ownerViewedAt = await getOwnerViewedAtByRatingKey(myPlexUsername, [row.plex_rating_key]);
    const lastViewedAt = ownerViewedAt.get(row.plex_rating_key);
    if (lastViewedAt != null && myHistoryName) {
      watchedByAll.push({ username: myHistoryName, viewedAt: lastViewedAt });
    }
  }
  const myWatched = myHistoryName
    ? watchedByAll.find((w) => w.username === myHistoryName)
    : undefined;
  const watchedByMe = !!myWatched;
  const watchedByMeAt = myWatched && myWatched.viewedAt > 0 ? myWatched.viewedAt : null;
  // Cea mai recentă vizionare sus.
  const watchedByOthers = watchedByAll
    .filter((w) => w.username !== myHistoryName)
    .sort((a, b) => b.viewedAt - a.viewedAt);

  const canManage = isAdminOrOwner(session, row.requested_by_user_id);
  const isAdmin = !!session.data.admin;
  let delay: PlexTitleDetail["deleteDelay"] = null;
  let deleteScheduled: PlexTitleDetail["deleteScheduled"] = null;
  if (row.torrent_hash) {
    const { deleteDelay, scheduledDeletion, usernameOf } =
      await import("../media/scheduled-delete");
    if (canManage) delay = deleteDelay(row.torrent_hash);
    const scheduled = scheduledDeletion(row.torrent_hash);
    if (scheduled) {
      deleteScheduled = { at: scheduled.at, byUsername: usernameOf(scheduled.byUserId) };
    }
  }

  // Episoadele, pentru lista pe sezoane, cu „văzut” per episod.
  let episodes: ShowEpisodeEntry[] = [];
  if (isShow) {
    const { isItemWatched } = await import("./plex");
    const myIndex = myHistoryName ? allWatchedIndexes[myHistoryName] : undefined;
    // O singură cerere qBittorrent pentru toate episoadele încă nesosite.
    const epProgress = await fetchQbitProgress(
      epRows.filter((e) => !e.plex_rating_key && e.torrent_hash).map((e) => e.torrent_hash!),
    );
    episodes = epRows.map((e) => {
      const epTitle = e.original_title || e.title;
      return {
        mediaId: e.id,
        season: e.season,
        episode: e.episode,
        episodeTitle: e.episode_title,
        addedAt: rowAddedAt(e),
        status: rowStatus(e),
        watchedByMe: myIndex
          ? isItemWatched(myIndex, {
              ratingKey: e.plex_rating_key,
              title: epTitle,
              show: epTitle,
              season: e.season,
              episode: e.episode,
            })
          : false,
        isSeasonPack: !!e.is_season_pack,
        progress:
          !e.plex_rating_key && e.torrent_hash && epProgress.has(e.torrent_hash)
            ? progressPercent(epProgress.get(e.torrent_hash)!.progress)
            : null,
        stillUrl: e.episode_still,
        airDate: e.episode_air_date,
        durationMs: e.duration_ms || null,
        deleteScheduled: rowDeleteScheduled(e),
      };
    });
  }

  // Statusul unui serial vine din episoadele lui: rândul 'tv_show' n-are
  // torrent, deci formula obișnuită îl declara pe veci „Se descarcă” (cu un
  // refetch la 2,5s care nu se mai oprea).
  const status: PlexTitleDetail["status"] = isShow
    ? episodes.some((e) => e.status !== "in_library")
      ? "downloading"
      : "in_library"
    : rowStatus(row);

  let progress: number | null = null;
  let dlspeed: number | null = null;
  let eta: number | null = null;
  if (!isShow && !row.plex_rating_key && row.torrent_hash) {
    const info = (await fetchQbitProgress([row.torrent_hash])).get(row.torrent_hash);
    if (info) {
      progress = progressPercent(info.progress);
      dlspeed = info.dlspeed;
      eta = info.eta;
    }
  }

  let addedByUsername: string | null = null;
  if (row.requested_by_user_id != null) {
    const u = db
      .prepare("SELECT username FROM users WHERE id = ?")
      .get(row.requested_by_user_id) as { username: string } | undefined;
    addedByUsername = u?.username ?? null;
  }

  return {
    mediaId: row.id,
    ratingKey: row.plex_rating_key,
    // Pe episoade, `title` e al serialului (merge în `show`); titlul e numele
    // episodului.
    title: isShow ? "" : isEpisode ? (row.episode_title ?? "") : row.title,
    type: isEpisode ? "episode" : isShow ? "tv_show" : "movie",
    show: isEpisode || isShow ? row.title : null,
    season: row.season,
    episode: row.episode,
    thumbUrl: row.poster_path,
    stillUrl: isEpisode ? row.episode_still : null,
    airDate: isEpisode ? row.episode_air_date : null,
    addedAt: sqliteToUnix(row.added_at),
    durationMs: row.duration_ms ?? 0,
    year: row.year,
    quality: row.quality,
    hasRomanianSubtitle: !!row.has_romanian_subtitle,
    subtitleApproximate: !!row.has_romanian_subtitle && !!row.subtitle_approximate,
    hasRomanianAudio: !!row.has_romanian_audio,
    // Descrierea episodului; a serialului doar ca rezervă.
    summary: isEpisode ? (row.episode_overview ?? row.overview_ro) : row.overview_ro,
    genres: JSON.parse(row.genres || "[]"),
    watchedByMe,
    watchedByMeAt,
    watchedByOthers,
    addedByUsername,
    status,
    progress,
    dlspeed,
    eta,
    torrentHash: row.torrent_hash,
    filelistId: row.filelist_id,
    subtitleRetry: subtitleRetryOf(row),
    isSeasonPack: !!row.is_season_pack,
    canManage,
    deleteDelay: delay,
    deleteScheduled,
    canDeleteImmediately: isAdmin,
    tmdbId: row.tmdb_id,
    secondaryTitle: secondaryTitle(row.title, row.original_title, row.english_title),
    imdbId: row.imdb_id,
    episodes,
    tvStatus: row.tv_status,
    autoDownload: !!row.auto_download,
    autoDownloadQuality: row.auto_download_quality,
    autoDownloadFallbackQuality: row.auto_download_fallback_quality,
    autoDownloadFrom: row.auto_download_from,
    watchLastCheckedAt: row.watch_last_checked_at,
    nextEpisode: row.next_episode,
    nextEpisodeAirDate: row.next_episode_air_date,
    nextEpisodeAirstamp: row.next_episode_airstamp,
    tech: isAdmin
      ? {
          imdbId: row.imdb_id,
          torrentName: row.torrent_name,
          categoryName: row.category_name,
          sizeBytes: row.size,
          freeleech: !!row.freeleech,
          internal: !!row.internal,
          savePath: row.save_path,
          sourceUrl: row.source_url,
          addedVia: row.added_via,
          completedAt: row.completed_at,
          subtitleSource: row.subtitle_source,
          subtitleDetail: row.subtitle_detail,
          subtitleReport: parseFileSubtitleReport(row.subtitle_report),
          subtitleCheckedAt: row.subtitle_checked_at,
          plexRatingKey: row.plex_rating_key,
        }
      : null,
  };
}

export const getPlexTitleDetail = createServerFn({ method: "GET" })
  .validator((data: { mediaId: number }) => data)
  .handler(
    async ({
      data,
    }): Promise<{ status: "ok"; detail: PlexTitleDetail } | { status: "error"; error: string }> => {
      const { requireAuth } = await import("../auth/admin.server");
      const session = await requireAuth();

      const { getDb } = await import("../db");
      const mediaRow = getDb()
        .prepare(
          `SELECT id, media_type, title, original_title, imdb_id, tmdb_id, season, episode, poster_path, year,
           overview_ro, genres, quality, has_romanian_subtitle, has_romanian_audio, duration_ms, torrent_name, torrent_hash,
           filelist_id, category_name, size, freeleech, internal, save_path, source_url, added_via,
           plex_rating_key, is_season_pack, requested_by_user_id, added_at, completed_at,
           subtitle_source, subtitle_detail, subtitle_report, subtitle_checked_at, subtitle_approximate, episode_title,
           episode_overview, episode_still, episode_air_date,
           tv_status, auto_download, auto_download_quality, auto_download_fallback_quality,
           auto_download_from, watch_last_checked_at,
           next_episode, next_episode_air_date, next_episode_airstamp,
           -- Episoadele noi îl primesc abia la următoarea trecere prin serial.
           COALESCE(english_title, (SELECT p.english_title FROM media p WHERE p.id = media.parent_id))
             AS english_title
           FROM media WHERE id = ?`,
        )
        .get(data.mediaId) as MediaRow | undefined;
      if (!mediaRow) {
        return { status: "error", error: "Titlul nu a fost găsit" };
      }
      return { status: "ok", detail: await buildDetailFromMediaRow(mediaRow, session) };
    },
  );
