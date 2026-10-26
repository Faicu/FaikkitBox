// ---------------------------------------------------------------------------
// Tabul „Top Filelist” din Descoperă: cele mai populare titluri urcate în
// perioada aleasă. API-ul n-are top — `latest-torrents` dă ultimele 100, fără
// paginare, deci cerem fiecare categorie separat: filmele acoperă peste o
// săptămână, serialele HD ~1 zi (tabul arată cât acoperă). Un titlu vechi încă
// foarte seed-uit nu apare — limitare acceptată (27 sept. 2026).
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";
import type { TmdbBasicInfo } from "../tmdb/tmdb-title-lookup";
import type { FilelistTorrent } from "./types";
import type { TopPeriodHours, TopTorrentTitle } from "./top-torrents";

export type { TopTorrentTitle } from "./top-torrents";

export interface TopTorrentsResult {
  items: TopTorrentTitle[];
  // Câte ore în urmă acoperă complet datele, per tip (null = nelimitat).
  coverage: { movie: number | null; tv: number | null };
  error?: string;
}

// 13 cereri la o reîmprospătare, cu limita orară a contului — cache 30 de minute.
const CACHE_TTL = 30 * 60_000;
const MAX_PER_TYPE = 60;

interface RawData {
  expiresAt: number;
  torrents: FilelistTorrent[];
  coverage: TopTorrentsResult["coverage"];
  // Lista grupată per perioadă, calculată la prima cerere pentru ea.
  byPeriod: Map<TopPeriodHours, TopTorrentTitle[]>;
}

let raw: RawData | null = null;
let inflight: Promise<RawData> | null = null;

async function fetchRaw(): Promise<RawData> {
  const { fetchLatestTorrents } = await import("./filelist-client");
  const { MOVIE_CATEGORIES, SERIES_CATEGORIES } = await import("./categories");
  const { coveredHours } = await import("./top-torrents");

  // Câte 4 cereri odată.
  const fetchAll = async (cats: readonly number[]) => {
    const out: Awaited<ReturnType<typeof fetchLatestTorrents>>[] = [];
    for (let i = 0; i < cats.length; i += 4) {
      out.push(...(await Promise.all(cats.slice(i, i + 4).map((c) => fetchLatestTorrents([c])))));
    }
    return out;
  };
  const movies = await fetchAll(MOVIE_CATEGORIES);
  const series = await fetchAll(SERIES_CATEGORIES);
  const now = Date.now();
  return {
    expiresAt: now + CACHE_TTL,
    torrents: [...movies, ...series].flatMap((b) => b.torrents),
    coverage: { movie: coveredHours(movies, now), tv: coveredHours(series, now) },
    byPeriod: new Map(),
  };
}

async function buildTopList(torrents: FilelistTorrent[], hours: TopPeriodHours) {
  const { lookupTmdbInfoByImdbId } = await import("../tmdb/tmdb-title-lookup");
  const { parseSeasonEpisodeFromName } = await import("../media/torrent-name-parse");
  const { groupTopTorrents, normalizeImdbId, parseUploadDate } = await import("./top-torrents");
  const { attachImdbRatings } = await import("../imdb/discover-ratings");

  const since = Date.now() - hours * 3_600_000;
  const inPeriod = torrents.filter((t) => t.upload_date && parseUploadDate(t.upload_date) >= since);

  // Toate IMDb id-urile distincte se rezolvă la TMDB (cache 1h — la
  // reîmprospătare doar cele noi), în loturi de 10.
  const imdbIds = [
    ...new Set(inPeriod.map((t) => normalizeImdbId(t.imdb)).filter((i) => i !== null)),
  ];
  const tmdbByImdb = new Map<string, TmdbBasicInfo | null>();
  for (let i = 0; i < imdbIds.length; i += 10) {
    await Promise.all(
      imdbIds.slice(i, i + 10).map(async (id) => {
        tmdbByImdb.set(id, await lookupTmdbInfoByImdbId(id).catch(() => null));
      }),
    );
  }

  const items = groupTopTorrents(inPeriod, tmdbByImdb, parseSeasonEpisodeFromName, MAX_PER_TYPE);
  return attachImdbRatings(items, (item) => item.imdbId);
}

export const getFilelistTopTitles = createServerFn({ method: "GET" })
  .validator((data: { hours: TopPeriodHours }) => data)
  .handler(async ({ data }): Promise<TopTorrentsResult> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { TOP_PERIODS, DEFAULT_TOP_PERIOD } = await import("./top-torrents");
    const hours = TOP_PERIODS.some((p) => p.hours === data.hours) ? data.hours : DEFAULT_TOP_PERIOD;

    let error: string | undefined;
    if (!raw || raw.expiresAt <= Date.now()) {
      try {
        // Două taburi deschise simultan nu dublează cererile către Filelist.
        inflight ??= fetchRaw().finally(() => {
          inflight = null;
        });
        raw = await inflight;
      } catch (e) {
        // La eroare servim lista veche dacă o avem, în loc de nimic.
        error = e instanceof Error ? e.message : String(e);
      }
    }
    if (!raw) return { items: [], coverage: { movie: null, tv: null }, error };

    let items = raw.byPeriod.get(hours);
    if (!items) {
      const current = raw;
      items = await buildTopList(current.torrents, hours);
      current.byPeriod.set(hours, items);
    }
    return { items, coverage: raw.coverage, error };
  });
