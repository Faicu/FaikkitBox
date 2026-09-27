// ---------------------------------------------------------------------------
// Tabul „Top Filelist" din Descoperă — cele mai populare titluri dintre
// torrentele urcate recent pe Filelist. API-ul Filelist nu are un endpoint de
// top: `latest-torrents` dă doar ultimele 100 per cerere (~2 zile pentru
// categoriile HD/4K). Un titlu vechi, încă foarte seed-uit, nu apare —
// limitare acceptată, vezi decizia din 27 sept 2026. Gruparea/ordonarea e în
// top-torrents.ts.
//
// Importurile server (filelist-client, tmdb-title-lookup) sunt dinamice, în
// handler — corpul lui e eliminat din bundle-ul de client.
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";
import type { TmdbBasicInfo } from "../tmdb/tmdb-title-lookup";
import type { TopTorrentTitle } from "./top-torrents";

export type { TopTorrentTitle } from "./top-torrents";

export interface TopTorrentsResult {
  items: TopTorrentTitle[];
  error?: string;
}

// Contul Filelist are o limită orară de cereri — 2 cereri la 15 minute.
const CACHE_TTL = 15 * 60_000;
const MAX_PER_TYPE = 60;
let cache: { expiresAt: number; items: TopTorrentTitle[] } | null = null;
let inflight: Promise<TopTorrentTitle[]> | null = null;

async function buildTopList(): Promise<TopTorrentTitle[]> {
  const { fetchLatestTorrents } = await import("./filelist-client");
  const { lookupTmdbInfoByImdbId } = await import("../tmdb/tmdb-title-lookup");
  const { parseSeasonEpisodeFromName } = await import("../media/torrent-name-parse");
  const { groupTopTorrents, normalizeImdbId } = await import("./top-torrents");

  const [movies, series] = await Promise.all([
    fetchLatestTorrents("movies"),
    fetchLatestTorrents("series"),
  ]);
  const torrents = [...movies, ...series];

  // Gruparea se face după titlul TMDB, deci rezolvăm toate IMDb id-urile
  // distincte (~100 în practică). Lookup-urile sunt în cache 1h
  // (tmdb-title-lookup) — la reîmprospătare costă doar titlurile noi. Loturi
  // de 10 ca să nu lovim TMDB cu zeci de cereri simultane.
  const imdbIds = [
    ...new Set(torrents.map((t) => normalizeImdbId(t.imdb)).filter((i) => i !== null)),
  ];
  const tmdbByImdb = new Map<string, TmdbBasicInfo | null>();
  for (let i = 0; i < imdbIds.length; i += 10) {
    await Promise.all(
      imdbIds.slice(i, i + 10).map(async (id) => {
        tmdbByImdb.set(id, await lookupTmdbInfoByImdbId(id).catch(() => null));
      }),
    );
  }

  return groupTopTorrents(torrents, tmdbByImdb, parseSeasonEpisodeFromName, MAX_PER_TYPE);
}

export const getFilelistTopTitles = createServerFn({ method: "GET" }).handler(
  async (): Promise<TopTorrentsResult> => {
    const { requireAuth } = await import("../auth/admin.server");
    await requireAuth();
    if (cache && cache.expiresAt > Date.now()) return { items: cache.items };
    try {
      // Două taburi deschise simultan nu dublează cererile către Filelist.
      inflight ??= buildTopList().finally(() => {
        inflight = null;
      });
      const items = await inflight;
      cache = { expiresAt: Date.now() + CACHE_TTL, items };
      return { items };
    } catch (e) {
      // La eroare servim lista veche dacă o avem, în loc de nimic.
      return {
        items: cache?.items ?? [],
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
);
