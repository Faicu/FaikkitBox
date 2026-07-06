import { createServerFn } from "@tanstack/react-start";
import { writeFile, unlink, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Tipuri
// ---------------------------------------------------------------------------

export interface FilelistTorrent {
  id: number;
  name: string;
  size: number;        // bytes
  seeders: number;
  leechers: number;
  times_completed: number;
  category: number;
  categoryName: string;
  freeleech: boolean;
  internal: boolean;
  upload_date: string;
  imdb?: string;
}

export type FilelistCategory = "movies" | "series" | "all";

export interface FilelistSearchResult {
  status: "ok" | "error";
  error?: string;
  torrents: FilelistTorrent[];
}

export interface FilelistDownloadResult {
  status: "ok" | "error";
  error?: string;
  torrentName?: string;
  savePath?: string;
}

export interface FilelistLogEntry {
  id: number;
  name: string;
  size: number;
  category: number;
  categoryName: string;
  freeleech: boolean;
  internal: boolean;
  savePath: string;
  downloadedAt: string;
  completedAt: string | null;
}

// ---------------------------------------------------------------------------
// Categorii Filelist.io
// ---------------------------------------------------------------------------

// Filme: SD=1, DVD=2, DVD-RO=3, HD=4, HD-RO=19, 4K=6, 4K-RO=26
// Seriale: SD=23, HD=21, HD-RO=22, 4K=27
const MOVIE_CATEGORIES = [1, 2, 3, 4, 6, 19, 26];
const SERIES_CATEGORIES = [21, 22, 23, 27];
const ALL_CATEGORIES = [...MOVIE_CATEGORIES, ...SERIES_CATEGORIES];

const CATEGORY_NAMES: Record<number, string> = {
  1: "Filme SD",
  2: "Filme DVD",
  3: "Filme DVD-RO",
  4: "Filme HD",
  6: "Filme 4K",
  19: "Filme HD-RO",
  21: "Seriale HD",
  22: "Seriale HD-RO",
  23: "Seriale SD",
  26: "Filme 4K-RO",
  27: "Seriale 4K",
};

function isMovieCategory(catId: number): boolean {
  return MOVIE_CATEGORIES.includes(catId);
}

// ---------------------------------------------------------------------------
// Log persistent al descărcărilor
// ---------------------------------------------------------------------------

const MAX_LOG_ENTRIES = 50;

// Fișier untracked în repo-ul de pe server — supraviețuiește deploy-urilor
// (git reset --hard nu atinge fișierele untracked).
function downloadLogPath(): string {
  return (
    process.env.FILELIST_LOG_FILE ??
    join(process.env.FAIKKITBOX_REPO_DIR ?? "/opt/faikkitbox", "data", "filelist-downloads.json")
  );
}

async function readDownloadLog(): Promise<FilelistLogEntry[]> {
  try {
    const raw = await readFile(downloadLogPath(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function appendDownloadLog(entry: FilelistLogEntry): Promise<void> {
  try {
    const file = downloadLogPath();
    await mkdir(dirname(file), { recursive: true });
    const log = await readDownloadLog();
    log.unshift(entry);
    await writeFile(file, JSON.stringify(log.slice(0, MAX_LOG_ENTRIES), null, 2), "utf8");
  } catch (e) {
    console.warn("[filelist] Nu am putut scrie log-ul de descărcări:", e);
  }
}

async function markLogEntryComplete(torrentId: number): Promise<void> {
  try {
    const file = downloadLogPath();
    const log = await readDownloadLog();
    const entry = log.find((e) => e.id === torrentId);
    if (entry) {
      entry.completedAt = new Date().toISOString();
      await writeFile(file, JSON.stringify(log, null, 2), "utf8");
    }
  } catch (e) {
    console.warn("[filelist] Nu am putut actualiza log-ul la completare:", e);
  }
}

export const getFilelistDownloadLog = createServerFn({ method: "GET" }).handler(
  async (): Promise<FilelistLogEntry[]> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();
    return readDownloadLog();
  },
);

// ---------------------------------------------------------------------------
// Helper: autentificare qBittorrent (cookie SID)
// ---------------------------------------------------------------------------

let qbitCookie: string | null = null;

async function qbitLogin(url: string, user: string, pass: string): Promise<string> {
  const body = new URLSearchParams({ username: user, password: pass });
  const res = await fetch(`${url}/api/v2/auth/login`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": url,
      "Origin": url,
    },
  });
  if (!res.ok) throw new Error(`qBit login HTTP ${res.status}`);
  const text = await res.text();
  if (text.trim() !== "Ok.") throw new Error(`qBit login respins: ${text}`);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const sid = setCookie.split(";")[0];
  if (!sid) throw new Error("qBit: cookie SID absent");
  qbitCookie = sid;
  return sid;
}

async function qbitEnsureCookie(url: string, user: string, pass: string): Promise<string> {
  if (qbitCookie) return qbitCookie;
  return qbitLogin(url, user, pass);
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
): Promise<void> {
  const MAX_WAIT_MS = 48 * 60 * 60 * 1000;
  const POLL_INTERVAL_MS = 30_000;
  const started = Date.now();

  console.log(`[filelist] Pornesc polling pentru "${torrentName}" (${torrentHash})`);

  while (Date.now() - started < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    try {
      const res = await fetch(
        `${qbitUrl}/api/v2/torrents/info?hashes=${torrentHash}`,
        { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) continue;

      const list: any[] = await res.json();
      if (!list.length) continue;

      const torrent = list[0];
      const progress = Number(torrent.progress ?? 0);
      const state: string = torrent.state ?? "";

      console.log(`[filelist] "${torrentName}" — progress: ${(progress * 100).toFixed(1)}% state: ${state}`);

      const isDone = progress >= 1 && (
        state.includes("UP") || state === "uploading" || state === "pausedUP" || state === "stalledUP"
      );

      if (isDone) {
        console.log(`[filelist] "${torrentName}" complet — dau refresh Plex`);
        await markLogEntryComplete(torrentId);
        const sectionKey = await plexFindLibraryKey(plexType);
        if (sectionKey) await plexRefreshLibrary(sectionKey);
        console.log(`[filelist] Plex refresh trimis pentru secțiunea ${sectionKey}`);
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
    const data = await res.json();
    const dirs = data?.MediaContainer?.Directory ?? [];
    const match = dirs.find((d: any) => d.type === type);
    return match ? String(match.key) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Server function: căutare pe Filelist.io
// ---------------------------------------------------------------------------

export const searchFilelist = createServerFn({ method: "GET" })
  .inputValidator((data: { query: string; category?: FilelistCategory }) => data)
  .handler(async ({ data }): Promise<FilelistSearchResult> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();

    const username = process.env.FILELIST_USERNAME;
    const passkey = process.env.FILELIST_PASSKEY;
    if (!username || !passkey) {
      return { status: "error", error: "FILELIST_USERNAME / FILELIST_PASSKEY nu sunt configurate în .env", torrents: [] };
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

      const raw: any[] = await res.json();

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
        category: Number(t.category ?? 0),
        categoryName: CATEGORY_NAMES[Number(t.category)] ?? `Cat ${t.category}`,
        freeleech: t.freeleech === "1" || t.freeleech === true,
        internal: t.internal === "1" || t.internal === true,
        upload_date: String(t.upload_date ?? ""),
        imdb: t.imdb || undefined,
      }));

      // Sortează: mai întâi seeders descrescător
      torrents.sort((a, b) => b.seeders - a.seeders);

      return { status: "ok", torrents };
    } catch (e: any) {
      return { status: "error", error: e?.message ?? String(e), torrents: [] };
    }
  });

// ---------------------------------------------------------------------------
// Server function: descarcă torrent și trimite la qBittorrent
// ---------------------------------------------------------------------------

export const downloadFilelist = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      torrentId: number;
      torrentName: string;
      categoryId: number;
      size?: number;
      freeleech?: boolean;
      internal?: boolean;
    }) => data,
  )
  .handler(async ({ data }): Promise<FilelistDownloadResult> => {
    const { requireAdmin } = await import("./admin.server");
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

    const isMovie = isMovieCategory(data.categoryId);
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
        return { status: "error", error: `Eroare la descărcarea torrentului: HTTP ${dlRes.status}` };
      }
      torrentBuffer = await dlRes.arrayBuffer();
    } catch (e: any) {
      return { status: "error", error: `Eroare rețea Filelist: ${e?.message ?? e}` };
    }

    // 2. Scrie temporar fișierul .torrent pe disk
    const safeName = data.torrentName.replace(/[^a-z0-9_\-\. ]/gi, "_").slice(0, 80);
    const tmpPath = join(tmpdir(), `faikkitbox_${data.torrentId}_${Date.now()}.torrent`);
    await writeFile(tmpPath, Buffer.from(torrentBuffer));

    try {
      // 3. Autentifică-te la qBittorrent
      const url = qbitBase.replace(/\/$/, "");
      let cookie: string;
      try {
        cookie = await qbitEnsureCookie(url, qbitUser, qbitPass);
      } catch {
        qbitCookie = null;
        cookie = await qbitLogin(url, qbitUser, qbitPass);
      }

      // 4. Trimite torrentul la qBittorrent cu save path corect
      const form = new FormData();
      const fileBytes = await import("node:fs/promises").then((m) => m.readFile(tmpPath));
      form.append("torrents", new Blob([fileBytes], { type: "application/x-bittorrent" }), `${safeName}.torrent`);
      form.append("savepath", savePath);
      form.append("category", isMovie ? "filme" : "seriale");

      const uploadRes = await fetch(`${url}/api/v2/torrents/add`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });

      if (!uploadRes.ok) {
        const txt = await uploadRes.text().catch(() => "");
        return { status: "error", error: `qBittorrent upload eșuat: HTTP ${uploadRes.status} ${txt.slice(0, 120)}` };
      }

      const uploadText = await uploadRes.text();
      if (!uploadText.includes("Ok")) {
        console.warn("qBit upload răspuns neașteptat:", uploadText);
      }

      // 5. Găsește hash-ul torrentului proaspăt adăugat
      await new Promise((r) => setTimeout(r, 2000));
      let torrentHash: string | null = null;
      try {
        const listRes = await fetch(`${url}/api/v2/torrents/info?sort=added_on&reverse=true&limit=5`, {
          headers: { Cookie: cookie },
          signal: AbortSignal.timeout(10_000),
        });
        if (listRes.ok) {
          const list: any[] = await listRes.json();
          const match = list.find((t) =>
            String(t.name ?? "").toLowerCase().includes(data.torrentName.slice(0, 20).toLowerCase())
          ) ?? list[0];
          torrentHash = match?.hash ?? null;
        }
      } catch (e) {
        console.warn("[filelist] Nu am putut obține hash-ul torrentului:", e);
      }

      // 6. Loghează descărcarea imediat (completedAt null = în curs)
      await appendDownloadLog({
        id: data.torrentId,
        name: data.torrentName,
        size: data.size ?? 0,
        category: data.categoryId,
        categoryName: CATEGORY_NAMES[data.categoryId] ?? `Cat ${data.categoryId}`,
        freeleech: data.freeleech ?? false,
        internal: data.internal ?? false,
        savePath,
        downloadedAt: new Date().toISOString(),
        completedAt: null,
      });

      // 7. Pornește polling background — refresh Plex și marchează complet DOAR la final
      const plexType = isMovie ? "movie" : "show";
      if (torrentHash) {
        pollUntilComplete(url, cookie, torrentHash, plexType, data.torrentName, data.torrentId).catch((e) =>
          console.error("[filelist] Eroare polling:", e),
        );
      } else {
        console.warn("[filelist] Hash nedisponibil — Plex nu va fi refreshuit automat");
      }

      return { status: "ok", torrentName: data.torrentName, savePath };
    } finally {
      // Curăță fișierul temporar
      await unlink(tmpPath).catch(() => {});
    }
  });
