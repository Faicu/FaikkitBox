// ---------------------------------------------------------------------------
// Tabul „Top Filelist" din Descoperă — cele mai populare titluri dintre
// torrentele urcate pe Filelist în perioada aleasă (24h … 7 zile). API-ul
// Filelist nu are un endpoint de top: `latest-torrents` dă doar ultimele 100
// per cerere, fără paginare. Ca fereastra să ajungă cât mai departe, cerem
// fiecare categorie separat (100 per categorie): filmele acoperă așa peste o
// săptămână, dar serialele HD doar ~1 zi — acolo nu există altă cale, iar
// tabul arată cât acoperă de fapt (`coverage`). Un titlu vechi, încă foarte
// seed-uit, nu apare — limitare acceptată, vezi decizia din 27 sept 2026.
// Gruparea/ordonarea e în top-torrents.ts.
//
// Importurile server (filelist-client, tmdb-title-lookup) sunt dinamice, în
// handler — corpul lui e eliminat din bundle-ul de client.
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

// O cerere per categorie: 13 la o reîmprospătare. Contul Filelist are o
// limită orară de cereri, deci lista stă în cache 30 de minute.
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

  // Câte 4 cereri odată — 13 simultan către Filelist ar fi inutil de agresiv.
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

  // Gruparea se face după titlul TMDB, deci rezolvăm toate IMDb id-urile
  // distincte din perioadă. Lookup-urile sunt în cache 1h
  // (tmdb-title-lookup) — la reîmprospătare costă doar titlurile noi. Loturi
  // de 10 ca să nu lovim TMDB cu zeci de cereri simultane.
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
    const { requireAuth } = await import("../auth/admin.server");
    await requireAuth();
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
