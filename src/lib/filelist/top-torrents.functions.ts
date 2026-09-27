// ---------------------------------------------------------------------------
// Tabul „Top Filelist" din Descoperă — cele mai populare titluri dintre
// torrentele urcate recent pe Filelist. API-ul Filelist nu are un endpoint de
// top: `latest-torrents` dă doar ultimele 100 per cerere (~2 zile pentru
// categoriile HD/4K), iar popularitatea = seederi + leecheri însumați pe
// titlu (filme) sau pe titlu + episod (seriale). Un titlu vechi, încă foarte
// seed-uit, nu apare — limitare acceptată, vezi decizia din 27 sept 2026.
//
// Torrentele fără IMDb id sunt excluse (la fel ca în restul aplicației) —
// fără el nu avem nici poster/TMDB id, nici wizard.
//
// Importurile server (filelist-client, tmdb-title-lookup) sunt dinamice, în
// handler — corpul lui e eliminat din bundle-ul de client.
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";
import type { DiscoverTitle } from "../tmdb/tmdb.discover.functions";
import type { FilelistTorrent } from "./types";

export interface TopTorrentTitle extends DiscoverTitle {
  // Cheie unică în listă — același serial poate apărea cu episoade diferite.
  key: string;
  // "S10E07", "S10" (pachet de sezon) sau null la filme.
  episodeLabel: string | null;
  seeders: number;
  leechers: number;
}

export interface TopTorrentsResult {
  items: TopTorrentTitle[];
  error?: string;
}

// Contul Filelist are o limită orară de cereri — 2 cereri la 15 minute.
const CACHE_TTL = 15 * 60_000;
const MAX_ITEMS = 60;
let cache: { expiresAt: number; items: TopTorrentTitle[] } | null = null;
let inflight: Promise<TopTorrentTitle[]> | null = null;

function episodeLabelFor(
  name: string,
  parse: (n: string) => { season: number; episode: number | null } | null,
): string | null {
  const p = parse(name);
  if (!p) return null;
  const s = `S${String(p.season).padStart(2, "0")}`;
  return p.episode === null ? s : `${s}E${String(p.episode).padStart(2, "0")}`;
}

async function buildTopList(): Promise<TopTorrentTitle[]> {
  const { fetchLatestTorrents } = await import("./filelist-client");
  const { lookupTmdbInfoByImdbId } = await import("../tmdb/tmdb-title-lookup");
  const { parseSeasonEpisodeFromName } = await import("../media/torrent-name-parse");

  const [movies, series] = await Promise.all([
    fetchLatestTorrents("movies"),
    fetchLatestTorrents("series"),
  ]);

  interface Group {
    imdb: string;
    isSeries: boolean;
    episodeLabel: string | null;
    seeders: number;
    leechers: number;
  }
  const groups = new Map<string, Group>();
  const add = (t: FilelistTorrent, isSeries: boolean) => {
    if (!t.imdb) return;
    const episodeLabel = isSeries ? episodeLabelFor(t.name, parseSeasonEpisodeFromName) : null;
    const key = `${t.imdb}|${episodeLabel ?? ""}`;
    const g = groups.get(key) ?? { imdb: t.imdb, isSeries, episodeLabel, seeders: 0, leechers: 0 };
    g.seeders += t.seeders;
    g.leechers += t.leechers;
    groups.set(key, g);
  };
  for (const t of movies) add(t, false);
  for (const t of series) add(t, true);

  const ranked = [...groups.entries()]
    .sort(([, a], [, b]) => b.seeders + b.leechers - (a.seeders + a.leechers))
    .slice(0, MAX_ITEMS);

  // Lookup-urile TMDB sunt în cache 1h (tmdb-title-lookup) — la reîmprospătare
  // doar titlurile noi costă cereri. Loturi de 8 ca să nu lovim TMDB cu 60
  // de cereri simultane la prima încărcare.
  const items: TopTorrentTitle[] = [];
  for (let i = 0; i < ranked.length; i += 8) {
    const batch = await Promise.all(
      ranked.slice(i, i + 8).map(async ([key, g]) => {
        const info = await lookupTmdbInfoByImdbId(g.imdb).catch(() => null);
        if (!info) return null;
        return {
          key,
          id: info.id,
          mediaType: info.mediaType,
          title: info.title,
          originalTitle: info.originalTitle,
          year: info.year,
          posterUrl: info.posterPath ? `https://image.tmdb.org/t/p/w342${info.posterPath}` : null,
          voteAverage: info.voteAverage,
          episodeLabel: g.episodeLabel,
          seeders: g.seeders,
          leechers: g.leechers,
        } satisfies TopTorrentTitle;
      }),
    );
    for (const item of batch) if (item) items.push(item);
  }
  return items;
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
