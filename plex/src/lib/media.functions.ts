import { createServerFn } from "@tanstack/react-start";
import { getPlexDb, getAlertSettings, updateAlertSettings, logActivity } from "./plex-db";
import { requireUser, requireAdminUser } from "./auth.server";
import { pushToUser, pushToAdmins } from "./push";

import { searchTmdb as tmdbSearch, getTmdbDetails } from "@faikkitbox/lib/tmdb.functions";
import {
  checkPlexHasTitleInternal,
  getPlexEpisodesInSeasonInternal,
} from "@faikkitbox/lib/services/plex-library";
import { discoverPlexUrl } from "@faikkitbox/lib/services/plex-shared";
import { fetchJson } from "@faikkitbox/lib/services/shared";
import { searchFilelistRaw, downloadFilelistInternal } from "@faikkitbox/lib/filelist/download";
import type { FilelistTorrent } from "@faikkitbox/lib/filelist/types";
import { qbitGet, qbitPostForm } from "@faikkitbox/lib/qbit-client";
import { fetchPlexHistory, type PlexHistoryEntry } from "@faikkitbox/lib/services/plex";

// ---------------------------------------------------------------------------
// Config qBittorrent — aceleași env vars ca FaikkitBox (QBIT_URL/USERNAME/
// PASSWORD), citite direct din plex/.env (partajate).
// ---------------------------------------------------------------------------
function qbitConfig(): { url: string; user: string; pass: string } | null {
  const url = process.env.QBIT_URL;
  const user = process.env.QBIT_USERNAME;
  const pass = process.env.QBIT_PASSWORD;
  if (!url || !user || !pass) return null;
  return { url: url.replace(/\/$/, ""), user, pass };
}

interface QbitTorrentInfoRow {
  hash: string;
  name: string;
  progress?: number;
  state?: string;
}

// Găsește hash-ul unui torrent proaspăt adăugat, potrivind după nume (aceeași
// strategie ca downloadFilelistCore intern din FaikkitBox, dar reimplementată
// aici — nu avem acces la hash-ul intern calculat acolo).
async function findTorrentHashByName(torrentName: string): Promise<string | null> {
  const cfg = qbitConfig();
  if (!cfg) return null;
  try {
    const res = await qbitGet(
      cfg.url,
      "/api/v2/torrents/info?sort=added_on&reverse=true&limit=10",
      cfg.user,
      cfg.pass,
    );
    if (!res.ok) return null;
    const list = (await res.json()) as QbitTorrentInfoRow[];
    const needle = torrentName.slice(0, 20).toLowerCase();
    const match = list.find((t) => String(t.name ?? "").toLowerCase().includes(needle));
    return match?.hash ?? null;
  } catch {
    return null;
  }
}

async function getTorrentProgress(hash: string): Promise<{ progress: number; state: string } | null> {
  const cfg = qbitConfig();
  if (!cfg) return null;
  try {
    const res = await qbitGet(cfg.url, `/api/v2/torrents/info?hashes=${hash}`, cfg.user, cfg.pass);
    if (!res.ok) return null;
    const list = (await res.json()) as QbitTorrentInfoRow[];
    const t = list[0];
    if (!t) return null;
    return { progress: Number(t.progress ?? 0), state: t.state ?? "" };
  } catch {
    return null;
  }
}

// Șterge efectiv un torrent + fișierele lui de pe disk din qBittorrent.
async function deleteTorrentByHash(hash: string): Promise<void> {
  const cfg = qbitConfig();
  if (!cfg) return;
  try {
    await qbitPostForm(cfg.url, "/api/v2/torrents/delete", cfg.user, cfg.pass, {
      hashes: hash,
      deleteFiles: "true",
    });
  } catch (err) {
    console.warn("[media.functions] Ștergere torrent qBit eșuată:", err);
  }
}

export const searchTitles = createServerFn({ method: "GET" })
  .validator((data: { query: string }) => data)
  .handler(async ({ data }) => {
    await requireUser();
    return tmdbSearch({ data: { query: data.query } });
  });

export const getTitleDetails = createServerFn({ method: "GET" })
  .validator((data: { tmdbId: number; mediaType: "movie" | "tv" }) => data)
  .handler(async ({ data }) => {
    await requireUser();
    return getTmdbDetails({ data: { id: data.tmdbId, mediaType: data.mediaType } });
  });

export const checkPlexAvailability = createServerFn({ method: "GET" })
  .validator((data: { title: string; originalTitle: string; mediaType: "movie" | "tv" }) => data)
  .handler(async ({ data }) => {
    await requireUser();
    return checkPlexHasTitleInternal(data.title, data.originalTitle, data.mediaType);
  });

// ---------------------------------------------------------------------------
// Adaugă un titlu deja existent pe Plex în lista personală a userului
// (fără pipeline de descărcare, is_owner=0)
// ---------------------------------------------------------------------------
export const addExistingToLibrary = createServerFn({ method: "POST" })
  .validator(
    (data: {
      tmdbId: number;
      mediaType: "movie" | "tv";
      title: string;
      season?: number | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const db = getPlexDb();
    db.prepare(
      `INSERT OR IGNORE INTO media_ownership (user_id, tmdb_id, media_type, title, season, is_owner, added_at)
       VALUES (?, ?, ?, ?, ?, 0, datetime('now'))`,
    ).run(user.id, data.tmdbId, data.mediaType, data.title, data.season ?? null);
    return { status: "ok" as const };
  });

// ---------------------------------------------------------------------------
// Candidați Filelist cu seederi — reimplementat local (nu se atinge
// download.ts din FaikkitBox), pe baza searchFilelistRaw (deja exportată).
// ---------------------------------------------------------------------------
async function searchFilelistCandidates(params: {
  title: string;
  originalTitle: string;
  imdbId?: string | null;
  mediaType: "movie" | "tv";
}): Promise<{ candidates: FilelistTorrent[]; imdbConfirmed: FilelistTorrent[] }> {
  const category = params.mediaType === "movie" ? "movies" : "series";
  const results: FilelistTorrent[] = [];

  if (params.imdbId) {
    const byImdb = await searchFilelistRaw(params.imdbId, category, "imdb");
    results.push(...byImdb);
  }
  if (results.length === 0) {
    for (const q of [params.originalTitle, params.title].filter(Boolean)) {
      const byName = await searchFilelistRaw(q, category, "name");
      results.push(...byName);
      if (byName.length > 0) break;
    }
  }

  const seen = new Set<number>();
  const candidates = results.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
  const imdbConfirmed = params.imdbId
    ? candidates.filter((t) => t.imdb && t.imdb.replace(/^tt/, "") === params.imdbId?.replace(/^tt/, ""))
    : [];

  return { candidates, imdbConfirmed };
}

function pickBestBySeeders(list: FilelistTorrent[]): FilelistTorrent | null {
  if (list.length === 0) return null;
  return [...list].sort((a, b) => b.seeders - a.seeders)[0];
}

function isAmbiguous(list: FilelistTorrent[], pct: number): boolean {
  if (list.length < 2) return false;
  const sorted = [...list].sort((a, b) => b.seeders - a.seeders);
  const [top, second] = sorted;
  if (top.seeders === 0) return false;
  return (top.seeders - second.seeders) / top.seeders < pct;
}

function countActiveTitles(userId: number): number {
  const db = getPlexDb();
  const row = db
    .prepare("SELECT COUNT(*) as c FROM media_ownership WHERE user_id = ? AND is_owner = 1")
    .get(userId) as { c: number };
  return row.c;
}

async function createAlert(
  requestId: number,
  reason: "no_imdb_match" | "low_seeders" | "ambiguous_seeders" | "subtitle_not_found",
  options: unknown,
): Promise<void> {
  const db = getPlexDb();
  db.prepare(
    `INSERT INTO admin_alerts (media_request_id, reason, options_json, status, created_at)
     VALUES (?, ?, ?, 'pending', datetime('now'))`,
  ).run(requestId, reason, JSON.stringify(options));
  db.prepare("UPDATE media_requests SET status = 'pending_admin' WHERE id = ?").run(requestId);
  await pushToAdmins("Alertă nouă", `Necesită decizie: ${reason}`);
}

// ---------------------------------------------------------------------------
// startMediaSetup — pornește fluxul complet pentru un titlu nou
// ---------------------------------------------------------------------------
export const startMediaSetup = createServerFn({ method: "POST" })
  .validator(
    (data: {
      tmdbId: number;
      mediaType: "movie" | "tv";
      title: string;
      originalTitle: string;
      imdbId?: string | null;
      quality: string;
      season?: number | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (user.blocked) throw new Error("Contul tău este blocat.");

    const settings = getAlertSettings();
    if (countActiveTitles(user.id) >= settings.max_titles_per_user) {
      throw new Error(
        `Ai atins limita de ${settings.max_titles_per_user} titluri — șterge ceva înainte de a adăuga altceva.`,
      );
    }

    const db = getPlexDb();
    const insert = db.prepare(
      `INSERT INTO media_requests (user_id, tmdb_id, imdb_id, media_type, title, season, quality, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'searching_filelist', datetime('now'))`,
    );
    const info = insert.run(
      user.id,
      data.tmdbId,
      data.imdbId ?? null,
      data.mediaType,
      data.title,
      data.season ?? null,
      data.quality,
    );
    const requestId = Number(info.lastInsertRowid);

    void runMediaPipeline(requestId).catch((err) => {
      console.error("[media.functions] pipeline eșuat:", err);
      db.prepare("UPDATE media_requests SET status = 'failed', error = ? WHERE id = ?").run(
        String(err instanceof Error ? err.message : err),
        requestId,
      );
    });

    await pushToUser(user.id, "Descărcare inițiată", `Am pornit căutarea pentru „${data.title}”.`);
    logActivity({
      userId: user.id,
      action: "download_start",
      tmdbId: data.tmdbId,
      title: data.title,
    });
    await pushToAdmins("Cerere descărcare", `${user.username} a inițiat „${data.title}”.`);

    return { requestId };
  });

async function runMediaPipeline(requestId: number, forcedTorrent?: FilelistTorrent): Promise<void> {
  const db = getPlexDb();
  const req = db.prepare("SELECT * FROM media_requests WHERE id = ?").get(requestId) as
    | {
        id: number;
        user_id: number;
        tmdb_id: number;
        imdb_id: string | null;
        media_type: "movie" | "tv";
        title: string;
        season: number | null;
        quality: string;
      }
    | undefined;
  if (!req) return;

  const settings = getAlertSettings();
  let torrent = forcedTorrent ?? null;

  if (!torrent) {
    const { candidates, imdbConfirmed } = await searchFilelistCandidates({
      title: req.title,
      originalTitle: req.title,
      imdbId: req.imdb_id,
      mediaType: req.media_type,
    });

    if (imdbConfirmed.length === 0) {
      await createAlert(requestId, "no_imdb_match", { candidates: candidates.slice(0, 10) });
      return;
    }
    const best = pickBestBySeeders(imdbConfirmed);
    if (!best || best.seeders < settings.min_seeders) {
      await createAlert(requestId, "low_seeders", { candidates: imdbConfirmed });
      return;
    }
    if (isAmbiguous(imdbConfirmed, settings.ambiguous_seeders_pct)) {
      await createAlert(requestId, "ambiguous_seeders", { candidates: imdbConfirmed });
      return;
    }
    torrent = best;
  }

  db.prepare("UPDATE media_requests SET status = 'downloading' WHERE id = ?").run(requestId);

  const result = await downloadFilelistInternal({
    torrentId: torrent.id,
    torrentName: torrent.name,
    categoryId: torrent.category,
    categoryName: torrent.categoryName,
    size: torrent.size,
    freeleech: torrent.freeleech,
    internal: torrent.internal,
    imdb: torrent.imdb ?? req.imdb_id ?? undefined,
    skipLog: true,
  });

  if (result.status !== "ok") {
    db.prepare("UPDATE media_requests SET status = 'failed', error = ? WHERE id = ?").run(
      result.error ?? "eroare necunoscută",
      requestId,
    );
    return;
  }

  await watchForCompletion(requestId, torrent.name);
}

// Progres real: caută hash-ul torrentului proaspăt adăugat în qBittorrent și
// scrie progresul lui (0-99%) în media_requests.progress la fiecare tick;
// când qBit raportează descărcarea completă, mai așteaptă confirmarea că
// titlul a apărut pe Plex (downloadFilelistInternal face refreshPlexLibrary +
// pipeline subtitrări în fundal, deci "descărcat 100%" în qBit nu înseamnă
// neapărat "gata pe Plex" imediat) înainte de a marca cererea "complete".
async function watchForCompletion(requestId: number, torrentName: string): Promise<void> {
  const db = getPlexDb();
  const req = db.prepare("SELECT * FROM media_requests WHERE id = ?").get(requestId) as {
    id: number;
    user_id: number;
    tmdb_id: number;
    media_type: "movie" | "tv";
    title: string;
    season: number | null;
    quality: string;
  };

  // Așteaptă puțin ca torrentul să apară în lista qBit, apoi găsește hash-ul.
  let hash: string | null = null;
  for (let i = 0; i < 6 && !hash; i++) {
    await new Promise((r) => setTimeout(r, 3_000));
    hash = await findTorrentHashByName(torrentName);
  }

  const maxAttempts = 480; // ~4h la interval de 30s (progres qBit + apariție Plex)
  let downloadDone = false;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 30_000));

    if (!downloadDone && hash) {
      const info = await getTorrentProgress(hash);
      if (info) {
        const pct = Math.min(99, Math.round(info.progress * 100));
        db.prepare("UPDATE media_requests SET progress = ? WHERE id = ?").run(pct, requestId);
        if (info.progress >= 1) downloadDone = true;
      }
    }

    try {
      const found = await checkPlexHasTitleInternal(req.title, req.title, req.media_type);
      if (found?.found) {
        finalizeRequest(req, torrentName, hash);
        return;
      }
    } catch {
      // ignoră, mai încearcă
    }
  }
  db.prepare("UPDATE media_requests SET status = 'failed', error = ? WHERE id = ?").run(
    "Timeout — nu a apărut pe Plex în timp util",
    requestId,
  );
}

function finalizeRequest(
  req: {
    id: number;
    user_id: number;
    tmdb_id: number;
    media_type: "movie" | "tv";
    title: string;
    season: number | null;
    quality: string;
  },
  torrentName: string,
  torrentHash: string | null,
): void {
  const db = getPlexDb();
  db.prepare(
    "UPDATE media_requests SET status = 'complete', progress = 100, completed_at = datetime('now') WHERE id = ?",
  ).run(req.id);

  let ownership = db
    .prepare(
      "SELECT id FROM media_ownership WHERE user_id = ? AND tmdb_id = ? AND media_type = ? AND season IS ?",
    )
    .get(req.user_id, req.tmdb_id, req.media_type, req.season) as { id: number } | undefined;

  if (!ownership) {
    const info = db
      .prepare(
        `INSERT INTO media_ownership (user_id, tmdb_id, media_type, title, season, is_owner, added_at)
         VALUES (?, ?, ?, ?, ?, 1, datetime('now'))`,
      )
      .run(req.user_id, req.tmdb_id, req.media_type, req.title, req.season);
    ownership = { id: Number(info.lastInsertRowid) };
  }

  db.prepare(
    `INSERT OR IGNORE INTO media_qualities (ownership_id, quality, subtitle_source, torrent_name, torrent_hash, added_at)
     VALUES (?, ?, 'auto', ?, ?, datetime('now'))`,
  ).run(ownership.id, req.quality, torrentName, torrentHash);

  logActivity({
    userId: req.user_id,
    action: "download_complete",
    tmdbId: req.tmdb_id,
    title: req.title,
  });
  void pushToUser(req.user_id, "Gata pe Plex", `„${req.title}” e disponibil acum pe Plex.`);
  const db2 = getPlexDb();
  const u = db2.prepare("SELECT username FROM users WHERE id = ?").get(req.user_id) as
    | { username: string }
    | undefined;
  void pushToAdmins(
    "Descărcare finalizată",
    `${u?.username ?? "Un client"} a finalizat descărcarea „${req.title}”.`,
  );
}

export const getRequestStatus = createServerFn({ method: "GET" })
  .validator((data: { requestId: number }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const db = getPlexDb();
    const row = db
      .prepare("SELECT * FROM media_requests WHERE id = ? AND user_id = ?")
      .get(data.requestId, user.id) as
      | { id: number; status: string; progress: number; title: string }
      | undefined;
    if (!row) throw new Error("Cerere negăsită");
    // pending_admin nu expune niciodată motivul către user
    const publicStatus = row.status === "pending_admin" ? "pending" : row.status;
    return { status: publicStatus, progress: row.progress, title: row.title };
  });

export const getMyLibrary = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const db = getPlexDb();
  const rows = db
    .prepare("SELECT * FROM media_ownership WHERE user_id = ? ORDER BY added_at DESC")
    .all(user.id) as Array<{
    id: number;
    tmdb_id: number;
    media_type: string;
    title: string;
    season: number | null;
    is_owner: number;
    added_at: string;
  }>;
  const qualitiesStmt = db.prepare("SELECT * FROM media_qualities WHERE ownership_id = ?");
  return rows.map((r) => ({
    ...r,
    qualities: qualitiesStmt.all(r.id) as Array<{
      id: number;
      quality: string;
      subtitle_source: string | null;
      added_at: string;
    }>,
  }));
});

// Șterge efectiv toate calitățile unei intrări din media_ownership (sau doar
// una, dacă `quality` e specificată): torrentul + fișierele lui din
// qBittorrent (deleteFiles=true, care curăță și .srt-urile din același
// folder), apoi rândurile din plex.db.
async function deleteOwnershipContent(
  ownershipId: number,
  quality: string | undefined,
): Promise<{ title: string }> {
  const db = getPlexDb();
  const owner = db.prepare("SELECT * FROM media_ownership WHERE id = ?").get(ownershipId) as
    | { id: number; title: string }
    | undefined;
  if (!owner) throw new Error("Conținut negăsit.");

  const qualityRows = db
    .prepare(
      quality
        ? "SELECT * FROM media_qualities WHERE ownership_id = ? AND quality = ?"
        : "SELECT * FROM media_qualities WHERE ownership_id = ?",
    )
    .all(...(quality ? [ownershipId, quality] : [ownershipId])) as Array<{
    id: number;
    quality: string;
    torrent_hash: string | null;
  }>;

  for (const q of qualityRows) {
    if (q.torrent_hash) {
      await deleteTorrentByHash(q.torrent_hash);
    }
  }

  if (quality) {
    db.prepare("DELETE FROM media_qualities WHERE ownership_id = ? AND quality = ?").run(
      ownershipId,
      quality,
    );
    const remaining = db
      .prepare("SELECT COUNT(*) as c FROM media_qualities WHERE ownership_id = ?")
      .get(ownershipId) as { c: number };
    if (remaining.c === 0) {
      db.prepare("DELETE FROM media_ownership WHERE id = ?").run(ownershipId);
    }
  } else {
    db.prepare("DELETE FROM media_qualities WHERE ownership_id = ?").run(ownershipId);
    db.prepare("DELETE FROM media_ownership WHERE id = ?").run(ownershipId);
  }

  return { title: owner.title };
}

export const deleteMyMedia = createServerFn({ method: "POST" })
  .validator((data: { ownershipId: number; quality?: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const db = getPlexDb();
    const row = db
      .prepare("SELECT * FROM media_ownership WHERE id = ? AND user_id = ?")
      .get(data.ownershipId, user.id) as
      | { id: number; is_owner: number; title: string }
      | undefined;
    if (!row || !row.is_owner) throw new Error("Nu ești owner-ul acestui conținut.");

    const { title } = await deleteOwnershipContent(data.ownershipId, data.quality);

    logActivity({ userId: user.id, action: "delete_media", title });
    await pushToAdmins("Conținut șters", `${user.username} a șters „${title}”.`);
    return { status: "ok" as const };
  });

// Echivalentul din panoul Admin — poate șterge orice conținut, indiferent de
// owner (secțiunea „Conținut media").
export const deleteMediaAdmin = createServerFn({ method: "POST" })
  .validator((data: { ownershipId: number; quality?: string }) => data)
  .handler(async ({ data }) => {
    const admin = await requireAdminUser();
    const { title } = await deleteOwnershipContent(data.ownershipId, data.quality);
    logActivity({ userId: admin.id, action: "delete_media", title, detail: "admin" });
    await pushToAdmins("Conținut șters (Admin)", `${admin.username} a șters „${title}”.`);
    return { status: "ok" as const };
  });

// Toate calitățile/deținerile din portal — pentru panoul Admin, secțiunea
// „Conținut media".
export const getAllMediaContent = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminUser();
  const db = getPlexDb();
  const rows = db
    .prepare(
      `SELECT o.*, u.username FROM media_ownership o JOIN users u ON u.id = o.user_id ORDER BY o.added_at DESC`,
    )
    .all() as Array<{
    id: number;
    user_id: number;
    tmdb_id: number;
    media_type: string;
    title: string;
    season: number | null;
    is_owner: number;
    added_at: string;
    username: string;
  }>;
  const qualitiesStmt = db.prepare("SELECT * FROM media_qualities WHERE ownership_id = ?");
  return rows.map((r) => ({
    ...r,
    qualities: qualitiesStmt.all(r.id) as Array<{
      id: number;
      quality: string;
      subtitle_source: string | null;
      torrent_name: string | null;
    }>,
  }));
});

export const requestExtraQuality = createServerFn({ method: "POST" })
  .validator((data: { ownershipId: number; quality: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const db = getPlexDb();
    const row = db
      .prepare("SELECT * FROM media_ownership WHERE id = ? AND user_id = ?")
      .get(data.ownershipId, user.id) as
      | { id: number; tmdb_id: number; media_type: "movie" | "tv"; title: string; season: number | null }
      | undefined;
    if (!row) throw new Error("Conținut negăsit.");

    const insert = db.prepare(
      `INSERT INTO media_requests (user_id, tmdb_id, imdb_id, media_type, title, season, quality, status, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, 'searching_filelist', datetime('now'))`,
    );
    const info = insert.run(user.id, row.tmdb_id, row.media_type, row.title, row.season, data.quality);
    const requestId = Number(info.lastInsertRowid);
    void runMediaPipeline(requestId).catch((err) => console.error(err));
    return { requestId };
  });

// ---------------------------------------------------------------------------
// Alerte admin
// ---------------------------------------------------------------------------
export const listPendingAlerts = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminUser();
  const db = getPlexDb();
  return db
    .prepare(
      `SELECT a.*, r.title, r.user_id, r.media_type FROM admin_alerts a
       JOIN media_requests r ON r.id = a.media_request_id
       WHERE a.status = 'pending' ORDER BY a.created_at DESC`,
    )
    .all();
});

export const resolveAlert = createServerFn({ method: "POST" })
  .validator((data: { alertId: number; torrentId?: number; cancel?: boolean }) => data)
  .handler(async ({ data }) => {
    await requireAdminUser();
    const db = getPlexDb();
    const alert = db.prepare("SELECT * FROM admin_alerts WHERE id = ?").get(data.alertId) as
      | { id: number; media_request_id: number; options_json: string; reason: string }
      | undefined;
    if (!alert) throw new Error("Alertă negăsită.");

    if (data.cancel) {
      db.prepare(
        "UPDATE admin_alerts SET status = 'cancelled', resolution = 'cancel', resolved_at = datetime('now') WHERE id = ?",
      ).run(data.alertId);
      db.prepare("UPDATE media_requests SET status = 'failed', error = 'Anulat de admin' WHERE id = ?").run(
        alert.media_request_id,
      );
      return { status: "ok" as const };
    }

    const options = JSON.parse(alert.options_json) as { candidates: FilelistTorrent[] };
    const chosen = options.candidates.find((c) => c.id === data.torrentId) ?? options.candidates[0];
    if (!chosen) throw new Error("Niciun candidat disponibil.");

    db.prepare(
      "UPDATE admin_alerts SET status = 'resolved', resolution = ?, resolved_at = datetime('now') WHERE id = ?",
    ).run(String(chosen.id), data.alertId);

    void runMediaPipeline(alert.media_request_id, chosen).catch((err) => console.error(err));
    return { status: "ok" as const };
  });

// ---------------------------------------------------------------------------
// Librăria Plex completă (read-only) + „vizionat de"
// ---------------------------------------------------------------------------
export const getFullPlexLibrary = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return [];
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const discovered = await discoverPlexUrl(token, base);
    const sections = await fetchJson<{
      MediaContainer?: { Directory?: Array<{ key?: string; type?: string; title?: string }> };
    }>(`${discovered.url}/library/sections`, { headers }, 8000);
    const dirs = sections?.MediaContainer?.Directory ?? [];
    const items: Array<{ title: string; type: string; year?: number }> = [];
    for (const dir of dirs) {
      if (dir.type !== "movie" && dir.type !== "show") continue;
      const all = await fetchJson<{
        MediaContainer?: { Metadata?: Array<{ title?: string; year?: number; type?: string }> };
      }>(`${discovered.url}/library/sections/${dir.key}/all`, { headers }, 10000);
      for (const m of all?.MediaContainer?.Metadata ?? []) {
        items.push({ title: m.title ?? "", type: m.type ?? dir.type, year: m.year });
      }
    }
    return items;
  } catch {
    return [];
  }
});

export const markWatched = createServerFn({ method: "POST" })
  .validator((data: { tmdbId: number; title: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    logActivity({ userId: user.id, action: "watch", tmdbId: data.tmdbId, title: data.title });
    await pushToAdmins("Vizionare", `${user.username} a vizionat „${data.title}”.`);
    return { status: "ok" as const };
  });

// ---------------------------------------------------------------------------
// „Cine a vizionat" — combină istoricul real de vizionare din Plex
// (fetchPlexHistory, filtrat după titlu) cu userii cunoscuți în portal
// (matching pe username identic cu contul Plex, validat deja la înregistrare).
// Returnează nume complete (username-uri), fără anonimizare — decizie
// confirmată explicit. Doar clienți cu cont în portal apar aici (userii Plex
// fără cont în portal nu pot fi legați de nimeni).
// ---------------------------------------------------------------------------
export const getWatchers = createServerFn({ method: "GET" })
  .validator((data: { tmdbId: number; mediaType: "movie" | "tv"; title: string }) => data)
  .handler(async ({ data }) => {
    await requireUser();
    const token = process.env.PLEX_TOKEN;
    const base = process.env.PLEX_URL;
    if (!token) return [];
    try {
      const discovered = await discoverPlexUrl(token, base);
      const headers = { Accept: "application/json", "X-Plex-Token": token };
      const history = await fetchPlexHistory(discovered.url, headers);

      const needle = data.title.trim().toLowerCase();
      const matches = (history.recentHistory as PlexHistoryEntry[]).filter((h) => {
        // Pentru seriale, titlul căutat e al serialului (grandparentTitle =
        // "show" în PlexHistoryEntry); pentru filme, titlul intrării direct.
        const candidateTitle = data.mediaType === "tv" ? (h.show ?? h.title) : h.title;
        return (candidateTitle ?? "").trim().toLowerCase() === needle;
      });
      if (matches.length === 0) return [];

      const db = getPlexDb();
      const users = db.prepare("SELECT id, username FROM users").all() as Array<{
        id: number;
        username: string;
      }>;
      const byUsername = new Map(users.map((u) => [u.username.toLowerCase(), u]));

      const seen = new Map<
        number,
        { userId: number; username: string; lastViewedAt: number; views: number }
      >();
      for (const entry of matches) {
        const match = byUsername.get((entry.user ?? "").toLowerCase());
        if (!match) continue; // user Plex fără cont în portal — nu-l putem lega/afișa
        const existing = seen.get(match.id);
        if (existing) {
          existing.views += 1;
          existing.lastViewedAt = Math.max(existing.lastViewedAt, entry.viewedAt);
        } else {
          seen.set(match.id, {
            userId: match.id,
            username: match.username,
            lastViewedAt: entry.viewedAt,
            views: 1,
          });
        }
      }
      return Array.from(seen.values()).sort((a, b) => b.lastViewedAt - a.lastViewedAt);
    } catch (err) {
      console.warn("[media.functions] getWatchers eșuat:", err);
      return [];
    }
  });

// ---------------------------------------------------------------------------
// Admin → Activitate (paginat)
// ---------------------------------------------------------------------------
export const getActivityLog = createServerFn({ method: "GET" })
  .validator((data: { page?: number; pageSize?: number } | undefined) => data ?? {})
  .handler(async ({ data }) => {
    await requireAdminUser();
    const db = getPlexDb();
    const pageSize = Math.min(100, Math.max(1, data.pageSize ?? 30));
    const page = Math.max(0, data.page ?? 0);
    const rows = db
      .prepare(
        `SELECT a.*, u.username FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
         ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(pageSize, page * pageSize);
    const total = (db.prepare("SELECT COUNT(*) as c FROM activity_log").get() as { c: number }).c;
    return { rows, total, page, pageSize };
  });

// ---------------------------------------------------------------------------
// Admin → Setări
// ---------------------------------------------------------------------------
export const getSettings = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdminUser();
  return getAlertSettings();
});

export const updateSettings = createServerFn({ method: "POST" })
  .validator(
    (data: Partial<{
      min_seeders: number;
      ambiguous_seeders_pct: number;
      max_titles_per_user: number;
      default_quality: string;
      default_season_mode: string;
      library_sync_interval_min: number;
      push_enabled: number;
      require_approval: number;
    }>) => data,
  )
  .handler(async ({ data }) => {
    const admin = await requireAdminUser();
    updateAlertSettings(data);
    logActivity({ userId: admin.id, action: "settings_updated", detail: JSON.stringify(data) });
    return getAlertSettings();
  });

// ---------------------------------------------------------------------------
// Sincronizare manuală bibliotecă (buton „Sincronizează acum" din Setări) —
// reutilizează job-ul de backfill din server/plugins/library-sync.ts.
// ---------------------------------------------------------------------------
export const syncLibraryNow = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdminUser();
  const { runLibrarySync } = await import("./library-sync");
  const result = await runLibrarySync();
  return result;
});
