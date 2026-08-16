import { createServerFn } from "@tanstack/react-start";
import type { FilelistLogEntry, DownloadLogRow } from "./types";
import { qbitLogin } from "../qbit-client";
import { refreshPlexLibraryForCategory } from "../plex-refresh";
import { parseSeasonEpisodeFromName } from "../torrent-name-parse";
import { deleteMediaByTorrentHash } from "../media";

// ---------------------------------------------------------------------------
// Log persistent al descărcărilor
// ---------------------------------------------------------------------------

// Persistență SQLite (node:sqlite nativ) — vezi src/lib/db.ts

// Potrivește un titlu din biblioteca Plex (pagina Bibliotecă) cu intrarea lui
// din jurnalul propriu de descărcări — pornind de la IMDb id-ul rezolvat prin
// TMDB (Plex nu expune fiabil IMDb id-ul în răspunsul de metadate). Pentru
// episoade, un IMDb id (cel al serialului) poate avea mai multe intrări în
// jurnal (episod cu episod sau pachet de sezon) — preferăm potrivirea exactă
// pe episod; dacă nu găsim, cădem pe un pachet de sezon care-l conține.
export interface DownloadsMatch {
  id: number;
  torrentHash: string | null;
  category: number | null;
  requestedByUserId: number | null;
  isSeasonPack: boolean;
}

export async function findDownloadsRowForImdb(
  imdbId: string,
  seasonEpisode?: { season: number; episode: number },
): Promise<DownloadsMatch | null> {
  try {
    const { getDb } = await import("../db");
    const rows = getDb()
      .prepare(
        `SELECT id, name, torrent_hash, category, requested_by_user_id
         FROM downloads WHERE imdb = ? ORDER BY downloaded_at DESC`,
      )
      .all(imdbId) as Array<{
      id: number;
      name: string;
      torrent_hash: string | null;
      category: number | null;
      requested_by_user_id: number | null;
    }>;

    if (!rows.length) return null;

    if (!seasonEpisode) {
      const r = rows[0];
      return {
        id: r.id,
        torrentHash: r.torrent_hash,
        category: r.category,
        requestedByUserId: r.requested_by_user_id,
        isSeasonPack: false,
      };
    }

    let seasonPackMatch: (typeof rows)[number] | null = null;
    for (const r of rows) {
      const parsed = parseSeasonEpisodeFromName(r.name);
      if (!parsed || parsed.season !== seasonEpisode.season) continue;
      if (parsed.episode === seasonEpisode.episode) {
        return {
          id: r.id,
          torrentHash: r.torrent_hash,
          category: r.category,
          requestedByUserId: r.requested_by_user_id,
          isSeasonPack: false,
        };
      }
      if (parsed.episode === null && !seasonPackMatch) seasonPackMatch = r;
    }
    if (seasonPackMatch) {
      return {
        id: seasonPackMatch.id,
        torrentHash: seasonPackMatch.torrent_hash,
        category: seasonPackMatch.category,
        requestedByUserId: seasonPackMatch.requested_by_user_id,
        isSeasonPack: true,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function rowToEntry(r: DownloadLogRow): FilelistLogEntry {
  return {
    id: Number(r.id),
    name: r.name,
    size: Number(r.size ?? 0),
    category: Number(r.category ?? 0),
    categoryName: r.category_name ?? "",
    freeleech: !!r.freeleech,
    internal: !!r.internal,
    savePath: r.save_path ?? "",
    downloadedAt: r.downloaded_at,
    completedAt: r.completed_at ?? null,
    torrentHash: r.torrent_hash ?? undefined,
    imdb: r.imdb ?? undefined,
    requestedByUserId: r.requested_by_user_id,
  };
}

export async function readDownloadLog(): Promise<FilelistLogEntry[]> {
  try {
    const { getDb } = await import("../db");
    const rows = getDb()
      .prepare("SELECT * FROM downloads ORDER BY downloaded_at DESC LIMIT 100")
      .all() as unknown as DownloadLogRow[];
    return rows.map(rowToEntry);
  } catch {
    return [];
  }
}

// Fără LIMIT — folosit de backfillSubtitles (download.ts), care trebuie să
// proceseze chiar toate intrările din jurnal, nu doar ultimele 100 afișate
// în UI de readDownloadLog.
export async function readAllDownloadLogEntries(): Promise<FilelistLogEntry[]> {
  try {
    const { getDb } = await import("../db");
    const rows = getDb()
      .prepare("SELECT * FROM downloads ORDER BY downloaded_at DESC")
      .all() as unknown as DownloadLogRow[];
    return rows.map(rowToEntry);
  } catch {
    return [];
  }
}

export async function appendDownloadLog(entry: FilelistLogEntry): Promise<void> {
  try {
    const { getDb } = await import("../db");
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO downloads
       (id, name, size, category, category_name, freeleech, internal, save_path, downloaded_at, completed_at, torrent_hash, imdb, requested_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.name,
        entry.size,
        entry.category,
        entry.categoryName,
        entry.freeleech ? 1 : 0,
        entry.internal ? 1 : 0,
        entry.savePath,
        entry.downloadedAt,
        entry.completedAt,
        entry.torrentHash ?? null,
        entry.imdb ?? null,
        entry.requestedByUserId ?? null,
      );
  } catch (e) {
    console.warn("[filelist] Nu am putut scrie log-ul de descărcări:", e);
  }
}

export async function markLogEntryComplete(torrentId: number): Promise<boolean> {
  try {
    const { getDb } = await import("../db");
    const db = getDb();
    const existing = db
      .prepare("SELECT completed_at FROM downloads WHERE id = ?")
      .get(torrentId) as { completed_at: string | null } | undefined;
    if (existing?.completed_at) return false; // deja marcat de un alt polling loop
    db.prepare("UPDATE downloads SET completed_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      torrentId,
    );
    return true;
  } catch (e) {
    console.warn("[filelist] Nu am putut actualiza log-ul la completare:", e);
    return false;
  }
}

// Echivalentul de mai sus, dar sursat direct din `media` (media.id), nu din
// `downloads` — folosit de Bibliotecă. Orice rând `media` cu torrent_hash
// cunoscut e ștergibil, indiferent dacă provine dintr-o descărcare pornită
// prin aplicație sau a fost rezolvat retroactiv la backfill (vezi
// media-backfill.ts) — nu mai depinde de existența unui rând `downloads`
// (care, dacă totuși există pentru același torrent, e curățat și el, prin
// torrent_hash — nu mai are sens să rămână orfan).
export const deleteMediaEntry = createServerFn({ method: "POST" })
  .validator((data: { mediaId: number }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; qbitDeleted?: boolean; error?: string }> => {
    const { requireAuth, isAdminOrOwner } = await import("../admin.server");
    const session = await requireAuth();
    try {
      const { getDb } = await import("../db");
      const db = getDb();

      const row = db
        .prepare("SELECT torrent_hash, category, requested_by_user_id FROM media WHERE id = ?")
        .get(data.mediaId) as
        | {
            torrent_hash: string | null;
            category: number | null;
            requested_by_user_id: number | null;
          }
        | undefined;

      if (!row) {
        return { ok: false, error: "Titlul nu a fost găsit" };
      }
      if (!isAdminOrOwner(session, row.requested_by_user_id)) {
        return { ok: false, error: "Doar cel care a adăugat titlul sau un admin poate șterge" };
      }
      if (!row.torrent_hash) {
        return { ok: false, error: "Hash-ul torrentului e necunoscut — nu poate fi șters automat" };
      }

      let qbitDeleted = false;
      try {
        const qbitUrl = (process.env.QBIT_URL ?? "http://192.168.1.192:25556").replace(/\/$/, "");
        const user = process.env.QBIT_USERNAME ?? "";
        const pass = process.env.QBIT_PASSWORD ?? "";
        const cookie = await qbitLogin(qbitUrl, user, pass);
        const form = new URLSearchParams({ hashes: row.torrent_hash, deleteFiles: "true" });
        const res = await fetch(`${qbitUrl}/api/v2/torrents/delete`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
          body: form.toString(),
        });
        qbitDeleted = res.ok;
      } catch (e) {
        console.warn("[filelist] Nu am putut șterge din qBit:", e);
      }

      // Toate rândurile media care împart același torrent_hash (episoadele
      // unui pachet de sezon) — nu doar cel apăsat — altfel restul rămân
      // orfane, cu un hash care nu mai există în qBittorrent, și apar
      // permanent ca "se descarcă" în Bibliotecă. Mesajul de confirmare din
      // drawer promite ștergerea întregului pachet — asta chiar face.
      deleteMediaByTorrentHash(row.torrent_hash);
      db.prepare("DELETE FROM downloads WHERE torrent_hash = ?").run(row.torrent_hash);

      if (row.category !== null) {
        refreshPlexLibraryForCategory(row.category).catch(() => {});
      }

      return { ok: true, qbitDeleted };
    } catch (e) {
      console.error("[filelist] Nu am putut șterge titlul:", e);
      return { ok: false };
    }
  });
