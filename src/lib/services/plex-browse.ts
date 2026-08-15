// ---------------------------------------------------------------------------
// Bibliotecă Plex completă, răsfoibilă — pentru secțiunea de pe Acasă care
// înlocuiește fostul "Recent adăugate": listă (ordonată după data adăugării)
// + detalii per titlu (calitate, subtitrare RO, cine a văzut, durată).
// Necesită autentificare (orice cont aprobat) — spre deosebire de restul
// paginii Acasă, care rămâne publică.
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";
import { fetchJson } from "./shared";
import {
  discoverPlexUrl,
  plexQualityFromMedia,
  type PlexApiResponse,
  type PlexMetadataItem,
} from "./plex-shared";
import { ROMANIAN_LANG_CODES } from "../filelist/subtitles";

export interface PlexBrowseItem {
  ratingKey: string;
  title: string;
  type: "movie" | "episode";
  show: string | null;
  season: number | null;
  episode: number | null;
  thumb: string | null;
  addedAt: number;
  watchedByMe: boolean;
}

interface PlexDirectoryLike {
  key?: string;
  type?: string;
}

const BROWSE_LIMIT = 300;
const BROWSE_TTL_MS = 3 * 60_000;
let browseCache: { url: string; items: PlexBrowseItem[]; expiresAt: number } | null = null;

async function fetchBrowseItems(): Promise<PlexBrowseItem[]> {
  const token = process.env.PLEX_TOKEN;
  if (!token) return [];
  const { url } = await discoverPlexUrl(token, process.env.PLEX_URL);
  if (browseCache && browseCache.url === url && browseCache.expiresAt > Date.now()) {
    return browseCache.items;
  }
  const headers = { Accept: "application/json", "X-Plex-Token": token };

  const libsJson = await fetchJson<PlexApiResponse>(`${url}/library/sections`, { headers });
  const libsMd = libsJson?.MediaContainer?.Directory ?? [];
  const movieLibKeys = libsMd
    .filter((l: PlexDirectoryLike) => l.type === "movie")
    .map((l) => l.key);
  const showLibKeys = libsMd.filter((l: PlexDirectoryLike) => l.type === "show").map((l) => l.key);

  const [moviesJson, episodesJson] = await Promise.all([
    movieLibKeys.length > 0
      ? fetchJson<PlexApiResponse>(
          `${url}/library/sections/${movieLibKeys[0]}/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=${BROWSE_LIMIT}&type=1`,
          { headers },
        ).catch(() => ({ MediaContainer: { Metadata: [] } }))
      : Promise.resolve({ MediaContainer: { Metadata: [] } }),
    showLibKeys.length > 0
      ? fetchJson<PlexApiResponse>(
          `${url}/library/sections/${showLibKeys[0]}/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=${BROWSE_LIMIT}&type=4`,
          { headers },
        ).catch(() => ({ MediaContainer: { Metadata: [] } }))
      : Promise.resolve({ MediaContainer: { Metadata: [] } }),
  ]);

  const merged: PlexMetadataItem[] = [
    ...(moviesJson?.MediaContainer?.Metadata ?? []),
    ...(episodesJson?.MediaContainer?.Metadata ?? []),
  ]
    .sort((a, b) => Number(b.addedAt ?? 0) - Number(a.addedAt ?? 0))
    .slice(0, BROWSE_LIMIT);

  const items: PlexBrowseItem[] = merged.map((m) => ({
    ratingKey: String(m.ratingKey ?? ""),
    title: String(m.title ?? "—"),
    type: m.type === "episode" ? "episode" : "movie",
    show: m.grandparentTitle ?? null,
    season: m.parentIndex ?? null,
    episode: m.index ?? null,
    thumb: m.thumb ?? null,
    addedAt: Number(m.addedAt ?? 0),
    watchedByMe: false,
  }));

  browseCache = { url, items, expiresAt: Date.now() + BROWSE_TTL_MS };
  return items;
}

export const getPlexLibraryBrowse = createServerFn({ method: "GET" }).handler(
  async (): Promise<
    { status: "ok"; items: PlexBrowseItem[] } | { status: "error"; error: string }
  > => {
    const { requireAuth } = await import("../admin.server");
    const session = await requireAuth();
    try {
      const items = await fetchBrowseItems();

      // "Am văzut" — badge afișat direct în listă, fără cost suplimentar (nicio
      // cerere nouă către Plex): potrivim doar cu istoricul deja cachuit.
      const { getDb } = await import("../db");
      const me = getDb()
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
  ratingKey: string;
  title: string;
  type: "movie" | "episode";
  show: string | null;
  season: number | null;
  episode: number | null;
  thumb: string | null;
  addedAt: number;
  durationMs: number;
  quality: string | null;
  hasRomanianSubtitle: boolean;
  summary: string | null;
  genres: string[];
  watchedByMe: boolean;
  watchedByOthers: Array<{ username: string; viewedAt: number }>;
  addedByUsername: string | null;
  // Intrarea corespunzătoare din jurnalul propriu de descărcări (dacă am
  // găsit una, potrivită prin IMDb id rezolvat via TMDB) — necesară pentru
  // butoanele de corectare/ștergere subtitrare și ștergere completă a
  // titlului, care operează pe jurnal + qBittorrent, nu direct pe Plex.
  // Absentă pentru titluri adăugate manual în Plex sau dinainte de jurnal.
  downloadsLogId: number | null;
  torrentHash: string | null;
  // true dacă intrarea găsită e un pachet de sezon întreg, nu doar acest
  // episod — ștergerea/corectarea ar afecta atunci tot pachetul.
  isSeasonPack: boolean;
  // true doar pentru cel care a adăugat titlul sau pentru un admin — UI-ul
  // ascunde butoanele de subtitrare/ștergere pentru oricine altcineva.
  canManage: boolean;
}

function isRomanianStream(s: { language?: string; languageCode?: string }): boolean {
  const code = (s.languageCode ?? "").toLowerCase();
  const lang = (s.language ?? "").toLowerCase();
  return ROMANIAN_LANG_CODES.includes(code) || lang.includes("roman");
}

// Tot ce nu depinde de userul curent — partajat între toți, cache 1 min. Doar
// watchedByMe/watchedByOthers/canManage se calculează per-request (ieftin,
// fără nicio cerere nouă), din watchedByAll + requestedByUserId cache-uite.
type PlexTitleDetailBase = Omit<
  PlexTitleDetail,
  "watchedByMe" | "watchedByOthers" | "canManage"
> & {
  watchedByAll: Array<{ username: string; viewedAt: number }>;
  requestedByUserId: number | null;
};

const DETAIL_TTL_MS = 60_000;
const detailCache = new Map<string, { expiresAt: number; base: PlexTitleDetailBase }>();

// Apelat după corectare/ștergere subtitrare sau ștergere titlu (Bibliotecă),
// ca schimbarea să fie vizibilă imediat, nu abia după expirarea cache-ului
// de 1 minut de mai sus.
export function invalidatePlexTitleDetailCache(ratingKey: string): void {
  detailCache.delete(ratingKey);
}

async function computeTitleDetailBase(
  ratingKey: string,
): Promise<{ status: "ok"; base: PlexTitleDetailBase } | { status: "error"; error: string }> {
  const token = process.env.PLEX_TOKEN;
  if (!token) return { status: "error", error: "PLEX_TOKEN nu este configurat" };

  try {
    const { url } = await discoverPlexUrl(token, process.env.PLEX_URL);
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const json = await fetchJson<PlexApiResponse>(
      `${url}/library/metadata/${encodeURIComponent(ratingKey)}`,
      { headers },
    );
    const item = json?.MediaContainer?.Metadata?.[0];
    if (!item) return { status: "error", error: "Titlul nu a fost găsit în Plex" };

    const media = item.Media?.[0];
    const quality = plexQualityFromMedia(media);
    const streams = media?.Part?.[0]?.Stream ?? [];
    const hasRomanianSubtitle = streams.some((s) => s.streamType === 3 && isRomanianStream(s));

    // "Cine a văzut" — din istoricul cachuit (aceeași sursă ca restul Acasă),
    // potrivit după titlu (filme) sau serial+sezon+episod (episoade), nu
    // ratingKey — istoricul Plex nu-l reține per intrare.
    const { getAllPlexUserHistory } = await import("./plex");
    const { getDb } = await import("../db");
    const db = getDb();

    const isEpisode = item.type === "episode";
    const matchesItem = (e: { title: string; show?: string; season?: number; episode?: number }) =>
      isEpisode
        ? e.show === item.grandparentTitle &&
          e.season === item.parentIndex &&
          e.episode === item.index
        : !e.show && e.title === item.title;

    const allHistory = await getAllPlexUserHistory();
    const watchedByAll: Array<{ username: string; viewedAt: number }> = [];
    for (const [username, entries] of Object.entries(allHistory)) {
      // Fiecare listă e deja sortată descrescător după viewedAt — primul
      // rezultat potrivit e cea mai recentă vizionare a userului respectiv.
      const match = entries.find(matchesItem);
      if (match) watchedByAll.push({ username, viewedAt: match.viewedAt });
    }

    // Genuri + rezumat RO + IMDb id — via TMDB, pornind de la titlul din
    // Plex (nu de la Guid-ul Plex, care nu conține fiabil un IMDb id).
    const { searchTmdbTopResultInternal, getTmdbDetailsInternal, getTmdbEpisodeOverviewInternal } =
      await import("../tmdb.functions");
    const searchType: "movie" | "tv" = isEpisode ? "tv" : "movie";
    const searchTitle = isEpisode ? (item.grandparentTitle ?? item.title) : item.title;
    const searchYear =
      !isEpisode && (item.year || item.originallyAvailableAt)
        ? (item.year ?? Number(item.originallyAvailableAt!.slice(0, 4)))
        : null;

    let genres: string[] = [];
    let overviewRo: string | null = null;
    let imdbId: string | null = null;
    const tmdbId = await searchTmdbTopResultInternal(
      String(searchTitle ?? ""),
      searchType,
      searchYear,
    );
    if (tmdbId) {
      const tmdbDetails = await getTmdbDetailsInternal(tmdbId, searchType);
      genres = tmdbDetails.genres;
      imdbId = tmdbDetails.imdbId;
      overviewRo = tmdbDetails.overview;
      if (isEpisode && item.parentIndex != null && item.index != null) {
        const epOverview = await getTmdbEpisodeOverviewInternal(
          tmdbId,
          item.parentIndex,
          item.index,
        );
        if (epOverview) overviewRo = epOverview;
      }
    }

    // Intrarea din jurnalul propriu — necesară pentru butoanele de
    // subtitrare/ștergere titlu (operează pe torrent_hash, nu pe Plex).
    let downloadsLogId: number | null = null;
    let torrentHash: string | null = null;
    let isSeasonPack = false;
    let requestedByUserId: number | null = null;
    if (imdbId) {
      const { findDownloadsRowForImdb } = await import("../filelist/log");
      const match = await findDownloadsRowForImdb(
        imdbId,
        isEpisode && item.parentIndex != null && item.index != null
          ? { season: item.parentIndex, episode: item.index }
          : undefined,
      );
      if (match) {
        downloadsLogId = match.id;
        torrentHash = match.torrentHash;
        isSeasonPack = match.isSeasonPack;
        requestedByUserId = match.requestedByUserId;
      }
    }

    let addedByUsername: string | null = null;
    if (downloadsLogId != null) {
      const row = db
        .prepare(
          `SELECT u.username FROM downloads d
           JOIN users u ON u.id = d.requested_by_user_id
           WHERE d.id = ?`,
        )
        .get(downloadsLogId) as { username: string } | undefined;
      addedByUsername = row?.username ?? null;
    }

    return {
      status: "ok",
      base: {
        ratingKey,
        title: String(item.title ?? "—"),
        type: isEpisode ? "episode" : "movie",
        show: item.grandparentTitle ?? null,
        season: item.parentIndex ?? null,
        episode: item.index ?? null,
        thumb: item.thumb ?? null,
        addedAt: Number(item.addedAt ?? 0),
        durationMs: Number(item.duration ?? 0),
        quality,
        hasRomanianSubtitle,
        summary: overviewRo || item.summary || null,
        genres,
        watchedByAll,
        addedByUsername,
        downloadsLogId,
        torrentHash,
        isSeasonPack,
        requestedByUserId,
      },
    };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export const getPlexTitleDetail = createServerFn({ method: "GET" })
  .validator((data: { ratingKey: string }) => data)
  .handler(
    async ({
      data,
    }): Promise<{ status: "ok"; detail: PlexTitleDetail } | { status: "error"; error: string }> => {
      const { requireAuth, isAdminOrOwner } = await import("../admin.server");
      const session = await requireAuth();

      const cached = detailCache.get(data.ratingKey);
      let base: PlexTitleDetailBase;
      if (cached && cached.expiresAt > Date.now()) {
        base = cached.base;
      } else {
        const result = await computeTitleDetailBase(data.ratingKey);
        if (result.status === "error") return result;
        base = result.base;
        detailCache.set(data.ratingKey, { expiresAt: Date.now() + DETAIL_TTL_MS, base });
      }

      const { getDb } = await import("../db");
      const me = getDb()
        .prepare("SELECT plex_username FROM users WHERE id = ?")
        .get(session.data.userId!) as { plex_username: string | null } | undefined;
      const myPlexUsername = me?.plex_username ?? null;

      const watchedByMe = myPlexUsername
        ? base.watchedByAll.some((w) => w.username === myPlexUsername)
        : false;
      const watchedByOthers = base.watchedByAll.filter((w) => w.username !== myPlexUsername);
      const canManage = isAdminOrOwner(session, base.requestedByUserId);

      const { watchedByAll: _watchedByAll, requestedByUserId: _requestedByUserId, ...rest } = base;
      return {
        status: "ok",
        detail: {
          ...rest,
          watchedByMe,
          watchedByOthers,
          canManage,
        },
      };
    },
  );
