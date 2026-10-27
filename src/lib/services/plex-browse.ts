// ---------------------------------------------------------------------------
// Biblioteca: lista (după data adăugării) și detaliile per titlu, pentru orice
// cont aprobat. Citite exclusiv din `media` — zero cereri Plex/TMDB la
// navigare; singurul lucru live e „cine a văzut” (istoricul Plex, în cache).
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";
import { SUBTITLE_RETRY_DAYS as RETRY_DAYS } from "../filelist/subtitle-outcomes";
import type { FileSubtitleReport } from "../filelist/subtitle-outcomes";

// Un rând = un film SAU un serial întreg; episoadele se văd doar în drawer.
// (Lista per episod, grupată în client, arăta un serial de mai multe ori.)
export interface PlexBrowseItem {
  // id-ul rândului din `media` (la seriale, rândul 'tv_show').
  mediaId: number;
  ratingKey: string | null;
  title: string;
  type: "movie" | "tv_show";
  show: string | null;
  // Titlul original, doar pentru căutare („Dune” găsește și titlul românesc).
  originalTitle: string | null;
  // Link TMDB, gata de folosit ca src.
  thumbUrl: string | null;
  // La seriale: ultimul episod adăugat — un serial cu episoade noi urcă în listă.
  addedAt: number;
  // Pentru seriale: adevărat dacă a văzut măcar un episod.
  watchedByMe: boolean;
  // Câți utilizatori au vizionat titlul (la seriale, măcar un episod).
  watchedCount: number;
  // Doar pentru seriale (0 la filme).
  episodeCount: number;
  seasonCount: number;
  // Câte episoade a văzut utilizatorul curent („12/36”).
  watchedEpisodes: number;
  // Câte episoade sunt încă în descărcare/procesare.
  downloadingCount: number;
  // Urmărire episoade noi activă pe serial.
  autoDownload: boolean;
  // "downloading" — încă neindexat de Plex; "processing" — terminat, așteaptă
  // legarea; "in_library" — în Plex.
  status: "in_library" | "downloading" | "processing";
  // Progresul din qBittorrent, doar la "downloading"; null dacă torrentul nu
  // mai e acolo sau qBittorrent nu răspunde.
  progress: number | null; // 0-100
  dlspeed: number | null; // bytes/s
  eta: number | null; // secunde
  // Ștergere programată: termenul (SQLite, UTC; null = la 48 h după
  // finalizare). La seriale, cel mai apropiat.
  deleteScheduled: { at: string | null } | null;
}

// ---------------------------------------------------------------------------
// Progresul din qBittorrent — o singură cerere cu toate hash-urile.
// ---------------------------------------------------------------------------

interface QbitProgressInfo {
  progress: number;
  dlspeed: number;
  eta: number;
}

async function fetchQbitProgress(hashes: string[]): Promise<Map<string, QbitProgressInfo>> {
  const result = new Map<string, QbitProgressInfo>();
  if (hashes.length === 0) return result;
  const base = process.env.QBIT_URL;
  const user = process.env.QBIT_USERNAME;
  const pass = process.env.QBIT_PASSWORD;
  if (!base || !user || !pass) return result;
  try {
    const { qbitGet } = await import("../qbit-client");
    const url = base.replace(/\/$/, "");
    const res = await qbitGet(url, `/api/v2/torrents/info?hashes=${hashes.join("|")}`, user, pass);
    if (!res.ok) return result;
    const list = (await res.json()) as Array<{
      hash: string;
      progress: number;
      dlspeed: number;
      eta: number;
    }>;
    for (const t of list) {
      result.set(t.hash, { progress: t.progress, dlspeed: t.dlspeed, eta: t.eta });
    }
  } catch {
    // qBittorrent indisponibil — lista rămâne fără procent.
  }
  return result;
}

// Rezervă pentru „Marchează ca vizionat” din Plex, care setează viewCount, dar
// nu scrie în istoric. Sigur doar pentru owner-ul serverului (al cărui
// viewCount îl vede PLEX_TOKEN).
async function getOwnerViewedAtByRatingKey(
  myPlexUsername: string | null,
  candidateRatingKeys: string[],
): Promise<Map<string, number>> {
  if (!myPlexUsername || candidateRatingKeys.length === 0) return new Map();
  const { getPlexOwnerUsername, getPlexViewedRatingKeys } = await import("./plex");
  const ownerUsername = await getPlexOwnerUsername();
  if (myPlexUsername !== ownerUsername) return new Map();
  return getPlexViewedRatingKeys(candidateRatingKeys);
}

// Contul Plex al utilizatorului: `historyName` = cheia din istoricul Plex,
// `plexUsername` = username-ul plex.tv, comparat cu owner-ul.
async function myPlexIdentity(
  db: import("node:sqlite").DatabaseSync,
  userId: number | undefined,
): Promise<{ historyName: string | null; plexUsername: string | null }> {
  if (!userId) return { historyName: null, plexUsername: null };
  const me = db
    .prepare("SELECT plex_account_id, plex_username FROM users WHERE id = ?")
    .get(userId) as { plex_account_id: number | null; plex_username: string | null } | undefined;
  const plexUsername = me?.plex_username ?? null;
  if (!me || (me.plex_account_id == null && !plexUsername)) {
    return { historyName: null, plexUsername };
  }
  const { getPlexHistoryName } = await import("./plex");
  return {
    historyName: await getPlexHistoryName(me.plex_account_id, plexUsername),
    plexUsername,
  };
}

interface MediaBrowseRow {
  id: number;
  parent_id: number | null;
  plex_rating_key: string | null;
  media_type: string;
  title: string;
  original_title: string | null;
  season: number | null;
  episode: number | null;
  poster_path: string | null;
  plex_added_at: number | null;
  added_at: string;
  torrent_hash: string | null;
  completed_at: string | null;
  auto_download: number;
  delete_requested_at: string | null;
  delete_scheduled_at: string | null;
}

function rowDeleteScheduled(r: {
  delete_requested_at: string | null;
  delete_scheduled_at: string | null;
}): { at: string | null } | null {
  return r.delete_requested_at ? { at: r.delete_scheduled_at } : null;
}

// Cea mai apropiată ștergere programată dintre episoade; un termen cunoscut
// bate unul care încă așteaptă finalizarea.
function earliestDeleteScheduled(rows: MediaBrowseRow[]): { at: string | null } | null {
  const scheduled = rows.map(rowDeleteScheduled).filter((d) => d != null);
  if (scheduled.length === 0) return null;
  const at = scheduled
    .map((d) => d.at)
    .filter((v): v is string => v != null)
    .sort()[0];
  return { at: at ?? null };
}

function rowAddedAt(r: MediaBrowseRow): number {
  return (
    r.plex_added_at ?? Math.floor(new Date(`${r.added_at.replace(" ", "T")}Z`).getTime() / 1000)
  );
}

function rowStatus(r: MediaBrowseRow): PlexBrowseItem["status"] {
  return r.plex_rating_key ? "in_library" : r.completed_at ? "processing" : "downloading";
}

export const getPlexLibraryBrowse = createServerFn({ method: "GET" }).handler(
  async (): Promise<
    { status: "ok"; items: PlexBrowseItem[] } | { status: "error"; error: string }
  > => {
    const { requireAuth } = await import("../auth/admin.server");
    const session = await requireAuth();
    try {
      const { getDb } = await import("../db");
      const db = getDb();

      // Doar conținut real: legat de Plex sau în curs de descărcare. Rândurile
      // 'tv_show' intră dacă au măcar un episod.
      const rows = db
        .prepare(
          `SELECT m.id, m.parent_id, m.plex_rating_key, m.media_type, m.title, m.original_title,
                  m.season, m.episode, m.poster_path, m.plex_added_at, m.added_at,
                  m.torrent_hash, m.completed_at, m.auto_download, m.delete_requested_at,
                  m.delete_scheduled_at
           FROM media m
           WHERE (
                   m.media_type IN ('movie', 'episode')
                   AND (m.torrent_hash IS NOT NULL OR m.plex_rating_key IS NOT NULL)
                 )
              OR (
                   m.media_type = 'tv_show'
                   AND EXISTS (SELECT 1 FROM media e WHERE e.parent_id = m.id)
                 )
           ORDER BY COALESCE(m.plex_added_at, CAST(strftime('%s', m.added_at) AS INTEGER)) DESC`,
        )
        .all() as unknown as MediaBrowseRow[];

      // Episoadele alimentează agregatele serialului; indexate pe parent_id și
      // pentru „cine a văzut” (Plex ține evidența per episod).
      const byId = new Map(rows.map((r) => [r.id, r]));
      const episodesByParent = new Map<number, MediaBrowseRow[]>();
      for (const r of rows) {
        if (r.media_type !== "episode" || r.parent_id == null) continue;
        const list = episodesByParent.get(r.parent_id);
        if (list) list.push(r);
        else episodesByParent.set(r.parent_id, [r]);
      }

      const items: PlexBrowseItem[] = [];
      for (const r of rows) {
        if (r.media_type === "episode") continue;
        if (r.media_type === "movie") {
          items.push({
            mediaId: r.id,
            ratingKey: r.plex_rating_key,
            title: r.title,
            type: "movie",
            show: null,
            originalTitle: r.original_title,
            thumbUrl: r.poster_path,
            addedAt: rowAddedAt(r),
            watchedByMe: false,
            watchedCount: 0,
            episodeCount: 0,
            seasonCount: 0,
            watchedEpisodes: 0,
            downloadingCount: 0,
            autoDownload: false,
            status: rowStatus(r),
            progress: null,
            dlspeed: null,
            eta: null,
            deleteScheduled: rowDeleteScheduled(r),
          });
          continue;
        }
        const episodes = episodesByParent.get(r.id) ?? [];
        if (episodes.length === 0) continue;
        const pending = episodes.filter((e) => rowStatus(e) !== "in_library");
        items.push({
          mediaId: r.id,
          ratingKey: null,
          // La seriale, `title` e deja titlul serialului.
          title: "",
          type: "tv_show",
          show: r.title,
          originalTitle:
            r.original_title ?? episodes.find((e) => e.original_title)?.original_title ?? null,
          // Posterul serialului, sau al primului episod (seriale vechi din backfill).
          thumbUrl: r.poster_path ?? episodes.find((e) => e.poster_path)?.poster_path ?? null,
          addedAt: Math.max(...episodes.map(rowAddedAt)),
          watchedByMe: false,
          watchedCount: 0,
          episodeCount: episodes.length,
          seasonCount: new Set(episodes.map((e) => e.season).filter((s) => s != null)).size,
          watchedEpisodes: 0,
          downloadingCount: pending.length,
          autoDownload: !!r.auto_download,
          // „În descărcare” cât măcar un episod n-a ajuns în Plex.
          status: pending.length > 0 ? "downloading" : "in_library",
          progress: null,
          dlspeed: null,
          eta: null,
          deleteScheduled: earliestDeleteScheduled(episodes),
        });
      }
      items.sort((a, b) => b.addedAt - a.addedAt);

      // O singură cerere qBittorrent pentru toate titlurile în descărcare; la
      // un serial, procentul e media episoadelor lui.
      const hashesByMediaId = new Map<number, string[]>();
      for (const item of items) {
        const source =
          item.type === "tv_show"
            ? (episodesByParent.get(item.mediaId) ?? [])
            : [byId.get(item.mediaId)!];
        const hashes = [
          ...new Set(
            source
              .filter((r) => r && !r.plex_rating_key && r.torrent_hash)
              .map((r) => r.torrent_hash!),
          ),
        ];
        if (hashes.length > 0) hashesByMediaId.set(item.mediaId, hashes);
      }
      if (hashesByMediaId.size > 0) {
        const progressByHash = await fetchQbitProgress([
          ...new Set([...hashesByMediaId.values()].flat()),
        ]);
        for (const item of items) {
          const infos = (hashesByMediaId.get(item.mediaId) ?? [])
            .map((h) => progressByHash.get(h))
            .filter((i) => i !== undefined);
          if (infos.length > 0) {
            const avg = infos.reduce((s, i) => s + i.progress, 0) / infos.length;
            item.progress = Math.round(avg * 1000) / 10;
            item.dlspeed = infos.reduce((s, i) => s + i.dlspeed, 0);
            item.eta = Math.max(...infos.map((i) => i.eta));
          }
        }
      }

      // „Am văzut” și „văzut de N”, din istoricul deja în cache, pentru toți
      // utilizatorii deodată.
      const { historyName: myHistoryName, plexUsername: myPlexUsername } = await myPlexIdentity(
        db,
        session.data.userId,
      );
      if (!myHistoryName) return { status: "ok", items };

      const { getAllPlexWatchedIndexes, isItemWatched } = await import("./plex");
      const allWatchedIndexes = await getAllPlexWatchedIndexes();

      // Potrivirea e per episod; la un serial, „văzut de N” = măcar un episod.
      const unitsFor = (it: PlexBrowseItem): MediaBrowseRow[] =>
        it.type === "tv_show" ? (episodesByParent.get(it.mediaId) ?? []) : [byId.get(it.mediaId)!];
      const matchOf = (r: MediaBrowseRow) => {
        const titleForMatch = r.original_title || r.title;
        return {
          ratingKey: r.plex_rating_key,
          title: titleForMatch,
          show: r.media_type === "episode" ? titleForMatch : null,
          season: r.season,
          episode: r.episode,
        };
      };

      const withWatched = items.map((it) => {
        const units = unitsFor(it).filter(Boolean);
        const matches = units.map(matchOf);
        let watchedCount = 0;
        let watchedByMe = false;
        let watchedEpisodes = 0;
        for (const [username, index] of Object.entries(allWatchedIndexes)) {
          const seen = matches.filter((m) => isItemWatched(index, m));
          if (seen.length === 0) continue;
          watchedCount += 1;
          if (username === myHistoryName) {
            watchedByMe = true;
            watchedEpisodes = seen.length;
          }
        }
        return { ...it, watchedByMe, watchedCount, watchedEpisodes };
      });

      // Rezerva „Marchează ca vizionat”, tot per episod.
      const ratingKeysByItem = new Map(
        withWatched.map((it) => [
          it.mediaId,
          unitsFor(it)
            .filter((r) => r?.plex_rating_key)
            .map((r) => r.plex_rating_key!),
        ]),
      );
      // Doar titlurile încă nevăzute integral — cheile merg într-un singur URL
      // către Plex, deci lista trebuie să rămână mărginită.
      const ownerViewedAt = await getOwnerViewedAtByRatingKey(
        myPlexUsername,
        withWatched
          .filter((it) => it.watchedEpisodes < (ratingKeysByItem.get(it.mediaId)?.length ?? 0))
          .flatMap((it) => ratingKeysByItem.get(it.mediaId) ?? [])
          .slice(0, 400),
      );
      if (ownerViewedAt.size > 0) {
        for (const it of withWatched) {
          const seen = (ratingKeysByItem.get(it.mediaId) ?? []).filter((k) => ownerViewedAt.has(k));
          if (seen.length === 0) continue;
          if (!it.watchedByMe) {
            it.watchedByMe = true;
            it.watchedCount += 1;
          }
          it.watchedEpisodes = Math.max(it.watchedEpisodes, seen.length);
        }
      }
      return { status: "ok", items: withWatched };
    } catch (e) {
      return { status: "error", error: e instanceof Error ? e.message : String(e) };
    }
  },
);

// ---------------------------------------------------------------------------
// Detalii complete pentru un titlu — la click pe un rând din listă
// ---------------------------------------------------------------------------

export interface ShowEpisodeEntry {
  mediaId: number;
  season: number | null;
  episode: number | null;
  // Null până ajunge completarea din TMDB — UI-ul arată atunci doar SxxEyy.
  episodeTitle: string | null;
  addedAt: number;
  status: "in_library" | "downloading" | "processing";
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
  hasRomanianAudio: boolean;
  summary: string | null;
  genres: string[];
  watchedByMe: boolean;
  watchedByMeAt: number | null;
  watchedByOthers: Array<{ username: string; viewedAt: number }>;
  addedByUsername: string | null;
  status: "in_library" | "downloading" | "processing";
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
  originalTitle: string | null;
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
  const completed = new Date(`${row.completed_at.replace(" ", "T")}Z`).getTime();
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
  // După fereastră, o aproximativă rămâne subtitrarea titlului.
  return missing
    ? { state: "ended", kind: "missing", until, lastCheckedAt: row.subtitle_checked_at }
    : null;
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
  const watchedByAll: Array<{ username: string; viewedAt: number }> = [];
  for (const [username, index] of Object.entries(allWatchedIndexes)) {
    // La serial: cea mai recentă vizionare, un rând per utilizator.
    const viewedAts = matchUnits
      .map((u) => getWatchedAt(index, u))
      .filter((v): v is number => v != null);
    if (viewedAts.length === 0) continue;
    watchedByAll.push({ username, viewedAt: Math.max(...viewedAts) });
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
        addedAt:
          e.plex_added_at ??
          Math.floor(new Date(`${e.added_at.replace(" ", "T")}Z`).getTime() / 1000),
        status: e.plex_rating_key ? "in_library" : e.completed_at ? "processing" : "downloading",
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
            ? Math.round(epProgress.get(e.torrent_hash)!.progress * 1000) / 10
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
    : row.plex_rating_key
      ? "in_library"
      : row.completed_at
        ? "processing"
        : "downloading";

  let progress: number | null = null;
  let dlspeed: number | null = null;
  let eta: number | null = null;
  if (!isShow && !row.plex_rating_key && row.torrent_hash) {
    const info = (await fetchQbitProgress([row.torrent_hash])).get(row.torrent_hash);
    if (info) {
      progress = Math.round(info.progress * 1000) / 10;
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
    addedAt: Math.floor(new Date(`${row.added_at.replace(" ", "T")}Z`).getTime() / 1000),
    durationMs: row.duration_ms ?? 0,
    year: row.year,
    quality: row.quality,
    hasRomanianSubtitle: !!row.has_romanian_subtitle,
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
    originalTitle: row.original_title,
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
           filelist_id, category_name, size, freeleech, internal, save_path, added_via,
           plex_rating_key, is_season_pack, requested_by_user_id, added_at, completed_at,
           subtitle_source, subtitle_detail, subtitle_report, subtitle_checked_at, subtitle_approximate, episode_title,
           episode_overview, episode_still, episode_air_date,
           tv_status, auto_download, auto_download_quality, auto_download_fallback_quality,
           auto_download_from, watch_last_checked_at,
           next_episode, next_episode_air_date, next_episode_airstamp
           FROM media WHERE id = ?`,
        )
        .get(data.mediaId) as MediaRow | undefined;
      if (!mediaRow) {
        return { status: "error", error: "Titlul nu a fost găsit" };
      }
      return { status: "ok", detail: await buildDetailFromMediaRow(mediaRow, session) };
    },
  );

// ---------------------------------------------------------------------------
// „Vizionări recente” (Acasă). Sursa e `recent_watch_cache`, care supraviețuiește
// ștergerii titlului; aici adăugăm vizionările noi din istoricul Plex, cât
// timp titlul mai e în `media`.
// ---------------------------------------------------------------------------

export type { RecentWatch } from "./recent-watch-types";
import type { RecentWatch } from "./recent-watch-types";
import { mergeConsecutiveEpisodes } from "./recent-watch-merge";

const RECENT_WATCH_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const RECENT_TITLES_LIMIT = 200;

export const getRecentWatches = createServerFn({ method: "GET" }).handler(
  async (): Promise<
    { status: "ok"; items: RecentWatch[] } | { status: "error"; error: string }
  > => {
    await (await import("../auth/admin.server")).requireAuth();
    try {
      const { getDb } = await import("../db");
      const db = getDb();

      const rows = db
        .prepare(
          `SELECT plex_rating_key, media_type, title, original_title, season, episode, poster_path
           FROM media
           WHERE media_type IN ('movie', 'episode')
             AND plex_rating_key IS NOT NULL
           ORDER BY added_at DESC
           LIMIT ?`,
        )
        .all(RECENT_TITLES_LIMIT) as unknown as Array<{
        plex_rating_key: string | null;
        media_type: string;
        title: string;
        original_title: string | null;
        season: number | null;
        episode: number | null;
        poster_path: string | null;
      }>;

      const cutoff = Math.floor(Date.now() / 1000) - RECENT_WATCH_WINDOW_SECONDS;

      // Recalculat doar cât titlul mai e în `media`; ținut minte în cache, ca
      // să rămână vizibil și după ștergere.
      if (rows.length > 0) {
        const { getAllPlexWatchedIndexes, getWatchedAt } = await import("./plex");
        const { createRecentWatchUpserter } = await import("./recent-watch-cache");
        const allWatchedIndexes = await getAllPlexWatchedIndexes();
        const upsert = createRecentWatchUpserter(db);
        for (const row of rows) {
          const isEpisode = row.media_type === "episode";
          const titleForMatch = row.original_title || row.title;
          for (const [username, index] of Object.entries(allWatchedIndexes)) {
            const viewedAt = getWatchedAt(index, {
              ratingKey: row.plex_rating_key,
              title: titleForMatch,
              show: isEpisode ? titleForMatch : null,
              season: row.season,
              episode: row.episode,
            });
            if (viewedAt == null || viewedAt < cutoff) continue;
            upsert({
              ratingKey: row.plex_rating_key!,
              username,
              title: isEpisode ? "" : row.title,
              show: isEpisode ? row.title : null,
              season: row.season,
              episode: row.episode,
              posterPath: row.poster_path,
              viewedAt,
              viewOffsetMs: null,
              durationMs: null,
              completed: true,
            });
          }
        }
      }

      const { plexThumbUrl } = await import("./recent-watch-cache");

      db.prepare("DELETE FROM recent_watch_cache WHERE viewed_at < ?").run(cutoff);
      const cached = db
        .prepare(
          `SELECT plex_rating_key, username, title, show, season, episode, poster_path, viewed_at,
                  view_offset_ms, duration_ms, completed
           FROM recent_watch_cache
           WHERE viewed_at >= ?
           ORDER BY viewed_at DESC
           LIMIT 100`,
        )
        .all(cutoff) as unknown as Array<{
        plex_rating_key: string;
        username: string;
        title: string;
        show: string | null;
        season: number | null;
        episode: number | null;
        poster_path: string | null;
        viewed_at: number;
        view_offset_ms: number | null;
        duration_ms: number | null;
        completed: number;
      }>;

      const items: RecentWatch[] = cached.map((row) => ({
        ratingKey: row.plex_rating_key,
        title: row.show ? "" : row.title,
        show: row.show,
        season: row.season,
        episode: row.episode,
        episodeEnd: null,
        completed: !!row.completed,
        progressMinutes:
          !row.completed && row.view_offset_ms != null
            ? Math.round(row.view_offset_ms / 60_000)
            : null,
        durationMinutes:
          !row.completed && row.duration_ms != null ? Math.round(row.duration_ms / 60_000) : null,
        // Trailerele n-au rând în `media` — miniatura din Plex, prin proxy-ul
        // autentificat (la citire, ca să acopere și rândurile vechi).
        thumbUrl: row.poster_path ?? plexThumbUrl(row.plex_rating_key),
        username: row.username,
        viewedAt: row.viewed_at,
      }));
      const merged = mergeConsecutiveEpisodes(items);
      merged.sort((a, b) => b.viewedAt - a.viewedAt);
      // Toată fereastra de 30 de zile (max 100); cardul arată 8 și desfășoară
      // restul la cerere.
      return { status: "ok", items: merged };
    } catch (e) {
      return { status: "error", error: e instanceof Error ? e.message : String(e) };
    }
  },
);
