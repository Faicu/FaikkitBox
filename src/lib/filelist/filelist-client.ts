// Client Filelist.io — SINGURUL loc care vorbește cu api.php și download.php.
// Restul descărcării (qBittorrent, `media`, notificări) e în download.ts.

import { createServerFn } from "@tanstack/react-start";
import type {
  FilelistTorrent,
  FilelistCategory,
  FilelistSearchResult,
  FilelistApiTorrent,
} from "./types";
import {
  MOVIE_CATEGORIES,
  SERIES_CATEGORIES,
  MIXED_CATEGORIES,
  ALL_CATEGORIES,
  RO_DUBBED_CATEGORY,
  CATEGORY_NAMES,
  parseCategoryId,
} from "./categories";
import { isFullDisc } from "../media/torrent-rank";

// Categoriile Filelist pentru fiecare filtru din UI. Cele mixte (RO Dubbed)
// intră la ambele: căutarea e după IMDb, deci nu aduce celălalt tip.
function resolveCategoryIds(category: FilelistCategory): readonly number[] {
  return category === "movies"
    ? [...MOVIE_CATEGORIES, ...MIXED_CATEGORIES]
    : category === "series"
      ? [...SERIES_CATEGORIES, ...MIXED_CATEGORIES]
      : ALL_CATEGORIES;
}

// Discurile Blu-ray brute (BDMV) nu sunt fișiere video redabile
// („Pinocchio: Unstrung”, 25 aug. 2026 — descărcat degeaba), deci sunt excluse
// peste tot, inclusiv din căutarea manuală. Regula: isFullDisc (torrent-rank.ts).

// Răspunsul API → FilelistTorrent, comun tuturor căutărilor.
function mapApiTorrents(raw: FilelistApiTorrent[]): FilelistTorrent[] {
  return raw
    .map((t) => ({
      id: Number(t.id),
      name: String(t.name ?? ""),
      size: Number(t.size ?? 0),
      seeders: Number(t.seeders ?? 0),
      leechers: Number(t.leechers ?? 0),
      times_completed: Number(t.times_completed ?? 0),
      category: parseCategoryId(t.category),
      categoryName: CATEGORY_NAMES[parseCategoryId(t.category)] ?? `Cat ${t.category}`,
      freeleech: !!Number(t.freeleech),
      internal: !!Number(t.internal),
      upload_date: String(t.upload_date ?? ""),
      imdb: t.imdb || undefined,
    }))
    .filter((t) => !isFullDisc(t.name));
}

async function searchFilelistRaw(
  query: string,
  category: FilelistCategory,
  type: "name" | "imdb" = "name",
): Promise<FilelistTorrent[]> {
  const username = process.env.FILELIST_USERNAME;
  const passkey = process.env.FILELIST_PASSKEY;
  if (!username || !passkey) return [];
  const params = new URLSearchParams({
    username,
    passkey,
    action: "search-torrents",
    type,
    query: query.trim(),
    category: resolveCategoryIds(category).join(","),
    output: "json",
  });
  try {
    const res = await fetch(`https://filelist.io/api.php?${params.toString()}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const raw: FilelistApiTorrent[] = await res.json();
    if (!Array.isArray(raw)) return [];
    return mapApiTorrents(raw);
  } catch {
    return [];
  }
}

// Ultimele torrente urcate (max 100, fără paginare) din categoriile date — tabul
// „Top Filelist” din Descoperă. API-ul n-are „populare”, deci popularitatea vine
// din seederi/leecheri pe fereastra asta: ~1 zi pe seriale, ~3 săptămâni pe
// Filme 4K. Aruncă la eroare, ca apelantul să nu pună în cache o listă falsă.
export interface LatestTorrentsBatch {
  torrents: FilelistTorrent[];
  // Plafonul de 100 atins: mai vechi de `oldestUpload` există torrente nevăzute.
  capped: boolean;
  oldestUpload: string | null;
}

export async function fetchLatestTorrents(
  categoryIds: readonly number[],
): Promise<LatestTorrentsBatch> {
  const username = process.env.FILELIST_USERNAME;
  const passkey = process.env.FILELIST_PASSKEY;
  if (!username || !passkey) {
    throw new Error("FILELIST_USERNAME / FILELIST_PASSKEY nu sunt configurate în .env");
  }
  const params = new URLSearchParams({
    username,
    passkey,
    action: "latest-torrents",
    limit: "100",
    category: categoryIds.join(","),
    output: "json",
  });
  const res = await fetch(`https://filelist.io/api.php?${params.toString()}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Filelist API HTTP ${res.status}`);
  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) throw new Error("Răspuns neașteptat de la Filelist API");
  const list = raw as FilelistApiTorrent[];
  // Din lista brută: plafonul ține de ce a dat API-ul, nu de ce păstrăm.
  const dates = list
    .map((t) => String(t.upload_date ?? ""))
    .filter(Boolean)
    .sort();
  return {
    torrents: mapApiTorrents(list),
    capped: list.length >= 100,
    oldestUpload: dates[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Server function: căutare pe Filelist.io
// ---------------------------------------------------------------------------

export const searchFilelist = createServerFn({ method: "GET" })
  .validator((data: { query: string; category?: FilelistCategory }) => data)
  .handler(async ({ data }): Promise<FilelistSearchResult> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const username = process.env.FILELIST_USERNAME;
    const passkey = process.env.FILELIST_PASSKEY;
    if (!username || !passkey) {
      return {
        status: "error",
        error: "FILELIST_USERNAME / FILELIST_PASSKEY nu sunt configurate în .env",
        torrents: [],
      };
    }

    const category = data.category ?? "all";

    const params = new URLSearchParams({
      username,
      passkey,
      action: "search-torrents",
      type: "name",
      query: data.query.trim(),
      category: resolveCategoryIds(category).join(","),
      output: "json",
    });

    try {
      const res = await fetch(`https://filelist.io/api.php?${params.toString()}`, {
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        return { status: "error", error: `Filelist API HTTP ${res.status}`, torrents: [] };
      }

      const raw: FilelistApiTorrent[] = await res.json();

      if (!Array.isArray(raw)) {
        return { status: "error", error: "Răspuns neașteptat de la Filelist API", torrents: [] };
      }

      const torrents: FilelistTorrent[] = mapApiTorrents(raw);

      // Sortează după data postării, cel mai recent primul
      torrents.sort((a, b) => {
        const da = a.upload_date ? new Date(a.upload_date).getTime() : 0;
        const db = b.upload_date ? new Date(b.upload_date).getTime() : 0;
        return db - da;
      });

      return { status: "ok", torrents };
    } catch (e) {
      return { status: "error", error: e instanceof Error ? e.message : String(e), torrents: [] };
    }
  });

// ---------------------------------------------------------------------------
// „Există pe Filelist?” — STRICT după IMDb id (căutarea pe titlu e nesigură,
// confirmat de suportul Filelist); fără id, listă goală, fără cerere.
// ---------------------------------------------------------------------------

const filelistCheckCache = new Map<string, { expiresAt: number; result: FilelistSearchResult }>();
const FILELIST_CHECK_CACHE_TTL = 10 * 60_000;

// Măturare pe timer, nu pe prag de mărime: o bibliotecă mare putea oscila mereu
// sub prag, cu intrări expirate de mult.
function sweepExpiredFilelistCache(): void {
  const now = Date.now();
  for (const [key, entry] of filelistCheckCache) {
    if (entry.expiresAt <= now) filelistCheckCache.delete(key);
  }
}
setInterval(sweepExpiredFilelistCache, FILELIST_CHECK_CACHE_TTL / 2).unref?.();

export async function checkFilelistForItemInternal(data: {
  title: string;
  originalTitle: string;
  imdbId?: string | null;
  mediaType: "movie" | "tv";
  // Cache-ul de 10 minute e doar al wizard-ului (cruță limita orară a contului).
  // Urmărirea întreabă mereu direct — un răspuns din cache acolo ar raporta
  // „nimic nou” pe baza unei căutări vechi. Scrierea în cache se face oricum.
  useCache?: boolean;
  // RO Dubbed doar în wizard, unde alege un om — urmărirea ar putea descărca
  // singură o variantă doar dublată. Cache-ul le conține mereu; se filtrează
  // la ieșire.
  includeDubbed?: boolean;
}): Promise<FilelistSearchResult> {
  const username = process.env.FILELIST_USERNAME;
  const passkey = process.env.FILELIST_PASSKEY;
  if (!username || !passkey) {
    return {
      status: "error",
      error: "FILELIST_USERNAME / FILELIST_PASSKEY nu sunt configurate în .env",
      torrents: [],
    };
  }

  const category: FilelistCategory = data.mediaType === "movie" ? "movies" : "series";

  const cacheKey = `${category}|${data.imdbId ?? ""}`;
  const withoutDubbed = (r: FilelistSearchResult): FilelistSearchResult =>
    data.includeDubbed
      ? r
      : { ...r, torrents: r.torrents.filter((t) => t.category !== RO_DUBBED_CATEGORY) };
  if (data.useCache) {
    const cached = filelistCheckCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return withoutDubbed(cached.result);
  }

  if (!data.imdbId) return { status: "ok", torrents: [] };

  try {
    const byImdb = await searchFilelistRaw(data.imdbId, category, "imdb");
    const found: FilelistTorrent[] = byImdb.map((t) => ({
      ...t,
      matchedByImdb: true,
    }));

    found.sort((a, b) => {
      const da = a.upload_date ? new Date(a.upload_date).getTime() : 0;
      const db = b.upload_date ? new Date(b.upload_date).getTime() : 0;
      return db - da;
    });

    const result: FilelistSearchResult = { status: "ok", torrents: found };
    filelistCheckCache.set(cacheKey, { expiresAt: Date.now() + FILELIST_CHECK_CACHE_TTL, result });
    return withoutDubbed(result);
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e), torrents: [] };
  }
}

// Fișierul .torrent, prin download.php cu passkey (API-ul n-are endpoint).
export async function downloadTorrentFile(torrentId: number): Promise<ArrayBuffer> {
  const passkey = process.env.FILELIST_PASSKEY;
  if (!passkey) throw new Error("FILELIST_PASSKEY nu este configurat");
  const dlUrl = `https://filelist.io/download.php?id=${torrentId}&passkey=${passkey}`;
  const dlRes = await fetch(dlUrl, {
    signal: AbortSignal.timeout(20_000),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; FaikkitBox/1.0)" },
  });
  if (!dlRes.ok) {
    throw new Error(`Eroare la descărcarea torrentului: HTTP ${dlRes.status}`);
  }
  return dlRes.arrayBuffer();
}
