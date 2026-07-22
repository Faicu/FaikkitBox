import { createServerFn } from "@tanstack/react-start";
import { writeFile, unlink } from "node:fs/promises";
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
import { qbitLogin, qbitEnsureCookie, resetQbitCookie } from "./qbit-client";
import { readDownloadLog, appendDownloadLog, markLogEntryComplete } from "./log";

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

      const isDone =
        progress >= 1 &&
        (state.includes("UP") ||
          state === "uploading" ||
          state === "pausedUP" ||
          state === "stalledUP");

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
          const sectionKey = await plexFindLibraryKey(plexType);
          if (sectionKey) await plexRefreshLibrary(sectionKey);
          console.log(`[filelist] Plex refresh trimis pentru secțiunea ${sectionKey}`);
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

async function plexRefreshLibrary(sectionKey: string): Promise<void> {
  const base = process.env.PLEX_URL ?? "http://127.0.0.1:32400";
  const token = process.env.PLEX_TOKEN;
  if (!token) return;
  await fetch(`${base}/library/sections/${sectionKey}/refresh`, {
    method: "GET",
    headers: { "X-Plex-Token": token, Accept: "application/json" },
  }).catch(() => {});
}

async function plexFindLibraryKey(type: "movie" | "show"): Promise<string | null> {
  const base = process.env.PLEX_URL ?? "http://127.0.0.1:32400";
  const token = process.env.PLEX_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${base}/library/sections`, {
      headers: { "X-Plex-Token": token, Accept: "application/json" },
    });
    const data = (await res.json()) as {
      MediaContainer?: { Directory?: Array<{ type?: string; key?: string }> };
    };
    const dirs = data?.MediaContainer?.Directory ?? [];
    const match = dirs.find((d) => d.type === type);
    return match ? String(match.key) : null;
  } catch {
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
    const orphaned = log.filter((e) => e.completedAt === null && e.torrentHash);
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
      pollUntilComplete(url, cookie, entry.torrentHash!, plexType, entry.name, entry.id).catch(
        (e) => console.error("[filelist] Eroare resume polling:", e),
      );
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

export async function searchFilelistRaw(
  query: string,
  category: FilelistCategory,
): Promise<FilelistTorrent[]> {
  const username = process.env.FILELIST_USERNAME;
  const passkey = process.env.FILELIST_PASSKEY;
  if (!username || !passkey) return [];
  const catIds =
    category === "movies"
      ? MOVIE_CATEGORIES
      : category === "series"
        ? SERIES_CATEGORIES
        : ALL_CATEGORIES;
  const params = new URLSearchParams({
    username,
    passkey,
    action: "search-torrents",
    type: "name",
    query: query.trim(),
    category: catIds.join(","),
    output: "json",
  });
  try {
    const res = await fetch(`https://filelist.io/api.php?${params.toString()}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const raw: FilelistApiTorrent[] = await res.json();
    if (!Array.isArray(raw)) return [];
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
    const catIds =
      category === "movies"
        ? MOVIE_CATEGORIES
        : category === "series"
          ? SERIES_CATEGORIES
          : ALL_CATEGORIES;

    const params = new URLSearchParams({
      username,
      passkey,
      action: "search-torrents",
      type: "name",
      query: data.query.trim(),
      category: catIds.join(","),
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

      const torrents: FilelistTorrent[] = raw.map((t) => ({
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
// Server function: descarcă torrent și trimite la qBittorrent
// ---------------------------------------------------------------------------

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

    const catId = data.categoryId || (data.categoryName ? parseCategoryId(data.categoryName) : 0);
    const isMovie =
      isMovieCategory(catId) || (catId === 0 && /film|movie/i.test(data.categoryName ?? ""));
    const savePath = isMovie ? moviesPath : seriesPath;

    // 1. Descarcă fișierul .torrent de la Filelist
    // Filelist API nu are endpoint de download — se folosește download.php cu passkey
    const dlUrl = `https://filelist.io/download.php?id=${data.torrentId}&passkey=${passkey}`;
    let torrentBuffer: ArrayBuffer;
    try {
      const dlRes = await fetch(dlUrl, {
        signal: AbortSignal.timeout(20_000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; FaikkitBox/1.0)" },
      });
      if (!dlRes.ok) {
        return {
          status: "error",
          error: `Eroare la descărcarea torrentului: HTTP ${dlRes.status}`,
        };
      }
      torrentBuffer = await dlRes.arrayBuffer();
    } catch (e) {
      return {
        status: "error",
        error: `Eroare rețea Filelist: ${e instanceof Error ? e.message : e}`,
      };
    }

    // 2. Scrie temporar fișierul .torrent pe disk
    const safeName = data.torrentName.replace(/[^a-z0-9_\-. ]/gi, "_").slice(0, 80);
    const tmpPath = join(tmpdir(), `faikkitbox_${data.torrentId}_${Date.now()}.torrent`);
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
      const fileBytes = await import("node:fs/promises").then((m) => m.readFile(tmpPath));
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
      if (!uploadRes.ok) {
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

      // 5. Găsește hash-ul torrentului proaspăt adăugat
      await new Promise((r) => setTimeout(r, 2000));
      let torrentHash: string | null = null;
      try {
        const listRes = await fetch(
          `${url}/api/v2/torrents/info?sort=added_on&reverse=true&limit=5`,
          {
            headers: { Cookie: cookie },
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (listRes.ok) {
          const list: QbitTorrentInfo[] = await listRes.json();
          const match =
            list.find((t) =>
              String(t.name ?? "")
                .toLowerCase()
                .includes(data.torrentName.slice(0, 20).toLowerCase()),
            ) ?? list[0];
          torrentHash = match?.hash ?? null;
        }
      } catch (e) {
        console.warn("[filelist] Nu am putut obține hash-ul torrentului:", e);
      }

      // 6. Loghează descărcarea imediat (completedAt null = în curs)
      const catId = Number(data.categoryId);
      const catName = data.categoryName || CATEGORY_NAMES[catId] || `Cat ${catId}`;

      // Log activitate
      import("../activity-log")
        .then(({ logActivity }) =>
          logActivity("torrent_added", `Torrent adăugat: ${data.torrentName}`, {
            category: catName,
            savePath,
            size: data.size,
          }),
        )
        .catch(() => {});
      await appendDownloadLog({
        id: data.torrentId,
        name: data.torrentName,
        size: data.size ?? 0,
        category: catId,
        categoryName: catName,
        freeleech: data.freeleech ?? false,
        internal: data.internal ?? false,
        savePath,
        downloadedAt: new Date().toISOString(),
        completedAt: null,
        torrentHash: torrentHash ?? undefined,
      });

      // 7. Pornește polling background — refresh Plex și marchează complet DOAR la final
      const plexType = isMovie ? "movie" : "show";
      if (torrentHash) {
        pollUntilComplete(
          url,
          cookie,
          torrentHash,
          plexType,
          data.torrentName,
          data.torrentId,
        ).catch((e) => console.error("[filelist] Eroare polling:", e));
      } else {
        console.warn("[filelist] Hash nedisponibil — Plex nu va fi refreshuit automat");
      }

      return { status: "ok", torrentName: data.torrentName, savePath };
    } finally {
      // Curăță fișierul temporar
      await unlink(tmpPath).catch(() => {});
    }
  });

// Versiune internă pentru plugin (fără requireAdmin)
export async function downloadFilelistInternal(params: {
  torrentId: number;
  torrentName: string;
  categoryId: number;
  categoryName?: string;
  size?: number;
  freeleech?: boolean;
  internal?: boolean;
  skipLog?: boolean;
}): Promise<FilelistDownloadResult> {
  const username = process.env.FILELIST_USERNAME;
  const passkey = process.env.FILELIST_PASSKEY;
  const qbitBase = process.env.QBIT_URL ?? "http://192.168.1.192:25556";
  const qbitUser = process.env.QBIT_USERNAME;
  const qbitPass = process.env.QBIT_PASSWORD;
  const moviesPath = process.env.MEDIA_MOVIES_PATH ?? "/media/ssd2tb/Filme";
  const seriesPath = process.env.MEDIA_SERIES_PATH ?? "/media/ssd2tb/Seriale";

  if (!username || !passkey) return { status: "error", error: "FILELIST credentials lipsă" };
  if (!qbitUser || !qbitPass) return { status: "error", error: "qBit credentials lipsă" };

  const catId =
    params.categoryId || (params.categoryName ? parseCategoryId(params.categoryName) : 0);
  const isMovie =
    isMovieCategory(catId) || (catId === 0 && /film|movie/i.test(params.categoryName ?? ""));
  const savePath = isMovie ? moviesPath : seriesPath;

  const dlUrl = `https://filelist.io/download.php?id=${params.torrentId}&passkey=${passkey}`;
  let torrentBuffer: ArrayBuffer;
  try {
    const dlRes = await fetch(dlUrl, {
      signal: AbortSignal.timeout(20_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FaikkitBox/1.0)" },
    });
    if (!dlRes.ok) return { status: "error", error: `Filelist HTTP ${dlRes.status}` };
    torrentBuffer = await dlRes.arrayBuffer();
  } catch (e) {
    return {
      status: "error",
      error: `Eroare rețea Filelist: ${e instanceof Error ? e.message : e}`,
    };
  }

  const safeName = params.torrentName.replace(/[^a-z0-9_\-. ]/gi, "_").slice(0, 80);
  const tmpPath = join(tmpdir(), `faikkitbox_auto_${params.torrentId}_${Date.now()}.torrent`);
  await writeFile(tmpPath, Buffer.from(torrentBuffer));

  try {
    const url = qbitBase.replace(/\/$/, "");
    let cookie: string;
    try {
      cookie = await qbitEnsureCookie(url, qbitUser, qbitPass);
    } catch {
      resetQbitCookie();
      cookie = await qbitLogin(url, qbitUser, qbitPass);
    }

    const form = new FormData();
    const fileBytes = await import("node:fs/promises").then((m) => m.readFile(tmpPath));
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

    if (!uploadRes.ok) {
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
      return { status: "error", error: `qBit upload eșuat: HTTP ${uploadRes.status}` };
    }

    await new Promise((r) => setTimeout(r, 2000));
    let torrentHash: string | null = null;
    try {
      const listRes = await fetch(
        `${url}/api/v2/torrents/info?sort=added_on&reverse=true&limit=5`,
        {
          headers: { Cookie: cookie },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (listRes.ok) {
        const list: QbitTorrentInfo[] = await listRes.json();
        const match =
          list.find((t) =>
            String(t.name ?? "")
              .toLowerCase()
              .includes(params.torrentName.slice(0, 20).toLowerCase()),
          ) ?? list[0];
        torrentHash = match?.hash ?? null;
      }
    } catch {
      // hash rămâne null — polling-ul nu va porni pentru acest torrent
    }

    const catName = params.categoryName || CATEGORY_NAMES[catId] || `Cat ${catId}`;
    if (!params.skipLog) {
      import("../activity-log")
        .then(({ logActivity }) =>
          logActivity("torrent_added", `Auto-descărcat: ${params.torrentName}`, {
            category: catName,
            savePath,
            size: params.size,
          }),
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
    });

    if (torrentHash) {
      const plexType = isMovie ? "movie" : "show";
      pollUntilComplete(
        url,
        cookie,
        torrentHash,
        plexType,
        params.torrentName,
        params.torrentId,
      ).catch(() => {});
    }

    return { status: "ok", torrentName: params.torrentName, savePath };
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}
