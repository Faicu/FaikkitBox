import { createServerFn } from "@tanstack/react-start";
import { writeFile, unlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  FilelistTorrent,
  FilelistCategory,
  FilelistSearchResult,
  FilelistDownloadResult,
  FilelistApiTorrent,
  QbitTorrentInfo,
} from "./types";
import {
  MOVIE_CATEGORIES,
  SERIES_CATEGORIES,
  ALL_CATEGORIES,
  CATEGORY_NAMES,
  parseCategoryId,
  isMovieCategory,
} from "./categories";
import { qbitLogin, qbitEnsureCookie, resetQbitCookie, qbitGet } from "../qbit-client";
import { readDownloadLog, readAllDownloadLogEntries, appendDownloadLog, markLogEntryComplete } from "./log";
import { stripDiacritics, torrentMatchesTitle } from "./match";
import { CORRECTED_OUTCOMES } from "./subtitle-outcomes";
// Import dinamic (nu static) — subtitles.ts foloseşte node:child_process/node:util
// pentru ffprobe, care nu trebuie să ajungă în bundle-ul de client. download.ts
// e statically importat de filelist.functions.ts, folosit și din componente
// client (hooks.ts, DownloadLogSection.tsx), deci orice import static de aici
// se poate scurge în bundle-ul browserului.

// Un torrent e considerat complet dacă a ajuns la 100% și starea din
// qBittorrent indică seeding/pauzat-după-seeding — folosit atât de
// pollUntilComplete (torrent pornit din aplicație) cât și de backfillSubtitles
// (orice torrent existent în qBittorrent, indiferent de sursă).
function isTorrentComplete(progress: number, state: string): boolean {
  return (
    progress >= 1 &&
    (state.includes("UP") || state === "uploading" || state === "pausedUP" || state === "stalledUP")
  );
}

// Caută hash-ul unui torrent proaspăt adăugat, după nume — cu reîncercări.
// La un singur apel imediat după upload, torrentul poate lipsi încă din
// lista celor mai recente (metadata neînregistrată complet în qBittorrent),
// sau poate fi "ascuns" de alte torrente adăugate în aceeași fereastră de
// câteva minute — de-asta creștem limit-ul și reîncercăm cu pauză, în loc
// de un singur `sleep + fetch` (a cauzat cazuri reale de hash nedisponibil,
// vezi jurnalul de erori: Hellraiser II 2026-08-08).
async function findTorrentHashByName(
  qbitUrl: string,
  cookie: string,
  torrentName: string,
  attempts = 5,
  delayMs = 2000,
): Promise<string | null> {
  const needle = String(torrentName).toLowerCase().replace(/[^a-z0-9]/g, "");
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    try {
      const listRes = await fetch(
        `${qbitUrl}/api/v2/torrents/info?sort=added_on&reverse=true&limit=20`,
        { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10_000) },
      );
      if (listRes.ok) {
        const list: QbitTorrentInfo[] = await listRes.json();
        const match = list.find((t) => {
          const hay = String(t.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
          return hay.includes(needle.slice(0, 30)) || needle.includes(hay.slice(0, 30));
        });
        if (match?.hash) return match.hash;
      }
    } catch (e) {
      console.warn("[filelist] Nu am putut obține hash-ul torrentului:", e);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Background polling: verifică progresul torrentului și refresh Plex la final
// ---------------------------------------------------------------------------

async function pollUntilComplete(
  qbitUrl: string,
  cookie: string,
  torrentHash: string,
  plexType: "movie" | "show",
  torrentName: string,
  torrentId: number,
  qbitUser: string,
  qbitPass: string,
  imdbId?: string | null,
): Promise<void> {
  const MAX_WAIT_MS = 48 * 60 * 60 * 1000;
  const POLL_INTERVAL_MS = 30_000;
  const started = Date.now();

  console.log(`[filelist] Pornesc polling pentru "${torrentName}" (${torrentHash})`);

  while (Date.now() - started < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    try {
      const res = await fetch(`${qbitUrl}/api/v2/torrents/info?hashes=${torrentHash}`, {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;

      const list: QbitTorrentInfo[] = await res.json();
      if (!list.length) continue;

      const torrent = list[0];
      const progress = Number(torrent.progress ?? 0);
      const state: string = torrent.state ?? "";

      const isDone = isTorrentComplete(progress, state);

      if (isDone) {
        const wasFirst = await markLogEntryComplete(torrentId);
        if (wasFirst) {
          console.log(`[filelist] "${torrentName}" complet — dau refresh Plex`);
          import("../activity-log")
            .then(({ logActivity }) =>
              logActivity("torrent_complete", `Torrent descărcat complet: ${torrentName}`, {
                torrentId,
              }),
            )
            .catch(() => {});
          try {
            const { ensureRomanianSubtitle, logSubtitleRun } = await import("./subtitles");
            const subtitleItem = await ensureRomanianSubtitle({
              qbitUrl,
              qbitUser,
              qbitPass,
              torrentHash,
              torrentName,
              imdbId,
              mediaType: plexType === "movie" ? "movie" : "tv",
            });
            await logSubtitleRun([subtitleItem], "download");
          } catch (e) {
            console.warn(`[filelist] Eroare subtitrare pentru "${torrentName}":`, e);
          }
          await refreshPlexLibrary(plexType);
          console.log(`[filelist] Plex refresh trimis pentru "${plexType}"`);
        } else {
          console.log(`[filelist] "${torrentName}" deja marcat complet de alt loop — skip`);
        }
        return;
      }
    } catch (e) {
      console.warn(`[filelist] Eroare polling qBit: ${e}`);
    }
  }

  console.warn(`[filelist] Timeout polling pentru "${torrentName}" după 48h`);
}

async function plexRefreshLibraryBySection(sectionKey: string): Promise<void> {
  const base = process.env.PLEX_URL ?? "http://127.0.0.1:32400";
  const token = process.env.PLEX_TOKEN;
  if (!token) return;
  try {
    const res = await fetch(`${base}/library/sections/${sectionKey}/refresh`, {
      method: "GET",
      headers: { "X-Plex-Token": token, Accept: "application/json" },
    });
    if (!res.ok) {
      console.warn(`[filelist] Plex refresh HTTP ${res.status} pentru secțiunea ${sectionKey}`);
    }
  } catch (e) {
    console.warn(`[filelist] Eroare Plex refresh:`, e);
  }
}

// Rescanează secțiunea Plex (filme sau seriale) — SINGURUL loc care declanșează
// refresh Plex din tot modulul Filelist. Folosit atât la finalizarea unei
// descărcări (pollUntilComplete), cât și la ștergerea unei intrări din jurnal
// (deleteFilelistLogEntry, log.ts, via refreshPlexLibraryForCategory).
export async function refreshPlexLibrary(plexType: "movie" | "show"): Promise<void> {
  const sectionKey = await plexFindLibraryKey(plexType);
  if (sectionKey) await plexRefreshLibraryBySection(sectionKey);
}

export async function refreshPlexLibraryForCategory(category: number): Promise<void> {
  return refreshPlexLibrary(isMovieCategory(category) ? "movie" : "show");
}

async function plexFindLibraryKey(type: "movie" | "show"): Promise<string | null> {
  const base = process.env.PLEX_URL ?? "http://127.0.0.1:32400";
  const token = process.env.PLEX_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${base}/library/sections`, {
      headers: { "X-Plex-Token": token, Accept: "application/json" },
    });
    if (!res.ok) {
      console.warn(`[filelist] Plex library sections HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as {
      MediaContainer?: { Directory?: Array<{ type?: string; key?: string }> };
    };
    const dirs = data?.MediaContainer?.Directory ?? [];
    const match = dirs.find((d) => d.type === type);
    return match ? String(match.key) : null;
  } catch (e) {
    console.warn(`[filelist] Eroare la găsirea secțiunii Plex:`, e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Resume polling pentru descărcări întrerupte de restart server
// ---------------------------------------------------------------------------

let resumeDone = false;

async function resumeOrphanedPolls(): Promise<void> {
  if (resumeDone) return;
  resumeDone = true;

  try {
    const log = await readDownloadLog();
    const orphaned = log.filter((e) => e.completedAt === null);
    if (orphaned.length === 0) return;

    const qbitBase = process.env.QBIT_URL;
    const qbitUser = process.env.QBIT_USERNAME;
    const qbitPass = process.env.QBIT_PASSWORD;
    if (!qbitBase || !qbitUser || !qbitPass) return;

    const url = qbitBase.replace(/\/$/, "");
    let cookie: string;
    try {
      cookie = await qbitLogin(url, qbitUser, qbitPass);
    } catch (e) {
      console.warn("[filelist] Resume: login qBit eșuat:", e);
      return;
    }

    console.log(
      `[filelist] Reiau polling pentru ${orphaned.length} descărcări întrerupte de restart`,
    );
    for (const entry of orphaned) {
      const plexType = isMovieCategory(entry.category) ? "movie" : "show";
      const hash = entry.torrentHash
        ? entry.torrentHash
        : await findTorrentHashByName(url, cookie, entry.name, 1, 0);
      if (!hash) {
        console.warn(`[filelist] Resume: hash tot indisponibil pentru "${entry.name}"`);
        continue;
      }
      pollUntilComplete(
        url,
        cookie,
        hash,
        plexType,
        entry.name,
        entry.id,
        qbitUser,
        qbitPass,
        entry.imdb,
      ).catch((e) => console.error("[filelist] Eroare resume polling:", e));
    }
  } catch (e) {
    console.warn("[filelist] resumeOrphanedPolls eșuat:", e);
  }
}

// Rulează la 15s după încărcarea modulului (serverul e pornit complet)
if (typeof process !== "undefined" && process.env) {
  setTimeout(() => {
    resumeOrphanedPolls();
  }, 15_000);
}

// ---------------------------------------------------------------------------
// Căutare Filelist internă (fără requireAdmin — pentru plugin-uri background)
// ---------------------------------------------------------------------------

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
    const { requireAdmin } = await import("../admin.server");
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
// Verificare unificată "există pe Filelist?" — sursă unică de adevăr,
// folosită din toate cele 3 locuri care interoghează Filelist: butonul
// "Verifică pe Filelist" din Descoperă, "Mai multe detalii" pe un card fixat
// din Lansări, și job-ul de fundal pinned-watcher (notificări automate la 3
// ore). Caută secvențial — se oprește la primul rezultat găsit — întâi
// direct după IMDB ID (cel mai fiabil — funcționează chiar și când numele
// lansării nu conține niciunul dintre titluri, ex. titluri coreene
// romanizate diferit de original_title din TMDB), apoi după titlul original,
// apoi după titlul englez/internațional. Contul Filelist are o limită orară
// de cereri — un cache scurt (10 min) evită să repetăm aceleași căutări la
// apeluri repetate în fereastra respectivă.
// ---------------------------------------------------------------------------

const filelistCheckCache = new Map<string, { expiresAt: number; result: FilelistSearchResult }>();
const FILELIST_CHECK_CACHE_TTL = 10 * 60_000;
const FILELIST_CHECK_CACHE_SWEEP_THRESHOLD = 500;

// Intrările expirate se elimină lazy — doar când o cheie e recitită. Fără
// măturare, un cache uitat ar crește nemărginit pe termen lung (titluri
// distincte verificate o singură dată rămân în memorie la infinit). Măturăm
// când Map-ul devine suficient de mare încât să merite costul unei treceri.
function sweepExpiredFilelistCache(): void {
  if (filelistCheckCache.size < FILELIST_CHECK_CACHE_SWEEP_THRESHOLD) return;
  const now = Date.now();
  for (const [key, entry] of filelistCheckCache) {
    if (entry.expiresAt <= now) filelistCheckCache.delete(key);
  }
}

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
  const original = stripDiacritics(data.originalTitle || "").trim();
  const english = stripDiacritics(data.title || "").trim();

  const cacheKey = `${category}|${data.imdbId ?? ""}|${original}|${english}`;
  const cached = filelistCheckCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const nameQueries = [original, english].filter(
    (q, i, arr) => q.length > 0 && arr.indexOf(q) === i,
  );
  if (nameQueries.length === 0 && !data.imdbId) return { status: "ok", torrents: [] };

  try {
    let found: FilelistTorrent[] = [];

    if (data.imdbId) {
      const byImdb = await searchFilelistRaw(data.imdbId, category, "imdb");
      found = byImdb.map((t) => ({
        ...t,
        matchedByImdb: true,
        matchedVia: "imdb",
        matchedQuery: data.imdbId ?? undefined,
      }));
    }

    for (const q of nameQueries) {
      if (found.length > 0) break;
      const via: "original_title" | "english_title" | "titles_match" =
        original && original === english
          ? "titles_match"
          : q === original
            ? "original_title"
            : "english_title";
      const byName = await searchFilelistRaw(q, category, "name");
      found = byName
        .filter(
          (t) => torrentMatchesTitle(t.name, original) || torrentMatchesTitle(t.name, english),
        )
        .map((t) => ({
          ...t,
          matchedByImdb: !!(t.imdb && data.imdbId && t.imdb === data.imdbId),
          matchedVia: via,
          matchedQuery: q,
        }));
    }

    found.sort((a, b) => {
      const da = a.upload_date ? new Date(a.upload_date).getTime() : 0;
      const db = b.upload_date ? new Date(b.upload_date).getTime() : 0;
      return db - da;
    });

    const result: FilelistSearchResult = { status: "ok", torrents: found };
    sweepExpiredFilelistCache();
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
    const { requireAdmin } = await import("../admin.server");
    await requireAdmin();
    return checkFilelistForItemInternal(data);
  });

// ---------------------------------------------------------------------------
// Server function: descarcă torrent și trimite la qBittorrent
// ---------------------------------------------------------------------------

interface DownloadFilelistParams {
  torrentId: number;
  torrentName: string;
  categoryId: number;
  categoryName?: string;
  size?: number;
  freeleech?: boolean;
  internal?: boolean;
  skipLog?: boolean;
  imdb?: string | null;
}

// Implementare comună pentru descărcare + upload la qBittorrent, folosită atât
// de server function-ul public (downloadFilelist) cât și de fluxul intern de
// auto-descărcare din plugin-uri (downloadFilelistInternal).
async function downloadFilelistCore(
  params: DownloadFilelistParams,
): Promise<FilelistDownloadResult> {
  const username = process.env.FILELIST_USERNAME;
  const passkey = process.env.FILELIST_PASSKEY;
  const qbitBase = process.env.QBIT_URL ?? "http://192.168.1.192:25556";
  const qbitUser = process.env.QBIT_USERNAME;
  const qbitPass = process.env.QBIT_PASSWORD;
  const moviesPath = process.env.MEDIA_MOVIES_PATH ?? "/media/ssd2tb/Filme";
  const seriesPath = process.env.MEDIA_SERIES_PATH ?? "/media/ssd2tb/Seriale";

  if (!username || !passkey) {
    return { status: "error", error: "FILELIST_USERNAME / FILELIST_PASSKEY nu sunt configurate" };
  }
  if (!qbitUser || !qbitPass) {
    return { status: "error", error: "QBIT_USERNAME / QBIT_PASSWORD nu sunt configurate" };
  }

  const catId =
    params.categoryId || (params.categoryName ? parseCategoryId(params.categoryName) : 0);
  const isMovie =
    isMovieCategory(catId) || (catId === 0 && /film|movie/i.test(params.categoryName ?? ""));
  const savePath = isMovie ? moviesPath : seriesPath;

  // 1. Descarcă fișierul .torrent de la Filelist
  // Filelist API nu are endpoint de download — se folosește download.php cu passkey
  const dlUrl = `https://filelist.io/download.php?id=${params.torrentId}&passkey=${passkey}`;
  let torrentBuffer: ArrayBuffer;
  try {
    const dlRes = await fetch(dlUrl, {
      signal: AbortSignal.timeout(20_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FaikkitBox/1.0)" },
    });
    if (!dlRes.ok) {
      return { status: "error", error: `Eroare la descărcarea torrentului: HTTP ${dlRes.status}` };
    }
    torrentBuffer = await dlRes.arrayBuffer();
  } catch (e) {
    return {
      status: "error",
      error: `Eroare rețea Filelist: ${e instanceof Error ? e.message : e}`,
    };
  }

  // 2. Scrie temporar fișierul .torrent pe disk
  const safeName = params.torrentName.replace(/[^a-z0-9_\-. ]/gi, "_").slice(0, 80);
  const tmpPath = join(tmpdir(), `faikkitbox_${params.torrentId}_${Date.now()}.torrent`);
  await writeFile(tmpPath, Buffer.from(torrentBuffer));

  try {
    // 3. Autentifică-te la qBittorrent
    const url = qbitBase.replace(/\/$/, "");
    let cookie: string;
    try {
      cookie = await qbitEnsureCookie(url, qbitUser, qbitPass);
    } catch {
      resetQbitCookie();
      cookie = await qbitLogin(url, qbitUser, qbitPass);
    }

    // 4. Trimite torrentul la qBittorrent cu save path corect
    const form = new FormData();
    const fileBytes = await readFile(tmpPath);
    form.append(
      "torrents",
      new Blob([fileBytes], { type: "application/x-bittorrent" }),
      `${safeName}.torrent`,
    );
    form.append("savepath", savePath);
    form.append("category", isMovie ? "filme" : "seriale");

    let uploadRes = await fetch(`${url}/api/v2/torrents/add`, {
      method: "POST",
      headers: { Cookie: cookie, Referer: url, Origin: url },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });

    // Sesiunea SID poate expira în qBittorrent între timp; un SID expirat
    // primește tot 403 (nu 401), deci reîncercăm o dată cu login proaspăt.
    // Alte coduri de eroare (400 body invalid, 500 server) nu se rezolvă
    // printr-un relogin — le lăsăm să treacă direct la eroarea de mai jos.
    if (uploadRes.status === 401 || uploadRes.status === 403) {
      resetQbitCookie();
      cookie = await qbitLogin(url, qbitUser, qbitPass);
      uploadRes = await fetch(`${url}/api/v2/torrents/add`, {
        method: "POST",
        headers: { Cookie: cookie, Referer: url, Origin: url },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
    }

    if (!uploadRes.ok) {
      const txt = await uploadRes.text().catch(() => "");
      return {
        status: "error",
        error: `qBittorrent upload eșuat: HTTP ${uploadRes.status} ${txt.slice(0, 120)}`,
      };
    }

    const uploadText = await uploadRes.text();
    if (!uploadText.includes("Ok")) {
      console.warn("qBit upload răspuns neașteptat:", uploadText);
    }

    // 5. Găsește hash-ul torrentului proaspăt adăugat (cu reîncercări)
    const torrentHash = await findTorrentHashByName(url, cookie, params.torrentName);

    // 6. Loghează descărcarea imediat (completedAt null = în curs)
    const catName = params.categoryName || CATEGORY_NAMES[catId] || `Cat ${catId}`;

    if (!params.skipLog) {
      import("../activity-log")
        .then(({ logActivity }) =>
          logActivity(
            "torrent_added",
            params.skipLog === false
              ? `Torrent adăugat: ${params.torrentName}`
              : `Auto-descărcat: ${params.torrentName}`,
            { category: catName, savePath, size: params.size },
          ),
        )
        .catch(() => {});
    }
    await appendDownloadLog({
      id: params.torrentId,
      name: params.torrentName,
      size: params.size ?? 0,
      category: catId,
      categoryName: catName,
      freeleech: params.freeleech ?? false,
      internal: params.internal ?? false,
      savePath,
      downloadedAt: new Date().toISOString(),
      completedAt: null,
      torrentHash: torrentHash ?? undefined,
      imdb: params.imdb ?? undefined,
    });

    // 7. Pornește polling background — refresh Plex și marchează complet DOAR la final
    const plexType = isMovie ? "movie" : "show";
    if (torrentHash) {
      pollUntilComplete(
        url,
        cookie,
        torrentHash,
        plexType,
        params.torrentName,
        params.torrentId,
        qbitUser,
        qbitPass,
        params.imdb,
      ).catch((e) => console.error("[filelist] Eroare polling:", e));
    } else {
      console.warn("[filelist] Hash nedisponibil — Plex nu va fi refreshuit automat");
    }

    return { status: "ok", torrentName: params.torrentName, savePath };
  } finally {
    // Curăță fișierul temporar
    await unlink(tmpPath).catch(() => {});
  }
}

export const downloadFilelist = createServerFn({ method: "POST" })
  .validator(
    (data: {
      torrentId: number;
      torrentName: string;
      categoryId: number;
      categoryName?: string;
      size?: number;
      freeleech?: boolean;
      internal?: boolean;
      imdb?: string | null;
    }) => ({
      ...data,
      torrentId: Number(data.torrentId),
      categoryId: Number(data.categoryId),
      size: data.size !== undefined ? Number(data.size) : undefined,
    }),
  )
  .handler(async ({ data }): Promise<FilelistDownloadResult> => {
    const { requireAdmin } = await import("../admin.server");
    await requireAdmin();
    return downloadFilelistCore({ ...data, skipLog: false });
  });

// Versiune internă pentru plugin (fără requireAdmin)
export async function downloadFilelistInternal(
  params: DownloadFilelistParams,
): Promise<FilelistDownloadResult> {
  return downloadFilelistCore(params);
}

// ---------------------------------------------------------------------------
// Backfill: aplică ensureRomanianSubtitle retroactiv pe TOATE torrentele
// active din qBittorrent — nu doar cele descărcate prin site (jurnalul
// propriu servește doar ca sursă opțională de IMDb id, când torrentul a
// fost adăugat prin aplicație; pentru torrente adăugate manual în qBit,
// IMDb id lipsește, deci doar cazurile 2/3 — .srt existent — pot fi
// corectate, nu și căutarea pe OpenSubtitles). Rulează secvențial (nu
// paralel), cu o pauză scurtă între torrente, ca să nu bombardăm
// OpenSubtitles/qBittorrent.
// ---------------------------------------------------------------------------

export interface BackfillSubtitlesResult {
  status: "ok" | "error";
  error?: string;
  processed: number;
  skipped: number;
  corrected: number;
}

export interface BackfillProgress {
  total: number;
  done: number;
}

export interface BackfillState {
  running: boolean;
  progress: BackfillProgress | null;
  // Rezultatul ultimei rulări complete — disponibil doar cât timp running e
  // false; se golește la începutul unei rulări noi.
  lastResult: BackfillSubtitlesResult | null;
}

interface QbitTorrentListItem {
  hash: string;
  name: string;
  save_path?: string;
  progress?: number;
  state?: string;
}

// Stare la nivel de modul — un singur backfill rulează odată (declanșat
// manual din UI), nu are rost o soluție persistentă/multi-user. Rularea
// efectivă (runBackfillWork) e pornită fără await din backfillSubtitles —
// un backfill pe zeci/sute de torrente poate dura multe minute, iar un
// singur request HTTP ținut deschis atât de mult a fost tăiat în practică
// (reverse-proxy/browser), lăsând UI-ul fără răspuns aproape de final deși
// server-ul chiar termina treaba. Clientul urmărește progresul + rezultatul
// final exclusiv prin polling pe getBackfillState.
let backfillRunning = false;
let backfillProgress: BackfillProgress | null = null;
let lastBackfillResult: BackfillSubtitlesResult | null = null;

export const getBackfillState = createServerFn({ method: "GET" }).handler(
  async (): Promise<BackfillState> => ({
    running: backfillRunning,
    progress: backfillProgress,
    lastResult: backfillRunning ? null : lastBackfillResult,
  }),
);

async function runBackfillWork(url: string, qbitUser: string, qbitPass: string): Promise<void> {
  try {
    // Listă completă a torrentelor din qBittorrent — indiferent dacă au fost
    // adăugate prin site sau manual din WebUI.
    let qbitTorrents: QbitTorrentListItem[];
    try {
      const res = await qbitGet(url, "/api/v2/torrents/info", qbitUser, qbitPass);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      qbitTorrents = (await res.json()) as QbitTorrentListItem[];
    } catch (e) {
      lastBackfillResult = {
        status: "error",
        error: `Nu am putut lista torrentele din qBittorrent: ${e instanceof Error ? e.message : e}`,
        processed: 0,
        skipped: 0,
        corrected: 0,
      };
      return;
    }
    const completedTorrents = qbitTorrents.filter((t) =>
      isTorrentComplete(Number(t.progress ?? 0), t.state ?? ""),
    );

    // Jurnalul propriu — folosit doar ca sursă opțională de IMDb id (pentru
    // torrentele descărcate prin site) și de categorie (filme/seriale), prin
    // hash. Pentru restul (adăugate manual), categoria e dedusă din
    // save_path față de MEDIA_MOVIES_PATH/MEDIA_SERIES_PATH.
    const ownLog = await readAllDownloadLogEntries();
    const ownLogByHash = new Map(ownLog.filter((e) => e.torrentHash).map((e) => [e.torrentHash!, e]));
    const moviesPath = process.env.MEDIA_MOVIES_PATH ?? "/media/ssd2tb/Filme";
    const seriesPath = process.env.MEDIA_SERIES_PATH ?? "/media/ssd2tb/Seriale";

    function inferPlexType(hash: string, savePath: string | undefined): "movie" | "show" | null {
      const known = ownLogByHash.get(hash);
      if (known) return isMovieCategory(known.category) ? "movie" : "show";
      if (savePath?.startsWith(moviesPath)) return "movie";
      if (savePath?.startsWith(seriesPath)) return "show";
      return null;
    }

    const { ensureRomanianSubtitle, logSubtitleRun } = await import("./subtitles");

    let processed = 0;
    let skipped = 0;
    const items: Array<{
      plexType: "movie" | "show" | null;
      result: Awaited<ReturnType<typeof ensureRomanianSubtitle>>;
    }> = [];

    backfillProgress = { total: completedTorrents.length, done: 0 };
    for (const torrent of completedTorrents) {
      const plexType = inferPlexType(torrent.hash, torrent.save_path);
      try {
        const result = await ensureRomanianSubtitle({
          qbitUrl: url,
          qbitUser,
          qbitPass,
          torrentHash: torrent.hash,
          torrentName: torrent.name,
          imdbId: ownLogByHash.get(torrent.hash)?.imdb,
          mediaType: plexType === "movie" ? "movie" : plexType === "show" ? "tv" : undefined,
        });
        items.push({ plexType, result });
        processed++;
      } catch (e) {
        console.warn(`[filelist] Backfill subtitrare eșuat pentru "${torrent.name}":`, e);
        skipped++;
      }
      backfillProgress = { total: completedTorrents.length, done: backfillProgress.done + 1 };
      await new Promise((r) => setTimeout(r, 2000));
    }

    const corrected = items.filter((it) => CORRECTED_OUTCOMES.includes(it.result.outcome)).length;

    // Refresh Plex o singură dată per categorie (filme/seriale) distinctă
    // atinsă efectiv — nu per torrent, ca să nu declanșăm N scanări la un
    // backfill mare.
    const touchedCategories = new Set(
      items
        .filter((it) => CORRECTED_OUTCOMES.includes(it.result.outcome) && it.plexType)
        .map((it) => it.plexType!),
    );
    for (const plexType of touchedCategories) {
      await refreshPlexLibrary(plexType).catch(() => {});
    }

    console.log(
      `[filelist] Backfill subtitrări: ${processed} procesate, ${skipped} sărite, ${corrected} corectate`,
    );
    await logSubtitleRun(
      items.map((it) => it.result),
      "backfill",
    );

    lastBackfillResult = { status: "ok", processed, skipped, corrected };
  } catch (e) {
    console.error("[filelist] Backfill subtitrări — eroare neașteptată:", e);
    lastBackfillResult = {
      status: "error",
      error: e instanceof Error ? e.message : String(e),
      processed: 0,
      skipped: 0,
      corrected: 0,
    };
  } finally {
    backfillProgress = null;
    backfillRunning = false;
  }
}

// Pornește backfill-ul în fundal și răspunde imediat — rularea efectivă
// (potențial multe minute) se urmărește separat prin getBackfillState.
export const backfillSubtitles = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ status: "ok" | "error"; error?: string }> => {
    const { requireAdmin } = await import("../admin.server");
    await requireAdmin();

    if (backfillRunning) {
      return { status: "error", error: "Un backfill este deja în curs" };
    }

    const qbitBase = process.env.QBIT_URL ?? "http://192.168.1.192:25556";
    const qbitUser = process.env.QBIT_USERNAME;
    const qbitPass = process.env.QBIT_PASSWORD;
    if (!qbitUser || !qbitPass) {
      return { status: "error", error: "QBIT_USERNAME / QBIT_PASSWORD nu sunt configurate" };
    }

    const url = qbitBase.replace(/\/$/, "");
    backfillRunning = true;
    backfillProgress = null;
    lastBackfillResult = null;
    runBackfillWork(url, qbitUser, qbitPass).catch((e) => {
      console.error("[filelist] Backfill subtitrări — eroare neprinsă:", e);
      backfillRunning = false;
    });

    return { status: "ok" };
  },
);
