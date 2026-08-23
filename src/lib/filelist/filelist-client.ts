// ---------------------------------------------------------------------------
// Client Filelist.io — SINGURUL loc care vorbește direct cu api.php/
// download.php (căutare torrente + descărcarea fișierului .torrent). Orice
// altă logică legată de o descărcare (upload la qBittorrent, scriere în
// `media`, notificări, polling) rămâne în download.ts, care consumă doar
// funcțiile de aici.
// ---------------------------------------------------------------------------

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
  ALL_CATEGORIES,
  CATEGORY_NAMES,
  parseCategoryId,
} from "./categories";

// Categoriile Filelist.io pentru fiecare filtru expus în UI — folosit atât de
// căutarea internă (searchFilelistRaw) cât și de server function-ul public
// (searchFilelist).
function resolveCategoryIds(category: FilelistCategory): readonly number[] {
  return category === "movies"
    ? MOVIE_CATEGORIES
    : category === "series"
      ? SERIES_CATEGORIES
      : ALL_CATEGORIES;
}

// Mapează răspunsul brut al API-ului Filelist.io la forma internă
// FilelistTorrent — folosit atât de căutarea internă cât și de server
// function-ul public, ca să nu diverge maparea între ele.
function mapApiTorrents(raw: FilelistApiTorrent[]): FilelistTorrent[] {
  return raw.map((t) => ({
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
  }));
}

export async function searchFilelistRaw(
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
// Verificare unificată "există pe Filelist?" — folosită de wizard (Acasă) la
// identificarea unui titlu. Caută STRICT după IMDb id — fallback-ul pe titlu
// a fost eliminat deliberat (confirmat de suportul Filelist: căutarea pe
// titlu dă rezultate nesigure). Fără IMDb id, întoarce direct listă goală,
// fără niciun apel către Filelist. Contul Filelist are o limită orară de
// cereri — un cache scurt (10 min) evită să repetăm aceleași căutări la
// apeluri repetate în fereastra respectivă.
// ---------------------------------------------------------------------------

const filelistCheckCache = new Map<string, { expiresAt: number; result: FilelistSearchResult }>();
const FILELIST_CHECK_CACHE_TTL = 10 * 60_000;

// Măturare pe timer, nu pe prag de mărime — o bibliotecă mare (mii de
// titluri distincte verificate o singură dată, ex. tot ce se răsfoiește în
// Descoperă) putea oscila mereu sub un prag fix (500 chei) și nu declanșa
// niciodată curățarea, deși intrările expiraseră demult (TTL 10 min). Rulează
// la fiecare jumătate de TTL — suficient de des ca memoria să nu crească
// nemărginit, fără să coste o trecere la fiecare citire/scriere din cache.
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
  const cached = filelistCheckCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

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
    return result;
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e), torrents: [] };
  }
}

export const checkFilelistForItem = createServerFn({ method: "GET" })
  .validator(
    (data: {
      title: string;
      originalTitle: string;
      imdbId?: string | null;
      mediaType: "movie" | "tv";
    }) => data,
  )
  .handler(async ({ data }): Promise<FilelistSearchResult> => {
    const { requireAuth } = await import("../auth/admin.server");
    await requireAuth();
    return checkFilelistForItemInternal(data);
  });

// Descarcă bytes-ii fișierului .torrent de la Filelist — Filelist API nu are
// endpoint dedicat de download, se folosește direct download.php cu passkey.
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
