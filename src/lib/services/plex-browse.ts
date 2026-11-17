// ---------------------------------------------------------------------------
// Biblioteca: lista (după data adăugării), pentru orice cont aprobat; fișa
// unui titlu e în plex-title-detail.ts. Citită exclusiv din `media` — zero
// cereri Plex/TMDB la navigare; singurul lucru live e „cine a văzut”
// (istoricul Plex, în cache).
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";
import {
  fetchQbitProgress,
  getOwnerViewedAtByRatingKey,
  myPlexIdentity,
  progressPercent,
  rowAddedAt,
  rowDeleteScheduled,
  rowStatus,
  type MediaStatus,
} from "./plex-browse-shared";

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
  status: MediaStatus;
  // Progresul din qBittorrent, doar la "downloading"; null dacă torrentul nu
  // mai e acolo sau qBittorrent nu răspunde.
  progress: number | null; // 0-100
  dlspeed: number | null; // bytes/s
  eta: number | null; // secunde
  // Ștergere programată: termenul (SQLite, UTC; null = la 48 h după
  // finalizare). La seriale, cel mai apropiat.
  deleteScheduled: { at: string | null } | null;
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
            item.progress = progressPercent(
              infos.reduce((s, i) => s + i.progress, 0) / infos.length,
            );
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
