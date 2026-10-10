// ---------------------------------------------------------------------------
// Reîncercarea zilnică a subtitrărilor care lipsesc.
//
// Subtitrarea se caută o singură dată, la finalul descărcării — exact când e
// cel mai puțin probabil să existe: episoadele noi apar pe Filelist în aceeași
// zi, iar traducerile românești vin abia peste una-trei zile (MobLand S02E04,
// S.W.A.T. Exiles S01E02–E03, 9 oct. 2026). Până acum, singura cale de a o
// lua mai târziu era „Corectează subtitrare", apăsat de mână.
//
// Regula: o dată pe zi, timp de 14 zile de la finalizarea descărcării, pentru
// orice torrent fără subtitrare română (nici încorporată, nici .srt, nici
// audio în română) — și pentru cele cu o subtitrare „aproximativă": la
// episoadele noi apare des întâi varianta pentru alt release, iar cea exactă
// abia peste una-două zile. Aproximativa se înlocuiește doar cu una sigur mai
// bună (processMediaFile, `upgradeApproximate`), altfel rămâne. Ceasul e `subtitle_checked_at` din DB, nu un timer în
// memorie — un deploy nu-l resetează. Jurnalul și push-ul apar doar când s-a
// găsit ceva (checkSubtitleForTorrent cu `logRun: "corrected"`).
// ---------------------------------------------------------------------------

import { getDb } from "../db";

const RETRY_DAYS = 14;
// 23h, nu 24h: cu verificare din oră în oră, pauza reală e pragul plus cel
// mult o oră.
const RETRY_MIN_AGE_HOURS = 23;

interface DueTorrent {
  torrent_hash: string;
  torrent_name: string | null;
  imdb_id: string | null;
  category: number | null;
  has_ro: number;
}

// Un pachet de sezon are câte un rând per episod, toate cu același hash și
// aceeași stare (updateMediaSubtitleStatus scrie pe hash) — deci GROUP BY.
export function listTorrentsDueForSubtitleRetry(): DueTorrent[] {
  return getDb()
    .prepare(
      `SELECT torrent_hash, MIN(torrent_name) AS torrent_name, MIN(imdb_id) AS imdb_id,
              MIN(category) AS category, MAX(has_romanian_subtitle) AS has_ro
         FROM media
        WHERE torrent_hash IS NOT NULL
          AND completed_at IS NOT NULL
          AND completed_at >= datetime('now', ?)
        GROUP BY torrent_hash
       HAVING ((MAX(has_romanian_subtitle) = 0 AND MAX(has_romanian_audio) = 0)
               OR MAX(subtitle_approximate) = 1)
          AND (MAX(subtitle_checked_at) IS NULL
               OR MAX(subtitle_checked_at) <= datetime('now', ?))`,
    )
    .all(`-${RETRY_DAYS} days`, `-${RETRY_MIN_AGE_HOURS} hours`) as unknown as DueTorrent[];
}

export async function retryMissingSubtitles(): Promise<void> {
  const due = listTorrentsDueForSubtitleRetry();
  if (due.length === 0) return;
  const { checkSubtitleForTorrent } = await import("./download");
  for (const t of due) {
    try {
      const result = await checkSubtitleForTorrent(
        {
          torrentName: t.torrent_name,
          torrentHash: t.torrent_hash,
          imdbId: t.imdb_id,
          category: t.category,
        },
        { logRun: "corrected", upgradeApproximate: t.has_ro === 1 },
      );
      console.log(
        `[subtitle-retry] „${t.torrent_name}" — ${result.status === "ok" ? result.outcome : result.error}`,
      );
    } catch (e) {
      console.warn(`[subtitle-retry] „${t.torrent_name}" — eroare:`, e);
    }
  }
}
