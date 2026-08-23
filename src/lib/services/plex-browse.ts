// ---------------------------------------------------------------------------
// Bibliotecă — pentru secțiunea de pe Acasă care înlocuiește fostul "Recent
// adăugate": listă (ordonată după data adăugării) + detalii per titlu
// (calitate, subtitrare RO, cine a văzut, durată). Necesită autentificare
// (orice cont aprobat) — spre deosebire de restul paginii Acasă, care rămâne
// publică.
//
// Atât lista cât și detaliile sunt citite exclusiv din `media` (populată
// doar de wizard/căutarea manuală Filelist — vezi media.ts): zero cereri
// Plex/TMDB live la navigare, indiferent câți utilizatori o deschid
// simultan. Un titlu care nu e adăugat prin aplicație nu apare deloc în
// Bibliotecă (nu mai există backfill retroactiv din Plex).
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";

export interface PlexBrowseItem {
  // Identificator stabil, mereu prezent (id-ul rândului din `media`) —
  // folosit pentru selecție/detalii; ratingKey lipsește pentru titluri
  // neindexate încă de Plex (în curs de descărcare).
  mediaId: number;
  ratingKey: string | null;
  title: string;
  type: "movie" | "episode" | "tv_show";
  show: string | null;
  season: number | null;
  episode: number | null;
  // Gata de folosit direct ca src de <img> — link TMDB, salvat în `media`.
  thumbUrl: string | null;
  addedAt: number;
  watchedByMe: boolean;
  // Câți utilizatori distincți (din conturile Plex mapate la conturi
  // FaikkitBox) au vizionat titlul — afișat ca badge separat în listă.
  watchedCount: number;
  // "downloading" — are torrent, dar Plex nu l-a indexat încă; "in_library"
  // — normal, deja în Plex.
  status: "in_library" | "downloading";
  // Progres live din qBittorrent — populate doar pentru status "downloading"
  // cu torrent_hash cunoscut; null dacă torrentul nu mai e găsit acolo
  // (ex. șters manual) sau qBit nu e configurat/disponibil.
  progress: number | null; // 0-100
  dlspeed: number | null; // bytes/s
  eta: number | null; // secunde
}

// ---------------------------------------------------------------------------
// Progres live qBittorrent — un singur request cu toate hash-urile relevante,
// reutilizat atât de listă cât și de detalii (vezi qbit-client.ts pentru
// autentificarea cu cookie SID + retry).
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
    const res = await qbitGet(
      url,
      `/api/v2/torrents/info?hashes=${hashes.join("|")}`,
      user,
      pass,
    );
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
    // qBit indisponibil — badge-ul rămâne fără procent, nu blocăm lista.
  }
  return result;
}

const BROWSE_LIMIT = 300;

// Fallback pentru "Marchează ca vizionat" din Plex (setează viewCount pe
// item, dar NU scrie o intrare de istoric/scrobble — invizibil pentru
// PlexWatchedIndex, oricât de bine ar potrivi ratingKey-ul). Sigur doar
// pentru owner-ul serverului (singurul cont ale cărui viewCount-uri sunt
// reflectate corect de PLEX_TOKEN) — vezi getPlexOwnerUsername în plex.ts.
// Un singur loc, folosit identic de listă și de drawer.
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

interface MediaBrowseRow {
  id: number;
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

      // Bibliotecă arată doar conținut real: deja confirmat în Plex
      // (plex_rating_key cunoscut, indiferent de sursă: descărcat prin
      // aplicație SAU backfill din restul bibliotecii), sau în curs de
      // descărcare (torrent_hash cunoscut, încă neindexat de Plex).
      const rows = db
        .prepare(
          `SELECT m.id, m.plex_rating_key, m.media_type, m.title, m.original_title, m.season, m.episode,
                  m.poster_path, m.plex_added_at, m.added_at, m.torrent_hash
           FROM media m
           WHERE m.media_type IN ('movie', 'episode')
             AND (m.torrent_hash IS NOT NULL OR m.plex_rating_key IS NOT NULL)
           ORDER BY COALESCE(m.plex_added_at, CAST(strftime('%s', m.added_at) AS INTEGER)) DESC
           LIMIT ?`,
        )
        .all(BROWSE_LIMIT) as unknown as MediaBrowseRow[];

      const items: PlexBrowseItem[] = rows.map((r) => {
        const isEpisodeLike = r.media_type === "episode";
        return {
          mediaId: r.id,
          ratingKey: r.plex_rating_key,
          // Pentru episoade/seriale, `title` pe rândul din `media` e deja
          // titlul serialului (nu se ține un titlu separat per episod).
          title: isEpisodeLike || r.media_type === "tv_show" ? "" : r.title,
          type:
            r.media_type === "episode"
              ? "episode"
              : r.media_type === "tv_show"
                ? "tv_show"
                : "movie",
          show: isEpisodeLike || r.media_type === "tv_show" ? r.title : null,
          season: r.season,
          episode: r.episode,
          thumbUrl: r.poster_path,
          addedAt:
            r.plex_added_at ??
            Math.floor(new Date(`${r.added_at.replace(" ", "T")}Z`).getTime() / 1000),
          watchedByMe: false,
          watchedCount: 0,
          status: r.plex_rating_key ? "in_library" : "downloading",
          progress: null,
          dlspeed: null,
          eta: null,
        };
      });

      // Progres live: un singur request către qBit cu toate hash-urile
      // titlurilor încă în descărcare, nu unul per titlu.
      const hashByMediaId = new Map(
        rows.filter((r) => !r.plex_rating_key && r.torrent_hash).map((r) => [r.id, r.torrent_hash!]),
      );
      if (hashByMediaId.size > 0) {
        const progressByHash = await fetchQbitProgress([...new Set(hashByMediaId.values())]);
        for (const item of items) {
          const hash = hashByMediaId.get(item.mediaId);
          const info = hash ? progressByHash.get(hash) : undefined;
          if (info) {
            item.progress = Math.round(info.progress * 1000) / 10;
            item.dlspeed = info.dlspeed;
            item.eta = info.eta;
          }
        }
      }

      // "Am văzut" + "văzut de N" — badge-uri afișate direct în listă, fără
      // cost suplimentar (nicio cerere nouă către Plex): potrivim doar cu
      // istoricul deja cachuit, pentru toți utilizatorii deodată.
      const me = db
        .prepare("SELECT plex_username FROM users WHERE id = ?")
        .get(session.data.userId!) as { plex_username: string | null } | undefined;
      const myPlexUsername = me?.plex_username ?? null;
      if (!myPlexUsername) return { status: "ok", items };

      const { getAllPlexWatchedIndexes, isItemWatched } = await import("./plex");
      const allWatchedIndexes = await getAllPlexWatchedIndexes();
      const originalTitleById = new Map(rows.map((r) => [r.id, r.original_title || r.title]));
      const withWatched = items.map((it) => {
        const titleForMatch = originalTitleById.get(it.mediaId) ?? it.title;
        const matchItem = {
          ratingKey: it.ratingKey,
          title: titleForMatch,
          show: it.type === "episode" ? titleForMatch : null,
          season: it.season,
          episode: it.episode,
        };
        let watchedCount = 0;
        let watchedByMe = false;
        for (const [username, index] of Object.entries(allWatchedIndexes)) {
          if (!isItemWatched(index, matchItem)) continue;
          watchedCount += 1;
          if (username === myPlexUsername) watchedByMe = true;
        }
        return { ...it, watchedByMe, watchedCount };
      });

      const ownerViewedAt = await getOwnerViewedAtByRatingKey(
        myPlexUsername,
        withWatched.filter((it) => !it.watchedByMe && it.ratingKey).map((it) => it.ratingKey as string),
      );
      for (const it of withWatched) {
        if (it.ratingKey && ownerViewedAt.has(it.ratingKey) && !it.watchedByMe) {
          it.watchedByMe = true;
          it.watchedCount += 1;
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

export interface PlexTitleDetail {
  mediaId: number;
  ratingKey: string | null;
  title: string;
  type: "movie" | "episode" | "tv_show";
  show: string | null;
  season: number | null;
  episode: number | null;
  // Gata de folosit direct ca src de <img> — link TMDB, salvat în `media`.
  thumbUrl: string | null;
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
  status: "in_library" | "downloading";
  // Progres live din qBittorrent — vezi PlexBrowseItem.
  progress: number | null;
  dlspeed: number | null;
  eta: number | null;
  // Butoanele de corectare/ștergere subtitrare și ștergere completă operează
  // direct pe media.id + torrentHash.
  torrentHash: string | null;
  // true dacă intrarea găsită e un pachet de sezon întreg, nu doar acest
  // episod — ștergerea/corectarea ar afecta atunci tot pachetul.
  isSeasonPack: boolean;
  // true doar pentru cel care a adăugat titlul sau pentru un admin — UI-ul
  // ascunde butoanele de subtitrare/ștergere pentru oricine altcineva.
  canManage: boolean;
  tmdbId: number | null;
  originalTitle: string | null;
  // Vizibil pentru toți (nu doar admin, spre deosebire de tech.imdbId) —
  // folosit direct pentru butonul de link către IMDb.
  imdbId: string | null;
  // Detalii tehnice — populate doar pentru admin (vezi isAdminOrOwner mai
  // jos); UI-ul le ascunde complet pentru restul utilizatorilor.
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
    subtitleCheckedAt: string | null;
    plexRatingKey: string | null;
  } | null;
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
  subtitle_checked_at: string | null;
}

// Orice titlu clicabil din Bibliotecă are un rând `media` (lista provine
// exclusiv de-acolo) — răspunsul e mereu doar SELECT-uri, fără nicio cerere
// Plex/TMDB live. Singurul lucru încă live e "cine a văzut" (istoricul Plex,
// cache-uit separat 60s) — n-are sens duplicat static, s-ar dezactualiza la
// fiecare vizionare nouă.
async function buildDetailFromMediaRow(
  row: MediaRow,
  session: { data: { userId?: number; admin?: boolean } },
): Promise<PlexTitleDetail> {
  const { getDb } = await import("../db");
  const { isAdminOrOwner } = await import("../auth/admin.server");
  const db = getDb();

  const isEpisode = row.media_type === "episode";
  const isShow = row.media_type === "tv_show";

  const me = session.data.userId
    ? (db.prepare("SELECT plex_username FROM users WHERE id = ?").get(session.data.userId) as
        { plex_username: string | null } | undefined)
    : undefined;
  const myPlexUsername = me?.plex_username ?? null;

  const { getAllPlexWatchedIndexes, getWatchedAt } = await import("./plex");
  const titleForMatch = row.original_title || row.title;
  const allWatchedIndexes = isShow ? {} : await getAllPlexWatchedIndexes();
  const watchedByAll: Array<{ username: string; viewedAt: number }> = [];
  for (const [username, index] of Object.entries(allWatchedIndexes)) {
    const viewedAt = getWatchedAt(index, {
      ratingKey: row.plex_rating_key,
      title: titleForMatch,
      show: isEpisode ? titleForMatch : null,
      season: row.season,
      episode: row.episode,
    });
    if (viewedAt == null) continue;
    watchedByAll.push({ username, viewedAt });
  }

  if (!isShow && row.plex_rating_key && !watchedByAll.some((w) => w.username === myPlexUsername)) {
    const ownerViewedAt = await getOwnerViewedAtByRatingKey(myPlexUsername, [row.plex_rating_key]);
    const lastViewedAt = ownerViewedAt.get(row.plex_rating_key);
    if (lastViewedAt != null && myPlexUsername) {
      watchedByAll.push({ username: myPlexUsername, viewedAt: lastViewedAt });
    }
  }
  const myWatched = myPlexUsername
    ? watchedByAll.find((w) => w.username === myPlexUsername)
    : undefined;
  const watchedByMe = !!myWatched;
  const watchedByMeAt = myWatched && myWatched.viewedAt > 0 ? myWatched.viewedAt : null;
  const watchedByOthers = watchedByAll.filter((w) => w.username !== myPlexUsername);

  const canManage = isAdminOrOwner(session, row.requested_by_user_id);
  const isAdmin = !!session.data.admin;

  let progress: number | null = null;
  let dlspeed: number | null = null;
  let eta: number | null = null;
  if (!row.plex_rating_key && row.torrent_hash) {
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
    title: isEpisode || isShow ? "" : row.title,
    type: isEpisode ? "episode" : isShow ? "tv_show" : "movie",
    show: isEpisode || isShow ? row.title : null,
    season: row.season,
    episode: row.episode,
    thumbUrl: row.poster_path,
    addedAt: Math.floor(new Date(`${row.added_at.replace(" ", "T")}Z`).getTime() / 1000),
    durationMs: row.duration_ms ?? 0,
    year: row.year,
    quality: row.quality,
    hasRomanianSubtitle: !!row.has_romanian_subtitle,
    hasRomanianAudio: !!row.has_romanian_audio,
    summary: row.overview_ro,
    genres: JSON.parse(row.genres || "[]"),
    watchedByMe,
    watchedByMeAt,
    watchedByOthers,
    addedByUsername,
    status: row.plex_rating_key ? "in_library" : "downloading",
    progress,
    dlspeed,
    eta,
    torrentHash: row.torrent_hash,
    isSeasonPack: !!row.is_season_pack,
    canManage,
    tmdbId: row.tmdb_id,
    originalTitle: row.original_title,
    imdbId: row.imdb_id,
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
           category_name, size, freeleech, internal, save_path, added_via,
           plex_rating_key, is_season_pack, requested_by_user_id, added_at, completed_at,
           subtitle_source, subtitle_detail, subtitle_checked_at
           FROM media WHERE id = ?`,
        )
        .get(data.mediaId) as MediaRow | undefined;
      if (!mediaRow) {
        return { status: "error", error: "Titlul nu a fost găsit" };
      }
      return { status: "ok", detail: await buildDetailFromMediaRow(mediaRow, session) };
    },
  );
