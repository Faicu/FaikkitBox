// Helpere comune listei din Bibliotecă (plex-browse.ts) și fișei unui titlu
// (plex-title-detail.ts). Fără importuri server statice: fișierele care le
// folosesc ajung și în bundle-ul clientului (pentru tipuri și server fn).

import { sqliteUtcMs } from "../format";

export type MediaStatus = "in_library" | "downloading" | "processing";

interface QbitProgressInfo {
  progress: number;
  dlspeed: number;
  eta: number;
}

// O singură cerere qBittorrent cu toate hash-urile.
export async function fetchQbitProgress(hashes: string[]): Promise<Map<string, QbitProgressInfo>> {
  const result = new Map<string, QbitProgressInfo>();
  if (hashes.length === 0) return result;
  const base = process.env.QBIT_URL;
  const user = process.env.QBIT_USERNAME;
  const pass = process.env.QBIT_PASSWORD;
  if (!base || !user || !pass) return result;
  try {
    const { qbitGet } = await import("../qbit-client");
    const url = base.replace(/\/$/, "");
    const res = await qbitGet(url, `/api/v2/torrents/info?hashes=${hashes.join("|")}`, user, pass);
    if (!res.ok) return result;
    const list = (await res.json()) as Array<{
      hash: string;
      progress: number;
      dlspeed: number;
      eta: number;
    }>;
    for (const t of list) {
      result.set(t.hash, { progress: t.progress, dlspeed: t.dlspeed, eta: t.eta });
    }
  } catch {
    // qBittorrent indisponibil — lista rămâne fără procent.
  }
  return result;
}

// Fracția din qBittorrent (0-1) ca procent cu o zecimală.
export function progressPercent(fraction: number): number {
  return Math.round(fraction * 1000) / 10;
}

// Rezervă pentru „Marchează ca vizionat” din Plex, care setează viewCount, dar
// nu scrie în istoric. Sigur doar pentru owner-ul serverului (al cărui
// viewCount îl vede PLEX_TOKEN).
export async function getOwnerViewedAtByRatingKey(
  myPlexUsername: string | null,
  candidateRatingKeys: string[],
): Promise<Map<string, number>> {
  if (!myPlexUsername || candidateRatingKeys.length === 0) return new Map();
  const { getPlexOwnerUsername, getPlexViewedRatingKeys } = await import("./plex");
  const ownerUsername = await getPlexOwnerUsername();
  if (myPlexUsername !== ownerUsername) return new Map();
  return getPlexViewedRatingKeys(candidateRatingKeys);
}

// Contul Plex al utilizatorului: `historyName` = cheia din istoricul Plex,
// `plexUsername` = username-ul plex.tv, comparat cu owner-ul.
export async function myPlexIdentity(
  db: import("node:sqlite").DatabaseSync,
  userId: number | undefined,
): Promise<{ historyName: string | null; plexUsername: string | null }> {
  if (!userId) return { historyName: null, plexUsername: null };
  const me = db
    .prepare("SELECT plex_account_id, plex_username FROM users WHERE id = ?")
    .get(userId) as { plex_account_id: number | null; plex_username: string | null } | undefined;
  const plexUsername = me?.plex_username ?? null;
  if (!me || (me.plex_account_id == null && !plexUsername)) {
    return { historyName: null, plexUsername };
  }
  const { getPlexHistoryName } = await import("./plex");
  return {
    historyName: await getPlexHistoryName(me.plex_account_id, plexUsername),
    plexUsername,
  };
}

export function rowDeleteScheduled(r: {
  delete_requested_at: string | null;
  delete_scheduled_at: string | null;
}): { at: string | null } | null {
  return r.delete_requested_at ? { at: r.delete_scheduled_at } : null;
}

export function sqliteToUnix(v: string): number {
  return Math.floor(sqliteUtcMs(v) / 1000);
}

export function rowAddedAt(r: { plex_added_at: number | null; added_at: string }): number {
  return r.plex_added_at ?? sqliteToUnix(r.added_at);
}

export function rowStatus(r: {
  plex_rating_key: string | null;
  completed_at: string | null;
}): MediaStatus {
  return r.plex_rating_key ? "in_library" : r.completed_at ? "processing" : "downloading";
}
