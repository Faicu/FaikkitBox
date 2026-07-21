import { createServerFn } from "@tanstack/react-start";
import type { FilelistLogEntry, DownloadLogRow } from "./types";
import { qbitLogin } from "./qbit-client";

// ---------------------------------------------------------------------------
// Log persistent al descărcărilor
// ---------------------------------------------------------------------------

// Persistență SQLite (node:sqlite nativ) — vezi src/lib/db.ts

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

export async function appendDownloadLog(entry: FilelistLogEntry): Promise<void> {
  try {
    const { getDb } = await import("../db");
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO downloads
       (id, name, size, category, category_name, freeleech, internal, save_path, downloaded_at, completed_at, torrent_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

export const getFilelistDownloadLog = createServerFn({ method: "GET" }).handler(
  async (): Promise<FilelistLogEntry[]> => {
    return readDownloadLog();
  },
);

export const deleteFilelistLogEntry = createServerFn({ method: "POST" })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; qbitDeleted?: boolean }> => {
    const { requireAdmin } = await import("../admin.server");
    await requireAdmin();
    try {
      const { getDb } = await import("../db");
      const db = getDb();

      // Obținem hash-ul torrentului înainte de ștergere
      const row = db.prepare("SELECT torrent_hash FROM downloads WHERE id = ?").get(data.id) as
        { torrent_hash: string | null } | undefined;
      const torrentHash = row?.torrent_hash ?? null;

      db.prepare("DELETE FROM downloads WHERE id = ?").run(data.id);

      // Ștergem și din qBittorrent (cu fișierele de pe disk)
      let qbitDeleted = false;
      if (torrentHash) {
        try {
          const qbitUrl = (process.env.QBIT_URL ?? "http://192.168.1.192:25556").replace(/\/$/, "");
          const user = process.env.QBIT_USERNAME ?? "";
          const pass = process.env.QBIT_PASSWORD ?? "";
          const cookie = await qbitLogin(qbitUrl, user, pass);
          const form = new URLSearchParams({ hashes: torrentHash, deleteFiles: "true" });
          const res = await fetch(`${qbitUrl}/api/v2/torrents/delete`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
            body: form.toString(),
          });
          qbitDeleted = res.ok;
        } catch (e) {
          console.warn("[filelist] Nu am putut șterge din qBit:", e);
        }
      }

      return { ok: true, qbitDeleted };
    } catch (e) {
      console.error("[filelist] Nu am putut șterge intrarea din log:", e);
      return { ok: false };
    }
  });
