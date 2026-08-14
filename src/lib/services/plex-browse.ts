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

export interface PlexBrowseItem {
  ratingKey: string;
  title: string;
  type: "movie" | "episode";
  show: string | null;
  season: number | null;
  episode: number | null;
  thumb: string | null;
  addedAt: number;
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
  }));

  browseCache = { url, items, expiresAt: Date.now() + BROWSE_TTL_MS };
  return items;
}

export const getPlexLibraryBrowse = createServerFn({ method: "GET" }).handler(
  async (): Promise<
    { status: "ok"; items: PlexBrowseItem[] } | { status: "error"; error: string }
  > => {
    const { requireAuth } = await import("../admin.server");
    await requireAuth();
    try {
      return { status: "ok", items: await fetchBrowseItems() };
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
  watchedByMe: boolean;
  watchedByOthers: string[];
}

function isRomanianStream(s: { language?: string; languageCode?: string }): boolean {
  const code = (s.languageCode ?? "").toLowerCase();
  const lang = (s.language ?? "").toLowerCase();
  return code === "ron" || code === "rum" || code === "ro" || lang.includes("roman");
}

export const getPlexTitleDetail = createServerFn({ method: "GET" })
  .validator((data: { ratingKey: string }) => data)
  .handler(
    async ({
      data,
    }): Promise<{ status: "ok"; detail: PlexTitleDetail } | { status: "error"; error: string }> => {
      const { requireAuth } = await import("../admin.server");
      const session = await requireAuth();

      const token = process.env.PLEX_TOKEN;
      if (!token) return { status: "error", error: "PLEX_TOKEN nu este configurat" };

      try {
        const { url } = await discoverPlexUrl(token, process.env.PLEX_URL);
        const headers = { Accept: "application/json", "X-Plex-Token": token };
        const json = await fetchJson<PlexApiResponse>(
          `${url}/library/metadata/${encodeURIComponent(data.ratingKey)}`,
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
        const matchesItem = (e: {
          title: string;
          show?: string;
          season?: number;
          episode?: number;
        }) =>
          isEpisode
            ? e.show === item.grandparentTitle &&
              e.season === item.parentIndex &&
              e.episode === item.index
            : !e.show && e.title === item.title;

        const allHistory = await getAllPlexUserHistory();
        const watchedBy = new Set<string>();
        for (const [username, entries] of Object.entries(allHistory)) {
          if (entries.some(matchesItem)) watchedBy.add(username);
        }

        const me = db
          .prepare("SELECT plex_username FROM users WHERE id = ?")
          .get(session.data.userId!) as { plex_username: string | null } | undefined;
        const myPlexUsername = me?.plex_username ?? null;

        const watchedByMe = myPlexUsername ? watchedBy.has(myPlexUsername) : false;
        const watchedByOthers = [...watchedBy].filter((u) => u !== myPlexUsername);

        return {
          status: "ok",
          detail: {
            ratingKey: data.ratingKey,
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
            summary: item.summary ?? null,
            watchedByMe,
            watchedByOthers,
          },
        };
      } catch (e) {
        return { status: "error", error: e instanceof Error ? e.message : String(e) };
      }
    },
  );
