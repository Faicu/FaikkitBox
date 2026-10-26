// ---------------------------------------------------------------------------
// Reconcilierea: titluri terminate de peste 30 de minute, dar nelegate încă la
// Plex (scanare întârziată, Plex oprit o vreme) — reîncercate la 10 minute de
// sarcina „downloads”, până la 72h. Altfel ar rămâne pe „Se procesează în
// Plex” la nesfârșit.
// ---------------------------------------------------------------------------

import { getDb } from "../db";
import {
  resolveMediaPlexLinkByTorrentHash,
  resolveSeasonPackPlexLinks,
  repairLinkedMovieQuality,
} from "./media";

// Peste 72h, fișierul n-a ajuns în bibliotecă (șters, mutat, respins) sau e
// nevoie de intervenție — reîncercarea ar fi doar zgomot.
const MAX_AGE_HOURS = 72;
// Primele 30 de minute sunt ale sarcinii „downloads” (la 10s).
export const RECENT_LINK_MINUTES = 30;

export interface ReconcileResult {
  checked: number;
  linked: number;
}

export async function reconcilePlexLinks(): Promise<ReconcileResult> {
  const db = getDb();

  // DISTINCT: un pachet are mai multe rânduri pe același hash, iar legarea
  // lucrează pe hash. Filmele legate, dar fără calitate, sunt altă interogare.
  const repaired = await repairLinkedMovieQuality(MAX_AGE_HOURS).catch((e) => {
    console.warn("[plex-reconcile] Eroare la completarea calităților:", e);
    return 0;
  });
  if (repaired > 0) {
    console.log(`[plex-reconcile] ${repaired} filme au primit calitatea lipsă`);
  }

  const rows = db
    .prepare(
      `SELECT DISTINCT torrent_hash FROM media
       WHERE torrent_hash IS NOT NULL
         AND plex_rating_key IS NULL
         AND completed_at IS NOT NULL
         AND completed_at > datetime('now', ?)
         AND completed_at <= datetime('now', ?)`,
    )
    .all(`-${MAX_AGE_HOURS} hours`, `-${RECENT_LINK_MINUTES} minutes`) as Array<{
    torrent_hash: string;
  }>;

  if (rows.length === 0) return { checked: 0, linked: 0 };

  let linked = 0;
  for (const { torrent_hash } of rows) {
    try {
      const ok = await resolveMediaPlexLinkByTorrentHash(torrent_hash);
      const okPack = ok ? false : await resolveSeasonPackPlexLinks(torrent_hash);
      if (ok || okPack) {
        linked++;
        console.log(`[plex-reconcile] Legat la Plex: ${torrent_hash}`);
      }
    } catch (e) {
      console.warn(`[plex-reconcile] Eroare la ${torrent_hash}:`, e);
    }
  }

  // Logat doar când s-a legat ceva — altfel ar apărea la 10 minute cât un
  // titlu așteaptă.
  if (linked > 0) {
    console.log(
      `[plex-reconcile] ${rows.length} titluri nelegate verificate, ${linked} legate acum`,
    );
  }
  return { checked: rows.length, linked };
}
