// ---------------------------------------------------------------------------
// Bibliotecă — pentru secțiunea de pe Acasă care înlocuiește fostul "Recent
// adăugate": listă (ordonată după data adăugării) + detalii per titlu
// (calitate, subtitrare RO, cine a văzut, durată). Necesită autentificare
// (orice cont aprobat) — spre deosebire de restul paginii Acasă, care rămâne
// publică.
//
// Atât lista cât și detaliile sunt citite exclusiv din `media` (populată de
// wizard/Lansări/auto-download/backfill — vezi media.ts, media-backfill.ts):
// zero cereri Plex/TMDB live la navigare, indiferent câți utilizatori o
// deschid simultan. Un titlu care nu e nici fixat, nici descărcat prin
// aplicație nu apare — vezi media-backfill.ts pentru restul bibliotecii deja
// existente în Plex înainte de acest sistem.
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";

export interface PlexBrowseItem {
  // Identificator stabil, mereu prezent (id-ul rândului din `media`) —
  // folosit pentru selecție/detalii; ratingKey lipsește pentru titluri încă
  // nedescărcate complet (fixate) sau neindexate încă de Plex (în curs de
  // descărcare).
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
  // "downloading" — are torrent, dar Plex nu l-a indexat încă; "pinned" —
  // doar fixat pentru urmărire, nimic descărcat; "in_library" — normal,
  // deja în Plex.
  status: "in_library" | "downloading" | "pinned";
}

const BROWSE_LIMIT = 300;

interface MediaBrowseRow {
  id: number;
  plex_rating_key: string | null;
  media_type: string;
  title: string;
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
    const { requireAuth } = await import("../admin.server");
    const session = await requireAuth();
    try {
      const { getDb } = await import("../db");
      const db = getDb();

      // Bibliotecă arată doar ce e "al meu" — deja confirmat în Plex
      // (plex_rating_key cunoscut, indiferent de sursă: descărcat prin
      // aplicație SAU backfill din restul bibliotecii), în curs de
      // descărcare (torrent_hash cunoscut, încă neindexat de Plex), sau
      // fixat pentru urmărire (potrivire cu pinned_items) — nu orice titlu
      // doar căutat prin wizard, altfel lista s-ar umple de căutări
      // întâmplătoare. Un serial fixat cu episoade deja descărcate arată
      // doar prin episoadele lui (rândul-părinte gol e exclus explicit), ca
      // să nu apară dublu.
      const rows = db
        .prepare(
          `SELECT m.id, m.plex_rating_key, m.media_type, m.title, m.season, m.episode,
                  m.poster_path, m.plex_added_at, m.added_at, m.torrent_hash
           FROM media m
           WHERE
             (
               m.media_type IN ('movie', 'episode')
               AND (m.torrent_hash IS NOT NULL OR m.plex_rating_key IS NOT NULL)
             )
             OR (
               m.media_type IN ('movie', 'tv_show')
               AND EXISTS (
                 SELECT 1 FROM pinned_items p
                 WHERE p.id = m.tmdb_id
                   AND p.media_type = CASE m.media_type WHEN 'movie' THEN 'movie' ELSE 'tv' END
               )
               AND (
                 m.media_type != 'tv_show'
                 OR NOT EXISTS (SELECT 1 FROM media c WHERE c.parent_id = m.id)
               )
             )
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
          // titlul serialului (nu se ține un titlu separat per episod) —
          // vezi media.ts/media-backfill.ts.
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
          status: r.plex_rating_key ? "in_library" : r.torrent_hash ? "downloading" : "pinned",
        };
      });

      // "Am văzut" — badge afișat direct în listă, fără cost suplimentar (nicio
      // cerere nouă către Plex): potrivim doar cu istoricul deja cachuit.
      const me = db
        .prepare("SELECT plex_username FROM users WHERE id = ?")
        .get(session.data.userId!) as { plex_username: string | null } | undefined;
      const myPlexUsername = me?.plex_username ?? null;
      if (!myPlexUsername) return { status: "ok", items };

      const { getPlexUserHistory } = await import("./plex");
      const myHistory = await getPlexUserHistory(myPlexUsername);
      const watchedKeys = new Set(
        myHistory.map((e) => (e.show ? `${e.show}|${e.season}|${e.episode}` : `movie|${e.title}`)),
      );
      const withWatched = items.map((it) => ({
        ...it,
        watchedByMe: watchedKeys.has(
          it.type === "episode" ? `${it.show}|${it.season}|${it.episode}` : `movie|${it.title}`,
        ),
      }));
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
  quality: string | null;
  hasRomanianSubtitle: boolean;
  summary: string | null;
  genres: string[];
  watchedByMe: boolean;
  watchedByOthers: Array<{ username: string; viewedAt: number }>;
  addedByUsername: string | null;
  status: "in_library" | "downloading" | "pinned";
  // Intrarea corespunzătoare din jurnalul propriu de descărcări — necesară
  // pentru butoanele de corectare/ștergere subtitrare și ștergere completă a
  // titlului, care operează pe jurnal + qBittorrent, nu direct pe Plex.
  // Absentă pentru titluri doar fixate, fără nimic descărcat încă.
  downloadsLogId: number | null;
  torrentHash: string | null;
  // true dacă intrarea găsită e un pachet de sezon întreg, nu doar acest
  // episod — ștergerea/corectarea ar afecta atunci tot pachetul.
  isSeasonPack: boolean;
  // true doar pentru cel care a adăugat titlul sau pentru un admin — UI-ul
  // ascunde butoanele de subtitrare/ștergere pentru oricine altcineva.
  canManage: boolean;
}

interface MediaRow {
  id: number;
  media_type: string;
  title: string;
  season: number | null;
  episode: number | null;
  poster_path: string | null;
  overview_ro: string | null;
  genres: string;
  quality: string | null;
  has_romanian_subtitle: number;
  duration_ms: number | null;
  torrent_hash: string | null;
  plex_rating_key: string | null;
  is_season_pack: number;
  requested_by_user_id: number | null;
  added_at: string;
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
  const { isAdminOrOwner } = await import("../admin.server");
  const db = getDb();

  const isEpisode = row.media_type === "episode";
  const isShow = row.media_type === "tv_show";

  const { getAllPlexUserHistory } = await import("./plex");
  const matchesItem = (e: { title: string; show?: string; season?: number; episode?: number }) =>
    isEpisode
      ? e.show === row.title && e.season === row.season && e.episode === row.episode
      : !isShow && !e.show && e.title === row.title;
  const allHistory = isShow ? {} : await getAllPlexUserHistory();
  const watchedByAll: Array<{ username: string; viewedAt: number }> = [];
  for (const [username, entries] of Object.entries(allHistory)) {
    const match = entries.find(matchesItem);
    if (match) watchedByAll.push({ username, viewedAt: match.viewedAt });
  }
  const me = session.data.userId
    ? (db.prepare("SELECT plex_username FROM users WHERE id = ?").get(session.data.userId) as
        { plex_username: string | null } | undefined)
    : undefined;
  const myPlexUsername = me?.plex_username ?? null;
  const watchedByMe = myPlexUsername
    ? watchedByAll.some((w) => w.username === myPlexUsername)
    : false;
  const watchedByOthers = watchedByAll.filter((w) => w.username !== myPlexUsername);

  let addedByUsername: string | null = null;
  if (row.requested_by_user_id != null) {
    const u = db
      .prepare("SELECT username FROM users WHERE id = ?")
      .get(row.requested_by_user_id) as { username: string } | undefined;
    addedByUsername = u?.username ?? null;
  }

  // torrent_hash e cunoscut direct — nu mai e nevoie de potrivirea prin
  // IMDb id + regex pe numele lansării (findDownloadsRowForImdb), doar un
  // lookup exact.
  let downloadsLogId: number | null = null;
  if (row.torrent_hash) {
    const d = db
      .prepare("SELECT id FROM downloads WHERE torrent_hash = ?")
      .get(row.torrent_hash) as { id: number } | undefined;
    downloadsLogId = d?.id ?? null;
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
    quality: row.quality,
    hasRomanianSubtitle: !!row.has_romanian_subtitle,
    summary: row.overview_ro,
    genres: JSON.parse(row.genres || "[]"),
    watchedByMe,
    watchedByOthers,
    addedByUsername,
    status: row.plex_rating_key ? "in_library" : row.torrent_hash ? "downloading" : "pinned",
    downloadsLogId,
    torrentHash: row.torrent_hash,
    isSeasonPack: !!row.is_season_pack,
    canManage: isAdminOrOwner(session, row.requested_by_user_id),
  };
}

export const getPlexTitleDetail = createServerFn({ method: "GET" })
  .validator((data: { mediaId: number }) => data)
  .handler(
    async ({
      data,
    }): Promise<{ status: "ok"; detail: PlexTitleDetail } | { status: "error"; error: string }> => {
      const { requireAuth } = await import("../admin.server");
      const session = await requireAuth();

      const { getDb } = await import("../db");
      const mediaRow = getDb()
        .prepare(
          `SELECT id, media_type, title, season, episode, poster_path, overview_ro, genres,
           quality, has_romanian_subtitle, duration_ms, torrent_hash, plex_rating_key,
           is_season_pack, requested_by_user_id, added_at
           FROM media WHERE id = ?`,
        )
        .get(data.mediaId) as MediaRow | undefined;
      if (!mediaRow) {
        return { status: "error", error: "Titlul nu a fost găsit" };
      }
      return { status: "ok", detail: await buildDetailFromMediaRow(mediaRow, session) };
    },
  );
