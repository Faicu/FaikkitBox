// ---------------------------------------------------------------------------
// Ștergerea programată a unui titlu.
//
// Filelist socotește hit and run un torrent șters în primele DELETE_DELAY_HOURS
// de la descărcare și penalizează contul de pe care s-a descărcat. Cererea de
// ștergere (sau de anulare) din primele 24 h nu se refuză, ci se amână: se
// scrie pe rândurile torrentului momentul împlinirii celor 24 h, iar pasul
// „Ștergeri programate” din maintenance.ts o execută atunci. Până la ea,
// torrentul continuă să se descarce și să facă seed, iar oricine poate
// renunța la ștergere — devenind proprietarul titlului.
//
// Totul stă în DB, nu într-un cronometru în memorie, ca o repornire sau un
// deploy să nu piardă ștergerea: o programare restantă se execută la pornire.
// ---------------------------------------------------------------------------

import { getDb } from "../db";

export const DELETE_DELAY_HOURS = 24;

const sqliteMs = (v: string) => new Date(`${v.replace(" ", "T")}Z`).getTime();

// Momentul (formatul SQLite, UTC) până la care o cerere de ștergere se
// programează în loc să se execute, sau null dacă cele 24 h au trecut.
// MIN(added_at) pe tot hash-ul: un pachet de sezon e un singur torrent,
// ștergerea îl ia întreg.
export function deleteDelayedUntil(torrentHash: string, nowMs = Date.now()): string | null {
  const row = getDb()
    .prepare(
      `SELECT datetime(MIN(added_at), '+${DELETE_DELAY_HOURS} hours') AS until FROM media
        WHERE torrent_hash = ?`,
    )
    .get(torrentHash) as { until: string | null } | undefined;
  const until = row?.until ?? null;
  if (!until) return null;
  return sqliteMs(until) > nowMs ? until : null;
}

export interface ScheduledDeletion {
  // Formatul SQLite, UTC.
  at: string;
  byUserId: number | null;
}

export function scheduledDeletion(torrentHash: string): ScheduledDeletion | null {
  const row = getDb()
    .prepare(
      `SELECT MIN(delete_scheduled_at) AS at, MIN(delete_scheduled_by) AS by FROM media
        WHERE torrent_hash = ? AND delete_scheduled_at IS NOT NULL`,
    )
    .get(torrentHash) as { at: string | null; by: number | null } | undefined;
  return row?.at ? { at: row.at, byUserId: row.by } : null;
}

// Programează ștergerea pe toate rândurile torrentului. O programare deja
// existentă rămâne neatinsă (termenul e oricum același, cel de la adăugare).
export function scheduleDeletion(
  torrentHash: string,
  at: string,
  byUserId: number | null,
): ScheduledDeletion {
  const existing = scheduledDeletion(torrentHash);
  if (existing) return existing;
  getDb()
    .prepare(
      "UPDATE media SET delete_scheduled_at = ?, delete_scheduled_by = ? WHERE torrent_hash = ?",
    )
    .run(at, byUserId, torrentHash);
  return { at, byUserId };
}

// Renunțarea la ștergere: golește programarea și, dacă știm cine a renunțat,
// îl face proprietarul titlului — l-a salvat, deci răspunde de el. Întoarce
// false dacă nu era nimic programat (ștergerea s-a produs deja sau a anulat-o
// altcineva între timp).
export function cancelScheduledDeletion(torrentHash: string, byUserId: number | null): boolean {
  const db = getDb();
  const res = db
    .prepare(
      `UPDATE media SET delete_scheduled_at = NULL, delete_scheduled_by = NULL,
              requested_by_user_id = COALESCE(?, requested_by_user_id)
        WHERE torrent_hash = ? AND delete_scheduled_at IS NOT NULL`,
    )
    .run(byUserId, torrentHash);
  return Number(res.changes) > 0;
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
