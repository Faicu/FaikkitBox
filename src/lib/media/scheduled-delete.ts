// ---------------------------------------------------------------------------
// Ștergerea programată a unui titlu. Filelist socotește hit and run un torrent
// șters în primele DELETE_DELAY_HOURS de la finalizarea descărcării, deci
// cererea făcută până atunci se amână: termenul se scrie pe rândurile
// torrentului, iar sarcina „Ștergeri programate” o execută atunci. Cerută cât
// încă se descarcă, ștergerea așteaptă finalizarea (delete_scheduled_at NULL,
// completat de markMediaCompleted). Până la termen oricine poate renunța,
// devenind proprietarul titlului. Totul în DB: un restart nu pierde ștergerea.
// ---------------------------------------------------------------------------

import { getDb } from "../db";

export const DELETE_DELAY_HOURS = 48;

const sqliteMs = (v: string) => new Date(`${v.replace(" ", "T")}Z`).getTime();

// null = ștergerea se face pe loc; `until` = termenul (SQLite, UTC), sau null
// cât torrentul încă se descarcă. MIN pe hash: un pachet de sezon se șterge întreg.
export type DeleteDelay = { until: string | null } | null;

export function deleteDelay(torrentHash: string, nowMs = Date.now()): DeleteDelay {
  const row = getDb()
    .prepare(
      `SELECT COUNT(completed_at) AS done,
              datetime(MIN(completed_at), '+${DELETE_DELAY_HOURS} hours') AS until
         FROM media WHERE torrent_hash = ?`,
    )
    .get(torrentHash) as { done: number; until: string | null } | undefined;
  if (!row) return null;
  if (!row.done) return { until: null };
  return row.until && sqliteMs(row.until) > nowMs ? { until: row.until } : null;
}

export interface ScheduledDeletion {
  // Formatul SQLite, UTC; null = așteaptă finalizarea descărcării.
  at: string | null;
  byUserId: number | null;
}

export function scheduledDeletion(torrentHash: string): ScheduledDeletion | null {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n, MIN(delete_scheduled_at) AS at, MIN(delete_scheduled_by) AS by
         FROM media WHERE torrent_hash = ? AND delete_requested_at IS NOT NULL`,
    )
    .get(torrentHash) as { n: number; at: string | null; by: number | null } | undefined;
  return row?.n ? { at: row.at, byUserId: row.by } : null;
}

export function scheduleDeletion(
  torrentHash: string,
  at: string | null,
  byUserId: number | null,
): ScheduledDeletion {
  const existing = scheduledDeletion(torrentHash);
  if (existing) return existing;
  getDb()
    .prepare(
      `UPDATE media SET delete_requested_at = datetime('now'), delete_scheduled_at = ?,
              delete_scheduled_by = ?
        WHERE torrent_hash = ?`,
    )
    .run(at, byUserId, torrentHash);
  return { at, byUserId };
}

// Renunțarea: golește programarea și îl face pe cel care a renunțat
// proprietarul titlului. false = nimic programat (deja șters sau anulat).
export function cancelScheduledDeletion(torrentHash: string, byUserId: number | null): boolean {
  const db = getDb();
  const res = db
    .prepare(
      `UPDATE media SET delete_requested_at = NULL, delete_scheduled_at = NULL,
              delete_scheduled_by = NULL,
              requested_by_user_id = COALESCE(?, requested_by_user_id)
        WHERE torrent_hash = ? AND delete_requested_at IS NOT NULL`,
    )
    .run(byUserId, torrentHash);
  return Number(res.changes) > 0;
}

// Termenul celei mai apropiate ștergeri (ms), sau null — ora sarcinii.
export function nextScheduledDeletionAt(): number | null {
  const row = getDb()
    .prepare(
      `SELECT MIN(delete_scheduled_at) AS at FROM media
        WHERE delete_scheduled_at IS NOT NULL AND torrent_hash IS NOT NULL`,
    )
    .get() as { at: string | null } | undefined;
  return row?.at ? sqliteMs(row.at) : null;
}

// Torrentele cu termenul de ștergere atins — câte unul, cu primul lui rând.
export function listDueDeletions(
  nowMs = Date.now(),
): Array<{ torrentHash: string; mediaId: number; byUserId: number | null }> {
  const now = new Date(nowMs).toISOString().slice(0, 19).replace("T", " ");
  return getDb()
    .prepare(
      `SELECT torrent_hash AS torrentHash, MIN(id) AS mediaId,
              MIN(delete_scheduled_by) AS byUserId
         FROM media
        WHERE delete_scheduled_at IS NOT NULL AND delete_scheduled_at <= ?
          AND torrent_hash IS NOT NULL
        GROUP BY torrent_hash`,
    )
    .all(now) as unknown as Array<{
    torrentHash: string;
    mediaId: number;
    byUserId: number | null;
  }>;
}

// „Film (2024)”, „Serial S02E03”, „Serial S02 (pachet)” — pentru jurnal.
export function torrentLabel(torrentHash: string): string {
  const row = getDb()
    .prepare(
      `SELECT media_type, title, year, season, episode, is_season_pack FROM media
        WHERE torrent_hash = ? ORDER BY is_season_pack DESC, id LIMIT 1`,
    )
    .get(torrentHash) as
    | {
        media_type: string;
        title: string;
        year: number | null;
        season: number | null;
        episode: number | null;
        is_season_pack: number;
      }
    | undefined;
  if (!row) return "titlu necunoscut";
  if (row.media_type === "movie") return row.year ? `${row.title} (${row.year})` : row.title;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (row.season == null) return row.title;
  if (row.is_season_pack || row.episode == null) return `${row.title} S${pad(row.season)} (pachet)`;
  return `${row.title} S${pad(row.season)}E${pad(row.episode)}`;
}

export function usernameOf(userId: number | null): string | null {
  if (userId == null) return null;
  const row = getDb().prepare("SELECT username FROM users WHERE id = ?").get(userId) as
    { username: string } | undefined;
  return row?.username ?? null;
}

// Data SQLite (UTC) → „27.10.2026, 14:05”, ora României.
export function formatDeleteTime(v: string): string {
  return new Date(sqliteMs(v)).toLocaleString("ro-RO", {
    timeZone: "Europe/Bucharest",
    dateStyle: "short",
    timeStyle: "short",
  });
}
