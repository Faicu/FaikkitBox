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
import {
  readDownloadLog,
  readAllDownloadLogEntries,
  appendDownloadLog,
  markLogEntryComplete,
} from "./log";
import { CORRECTED_OUTCOMES } from "./subtitle-outcomes";
import type { SubtitleRunItem, DeleteSubtitleResult } from "./subtitles";
import { refreshPlexLibrary } from "../plex-refresh";
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
  const needle = String(torrentName)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
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
          const hay = String(t.name ?? "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
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
          import("../notifications/notifications")
            .then(({ buildTorrentCompleteNotification }) =>
              buildTorrentCompleteNotification({ torrentName, imdb: imdbId }),
            )
            .then((n) =>
              import("../activity-log").then(({ logActivity }) =>
                logActivity(
                  "torrent_complete",
                  n.body,
                  { torrentId },
                  { image: n.image, url: n.url, title: n.title },
                ),
              ),
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
            const { updateMediaSubtitleStatus } = await import("../media/media");
            updateMediaSubtitleStatus(torrentHash, subtitleItem.outcome, subtitleItem.detail);
          } catch (e) {
            console.warn(`[filelist] Eroare subtitrare pentru "${torrentName}":`, e);
          }
          const { markMediaCompleted, resolveMediaPlexLinkByTorrentHash } =
            await import("../media/media");
          markMediaCompleted(torrentHash);
          await refreshPlexLibrary(plexType);
          console.log(`[filelist] Plex refresh trimis pentru "${plexType}"`);

          // Scanarea Plex e asincronă — fișierul poate să nu fie încă indexat
          // chiar după refresh. Reîncercăm cu pauze, ca ratingKey/calitatea/
          // durata din `media` să se completeze fără intervenție manuală.
          for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise((r) => setTimeout(r, 20_000));

            const linked = await resolveMediaPlexLinkByTorrentHash(torrentHash).catch(() => false);
            if (linked) break;
          }
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
// identificarea unui titlu. Caută secvențial — se oprește la primul rezultat
// găsit — întâi direct după IMDB ID (cel mai fiabil — funcționează chiar și
// când numele lansării nu conține niciunul dintre titluri, ex. titluri
// coreene romanizate diferit de original_title din TMDB), apoi după titlul
// original, apoi după titlul englez/internațional. Contul Filelist are o
// limită orară de cereri — un cache scurt (10 min) evită să repetăm
// aceleași căutări la apeluri repetate în fereastra respectivă.
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
    const { requireAuth } = await import("../auth/admin.server");
    await requireAuth();
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
  imdb?: string | null;
  requestedByUserId?: number | null;
  // Metadate TMDB — trimise deja gata calculate de wizard/Lansări (au TMDB
  // details la îndemână la momentul descărcării). Când lipsesc (căutarea
  // manuală brută din FilelistSection, fără nicio legătură TMDB în UI),
  // downloadFilelistCore încearcă singur o rezolvare
  // best-effort (autoResolveManualMedia) — dacă eșuează, titlul pur și
  // simplu nu ajunge în `media`, exact ca acum. Proveniența torrent-ului
  // (nume/hash/categorie/mărime/cale) e completată aici, în
  // downloadFilelistCore, care oricum le are deja calculate — nu e nevoie
  // ca apelantul să le retrimită.
  media?: Omit<
    import("../media/media").UpsertMediaEntryInput,
    | "torrentName"
    | "torrentHash"
    | "category"
    | "categoryName"
    | "size"
    | "freeleech"
    | "internal"
    | "savePath"
    | "requestedByUserId"
  >;
}

// Rezolvare best-effort a metadatelor TMDB pentru un torrent descărcat din
// căutarea manuală Filelist (FilelistSection), care n-are nicio legătură
// TMDB în UI — spre deosebire de wizard/Lansări, care trimit deja `media`
// gata calculat. Dacă torrentul are IMDb id (Filelist l-a confirmat) îl
// folosim direct; altfel încercăm aceeași căutare pe nume ca la potrivirea
// subtitrărilor. Fără IMDb id găsit, întoarce null — titlul nu ajunge în
// `media`, exact comportamentul de dinainte (nimic nu se strică).
async function autoResolveManualMedia(
  torrentImdb: string | null | undefined,
  torrentName: string,
  isMovie: boolean,
): Promise<DownloadFilelistParams["media"] | null> {
  const mediaType: "movie" | "tv" = isMovie ? "movie" : "tv";
  let imdbId = torrentImdb ?? null;
  if (!imdbId) {
    const { searchImdbIdByReleaseName } = await import("../tmdb/tmdb-title-lookup");
    const found = await searchImdbIdByReleaseName(torrentName, mediaType).catch(() => null);
    imdbId = found?.imdbId ?? null;
  }
  if (!imdbId) return null;

  const { lookupTmdbInfoByImdbId } = await import("../tmdb/tmdb-title-lookup");
  const info = await lookupTmdbInfoByImdbId(imdbId).catch(() => null);
  if (!info) return null;

  const { getTmdbDetailsInternal } = await import("../tmdb/tmdb.functions");
  const details = await getTmdbDetailsInternal(info.id, info.mediaType).catch(() => null);
  const { parseSeasonEpisodeFromName } = await import("../media/torrent-name-parse");
  const parsed = !isMovie ? parseSeasonEpisodeFromName(torrentName) : null;

  return {
    mediaType: isMovie ? "movie" : "episode",
    imdbId,
    tmdbId: info.id,
    title: info.title,
    originalTitle: details?.originalTitle ?? null,
    literalTitle: details?.literalTitle ?? null,
    year: info.year ? Number(info.year) : null,
    season: parsed?.season ?? null,
    episode: parsed?.episode ?? null,
    overviewRo: details?.overview ?? null,
    genres: details?.genres ?? [],
    posterPath: info.posterPath ? `https://image.tmdb.org/t/p/w342${info.posterPath}` : null,
    tvStatus: !isMovie ? (details?.tvStatus ?? null) : null,
    isSeasonPack: !!parsed && parsed.episode === null,
    addedVia: "manual",
  };
}

// Implementare comună pentru descărcare + upload la qBittorrent, folosită de
// server function-ul public (downloadFilelist).
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

    import("../notifications/notifications")
      .then(({ buildTorrentAddedNotification }) =>
        buildTorrentAddedNotification({
          torrentName: params.torrentName,
          imdb: params.imdb,
        }),
      )
      .then((n) =>
        import("../activity-log").then(({ logActivity }) =>
          logActivity(
            "torrent_added",
            n.body,
            {
              category: catName,
              savePath,
              size: params.size,
            },
            { image: n.image, url: n.url, title: n.title },
          ),
        ),
      )
      .catch(() => {});
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
      requestedByUserId: params.requestedByUserId ?? null,
    });

    const mediaPayload =
      params.media ??
      (await autoResolveManualMedia(params.imdb, params.torrentName, isMovie).catch((e) => {
        console.warn("[filelist] Rezolvare automată media eșuată:", e);
        return null;
      }));
    if (mediaPayload) {
      const { upsertMediaEntry } = await import("../media/media");
      try {
        upsertMediaEntry({
          ...mediaPayload,
          torrentName: params.torrentName,
          torrentHash: torrentHash ?? null,
          category: catId,
          categoryName: catName,
          size: params.size ?? 0,
          freeleech: params.freeleech ?? false,
          internal: params.internal ?? false,
          savePath,
          requestedByUserId: params.requestedByUserId ?? null,
        });
      } catch (e) {
        console.warn("[filelist] Nu am putut scrie în tabela media:", e);
      }
    }

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
      media?: DownloadFilelistParams["media"];
    }) => ({
      ...data,
      torrentId: Number(data.torrentId),
      categoryId: Number(data.categoryId),
      size: data.size !== undefined ? Number(data.size) : undefined,
    }),
  )
  .handler(async ({ data }): Promise<FilelistDownloadResult> => {
    const { requireAuth } = await import("../auth/admin.server");
    const session = await requireAuth();
    return downloadFilelistCore({
      ...data,
      requestedByUserId: session.data.userId ?? null,
    });
  });

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
  async (): Promise<BackfillState> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    return {
      running: backfillRunning,
      progress: backfillProgress,
      lastResult: backfillRunning ? null : lastBackfillResult,
    };
  },
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
    const ownLogByHash = new Map(
      ownLog.filter((e) => e.torrentHash).map((e) => [e.torrentHash!, e]),
    );
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
    const { requireAdmin } = await import("../auth/admin.server");
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

// Echivalentul de mai sus, apelabil direct (fără graniță de server function/
// requireAdmin) — folosit de plugin-ul periodic de sincronizare
// (server/plugins/media-torrent-sync.ts), care rulează în fundal după
// legătura retroactivă torrent↔Plex, ca orice torrent nou detectat să capete
// automat și verificarea subtitrării, nu doar statusul actualizat.
export async function runSubtitleBackfillIfIdle(): Promise<void> {
  if (backfillRunning) return;
  const qbitBase = process.env.QBIT_URL ?? "http://192.168.1.192:25556";
  const qbitUser = process.env.QBIT_USERNAME;
  const qbitPass = process.env.QBIT_PASSWORD;
  if (!qbitUser || !qbitPass) return;

  const url = qbitBase.replace(/\/$/, "");
  backfillRunning = true;
  backfillProgress = null;
  lastBackfillResult = null;
  await runBackfillWork(url, qbitUser, qbitPass);
}

// Corectează subtitrarea pentru un singur titlu — folosește exact aceeași
// logică (ensureRomanianSubtitle) ca backfill-ul global, dar aplicată direct
// pe hash-ul torrentului cerut, fără să mai listeze/itereze toate torrentele
// din qBittorrent.
export type CorrectSubtitleResult =
  ({ status: "ok" } & SubtitleRunItem) | { status: "error"; error: string };

// ---------------------------------------------------------------------------
// Echivalentele de mai sus, dar sursate direct din `media` (media.id), nu din
// `downloads` — folosite de Bibliotecă. Orice rând `media` cu torrent_hash
// cunoscut e gestionabil, indiferent dacă provine dintr-o descărcare pornită
// prin aplicație sau a fost rezolvat retroactiv la backfill (vezi
// media-backfill.ts) — nu mai depinde de existența unui rând `downloads`.
// ---------------------------------------------------------------------------

interface MediaActionRow {
  torrent_name: string | null;
  torrent_hash: string | null;
  imdb_id: string | null;
  category: number | null;
  requested_by_user_id: number | null;
}

export const correctSubtitleForMedia = createServerFn({ method: "POST" })
  .validator((data: { mediaId: number }) => data)
  .handler(async ({ data }): Promise<CorrectSubtitleResult> => {
    const { requireAuth, isAdminOrOwner } = await import("../auth/admin.server");
    const session = await requireAuth();

    const { getDb } = await import("../db");
    const row = getDb()
      .prepare(
        "SELECT torrent_name, torrent_hash, imdb_id, category, requested_by_user_id FROM media WHERE id = ?",
      )
      .get(data.mediaId) as MediaActionRow | undefined;

    if (!row) {
      return { status: "error", error: "Titlul nu a fost găsit" };
    }
    if (!isAdminOrOwner(session, row.requested_by_user_id)) {
      return {
        status: "error",
        error: "Doar cel care a adăugat titlul sau un admin poate corecta subtitrarea",
      };
    }
    if (!row.torrent_hash) {
      return {
        status: "error",
        error: "Hash-ul torrentului e necunoscut — nu poate fi gestionat automat",
      };
    }

    const qbitBase = process.env.QBIT_URL ?? "http://192.168.1.192:25556";
    const qbitUser = process.env.QBIT_USERNAME;
    const qbitPass = process.env.QBIT_PASSWORD;
    if (!qbitUser || !qbitPass) {
      return { status: "error", error: "QBIT_USERNAME / QBIT_PASSWORD nu sunt configurate" };
    }
    const url = qbitBase.replace(/\/$/, "");

    const { ensureRomanianSubtitle, logSubtitleRun } = await import("./subtitles");
    const plexType = row.category !== null && isMovieCategory(row.category) ? "movie" : "show";

    const result = await ensureRomanianSubtitle({
      qbitUrl: url,
      qbitUser,
      qbitPass,
      torrentHash: row.torrent_hash,
      torrentName: row.torrent_name ?? "",
      imdbId: row.imdb_id ?? undefined,
      mediaType: plexType === "movie" ? "movie" : "tv",
    });

    await logSubtitleRun([result], "download");
    const { updateMediaSubtitleStatus } = await import("../media/media");
    updateMediaSubtitleStatus(row.torrent_hash, result.outcome, result.detail);
    if (CORRECTED_OUTCOMES.includes(result.outcome)) {
      await refreshPlexLibrary(plexType).catch(() => {});
    }

    return { status: "ok", ...result };
  });

export const deleteSubtitleForMedia = createServerFn({ method: "POST" })
  .validator((data: { mediaId: number }) => data)
  .handler(async ({ data }): Promise<DeleteSubtitleResult> => {
    const { requireAuth, isAdminOrOwner } = await import("../auth/admin.server");
    const session = await requireAuth();

    const { getDb } = await import("../db");
    const row = getDb()
      .prepare(
        "SELECT torrent_name, torrent_hash, imdb_id, category, requested_by_user_id FROM media WHERE id = ?",
      )
      .get(data.mediaId) as MediaActionRow | undefined;

    if (!row) {
      return { status: "error", deleted: [], error: "Titlul nu a fost găsit" };
    }
    if (!isAdminOrOwner(session, row.requested_by_user_id)) {
      return {
        status: "error",
        deleted: [],
        error: "Doar cel care a adăugat titlul sau un admin poate șterge subtitrarea",
      };
    }
    if (!row.torrent_hash) {
      return {
        status: "error",
        deleted: [],
        error: "Hash-ul torrentului e necunoscut — nu poate fi gestionat automat",
      };
    }

    const qbitBase = process.env.QBIT_URL ?? "http://192.168.1.192:25556";
    const qbitUser = process.env.QBIT_USERNAME;
    const qbitPass = process.env.QBIT_PASSWORD;
    if (!qbitUser || !qbitPass) {
      return {
        status: "error",
        deleted: [],
        error: "QBIT_USERNAME / QBIT_PASSWORD nu sunt configurate",
      };
    }
    const url = qbitBase.replace(/\/$/, "");

    const { deleteRomanianSubtitle } = await import("./subtitles");
    const result = await deleteRomanianSubtitle({
      qbitUrl: url,
      qbitUser,
      qbitPass,
      torrentHash: row.torrent_hash,
    });

    if (result.status === "ok") {
      const { clearMediaSubtitleStatus } = await import("../media/media");
      clearMediaSubtitleStatus(row.torrent_hash);
      if (row.category !== null) {
        const { refreshPlexLibraryForCategory } = await import("../plex-refresh");
        await refreshPlexLibraryForCategory(row.category).catch(() => {});
      }
    }

    return result;
  });
