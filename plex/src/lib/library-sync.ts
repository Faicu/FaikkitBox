// ---------------------------------------------------------------------------
// Sincronizare librărie Plex existentă → media_ownership/media_qualities cu
// owner implicit Faicu, pentru orice titlu care nu are deja un rând (conținut
// descărcat înainte de acest portal, sau adăugat direct pe disk). Idempotent:
// verifică existența înainte de insert, nu suprascrie ownership real deja
// setat de alți useri.
//
// Nu modifică nimic din /opt/faikkitbox/src/lib — folosește doar
// discoverPlexUrl (deja exportat) + fetch direct la API-ul Plex, la fel ca
// getFullPlexLibrary din media.functions.ts.
// ---------------------------------------------------------------------------

import { getPlexDb } from "./plex-db";
import { discoverPlexUrl } from "@faikkitbox/lib/services/plex-shared";
import { fetchJson } from "@faikkitbox/lib/services/shared";

interface PlexLibraryItem {
  ratingKey: string;
  title: string;
  type: string; // 'movie' | 'show'
  year?: number;
  tmdbId: number | null;
}

async function listAllPlexItems(): Promise<PlexLibraryItem[]> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return [];
  const headers = { Accept: "application/json", "X-Plex-Token": token };
  const discovered = await discoverPlexUrl(token, base);

  const sections = await fetchJson<{
    MediaContainer?: { Directory?: Array<{ key?: string; type?: string }> };
  }>(`${discovered.url}/library/sections`, { headers }, 8000);
  const dirs = sections?.MediaContainer?.Directory ?? [];

  const items: PlexLibraryItem[] = [];
  for (const dir of dirs) {
    if (dir.type !== "movie" && dir.type !== "show") continue;
    const all = await fetchJson<{
      MediaContainer?: {
        Metadata?: Array<{
          ratingKey?: string;
          title?: string;
          year?: number;
          type?: string;
          Guid?: Array<{ id?: string }>;
        }>;
      };
    }>(`${discovered.url}/library/sections/${dir.key}/all?includeGuids=1`, { headers }, 15000);
    for (const m of all?.MediaContainer?.Metadata ?? []) {
      if (!m.ratingKey || !m.title) continue;
      const tmdbGuid = (m.Guid ?? []).find((g) => g.id?.startsWith("tmdb://"));
      const tmdbId = tmdbGuid ? Number(tmdbGuid.id!.replace("tmdb://", "")) || null : null;
      items.push({
        ratingKey: m.ratingKey,
        title: m.title,
        type: m.type ?? dir.type,
        year: m.year,
        tmdbId,
      });
    }
  }
  return items;
}

export interface LibrarySyncResult {
  scanned: number;
  inserted: number;
}

export async function runLibrarySync(): Promise<LibrarySyncResult> {
  const db = getPlexDb();
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as
    | { id: number }
    | undefined;
  if (!admin) return { scanned: 0, inserted: 0 };

  let items: PlexLibraryItem[];
  try {
    items = await listAllPlexItems();
  } catch (err) {
    console.warn("[library-sync] Eroare la listarea librăriei Plex:", err);
    return { scanned: 0, inserted: 0 };
  }

  let inserted = 0;
  const insertOwnership = db.prepare(
    `INSERT OR IGNORE INTO media_ownership (user_id, tmdb_id, media_type, title, season, is_owner, added_at)
     VALUES (?, ?, ?, ?, NULL, 1, datetime('now'))`,
  );
  const insertQuality = db.prepare(
    `INSERT OR IGNORE INTO media_qualities (ownership_id, quality, subtitle_source, added_at)
     VALUES (?, 'necunoscut', 'necunoscut', datetime('now'))`,
  );
  const findOwnership = db.prepare(
    "SELECT id FROM media_ownership WHERE tmdb_id = ? AND media_type = ? AND season IS NULL",
  );

  for (const item of items) {
    // tmdb_id e NOT NULL în schemă — pentru titluri fără GUID TMDB rezolvabil
    // (agent vechi/local), folosim un pseudo-id negativ derivat din
    // ratingKey-ul Plex (stabil, unic, nu se ciocnește niciodată cu un
    // tmdb_id real, care e mereu pozitiv).
    const tmdbId = item.tmdbId ?? -Number(item.ratingKey);
    if (!Number.isFinite(tmdbId)) continue;
    const mediaType = item.type === "show" ? "tv" : "movie";

    const existing = findOwnership.get(tmdbId, mediaType) as { id: number } | undefined;
    if (existing) continue; // deja are ownership — nu suprascriem

    const info = insertOwnership.run(admin.id, tmdbId, mediaType, item.title);
    if (info.changes > 0) {
      inserted++;
      insertQuality.run(Number(info.lastInsertRowid));
    }
  }

  return { scanned: items.length, inserted };
}
