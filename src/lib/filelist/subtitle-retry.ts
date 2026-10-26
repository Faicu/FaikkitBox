// ---------------------------------------------------------------------------
// Reîncercarea zilnică a subtitrărilor. Prima căutare, la finalul descărcării,
// vine exact când e cel mai puțin probabil să existe ceva: traducerile vin
// peste una-trei zile. Așa că o dată pe zi, 14 zile, pentru torrentele fără
// subtitrare română — și pentru cele cu una „aproximativă” (varianta exactă
// apare des după una-două zile), înlocuită doar cu una sigur mai bună.
// Ceasul e `subtitle_checked_at`; jurnal și push doar când găsește ceva.
// ---------------------------------------------------------------------------

import { getDb } from "../db";
import { SUBTITLE_RETRY_DAYS as RETRY_DAYS } from "./subtitle-outcomes";
// 23h, nu 24h: cu tact orar, pauza reală e pragul plus cel mult o oră.
const RETRY_MIN_AGE_HOURS = 23;

interface DueTorrent {
  torrent_hash: string;
  torrent_name: string | null;
  imdb_id: string | null;
  is_movie: number;
  // 1 dacă măcar un rând are o subtitrare aproximativă de înlocuit.
  approximate: number;
}

// GROUP BY: un pachet are un rând per episod. Se reia cât măcar un episod e
// fără subtitrare (MIN), nu doar când niciunul n-are.
export function listTorrentsDueForSubtitleRetry(): DueTorrent[] {
  return getDb()
    .prepare(
      `SELECT torrent_hash, MIN(torrent_name) AS torrent_name, MIN(imdb_id) AS imdb_id,
              MAX(media_type = 'movie') AS is_movie,
              MAX(subtitle_approximate) AS approximate
         FROM media
        WHERE torrent_hash IS NOT NULL
          AND completed_at IS NOT NULL
          AND completed_at >= datetime('now', ?)
        GROUP BY torrent_hash
       HAVING ((MIN(has_romanian_subtitle) = 0 AND MAX(has_romanian_audio) = 0)
               OR MAX(subtitle_approximate) = 1)
          AND (MAX(subtitle_checked_at) IS NULL
               OR MAX(subtitle_checked_at) <= datetime('now', ?))`,
    )
    .all(`-${RETRY_DAYS} days`, `-${RETRY_MIN_AGE_HOURS} hours`) as unknown as DueTorrent[];
}

// Episoadele aproximative ale unui pachet („S01E02”). Goală când e marcat doar
// rândul pachetului (neindexat) — se reverifică toate.
export function approximateEpisodeKeys(torrentHash: string): ReadonlySet<string> | undefined {
  const rows = getDb()
    .prepare(
      `SELECT printf('S%02dE%02d', season, episode) AS k FROM media
        WHERE torrent_hash = ? AND subtitle_approximate = 1
          AND season IS NOT NULL AND episode IS NOT NULL`,
    )
    .all(torrentHash) as unknown as { k: string }[];
  return rows.length ? new Set(rows.map((r) => r.k)) : undefined;
}

// Câte titluri au fost scadente și câte au primit subtitrare.
export async function retryMissingSubtitles(): Promise<{ checked: number; found: number }> {
  const due = listTorrentsDueForSubtitleRetry();
  if (due.length === 0) return { checked: 0, found: 0 };
  const { checkSubtitleForTorrent } = await import("./download");
  const { CORRECTED_OUTCOMES } = await import("./subtitle-outcomes");
  let found = 0;
  for (const t of due) {
    try {
      const result = await checkSubtitleForTorrent(
        {
          torrentName: t.torrent_name,
          torrentHash: t.torrent_hash,
          imdbId: t.imdb_id,
          isMovie: t.is_movie === 1,
        },
        {
          logRun: "corrected",
          upgradeApproximate: t.approximate === 1,
          approximateEpisodes:
            t.approximate === 1 && t.is_movie !== 1
              ? approximateEpisodeKeys(t.torrent_hash)
              : undefined,
          via: "retry",
        },
      );
      if (result.status === "ok" && CORRECTED_OUTCOMES.includes(result.outcome)) found++;
      console.log(
        `[subtitle-retry] „${t.torrent_name}" — ${result.status === "ok" ? result.outcome : result.error}`,
      );
    } catch (e) {
      console.warn(`[subtitle-retry] „${t.torrent_name}" — eroare:`, e);
    }
  }

  return { checked: due.length, found };
}

// ---------------------------------------------------------------------------
// Starea, pentru Watcher și pentru drawer-ul din Bibliotecă.
// ---------------------------------------------------------------------------

export interface SubtitleRetryTitle {
  mediaId: number;
  // „Imperiul Mafiei S02E04", „The Rookie S08 (pachet)" sau titlul filmului.
  title: string;
  torrentName: string | null;
  // missing = fără subtitrare; approximate = cu una de înlocuit.
  kind: "missing" | "approximate";
  // La mai multe episoade: cele aproximative („E02”, „E03”).
  approximateEpisodes: string[];
  // Datele în formatul SQLite, UTC.
  completedAt: string;
  until: string;
  lastCheckedAt: string | null;
}

export interface SubtitleRetryStatus {
  // În fereastra de 14 zile, căutate zilnic.
  searching: SubtitleRetryTitle[];
  // Fereastra s-a încheiat în ultimele 30 de zile — doar „Corectează”.
  ended: SubtitleRetryTitle[];
  // Subtitrări găsite de reîncercare, din jurnal (ultimele 10).
  found: Array<{ id: string; timestamp: string; message: string }>;
}

const ENDED_SHOWN_DAYS = 30;

export function getSubtitleRetryStatus(): SubtitleRetryStatus {
  const db = getDb();

  // Un rând per torrent. Titlul: serialul (în română) + episodul. Un pachet
  // desfăcut se recunoaște după numărul de episoade (Euphoria S01 apărea
  // „S01E01”).
  const rows = db
    .prepare(
      `SELECT MIN(m.id) AS mediaId, MIN(m.torrent_name) AS torrentName,
              COALESCE(MIN(p.title), MIN(m.title)) AS baseTitle,
              MIN(m.season) AS season, MIN(m.episode) AS episode, MAX(m.is_season_pack) AS isPack,
              MIN(m.completed_at) AS completedAt,
              datetime(MIN(m.completed_at), ?) AS until,
              MAX(m.subtitle_checked_at) AS lastCheckedAt,
              MIN(m.has_romanian_subtitle) AS hasRo, MAX(m.has_romanian_audio) AS hasAudio,
              MAX(m.subtitle_approximate) AS approximate,
              COUNT(DISTINCT m.episode) AS episodeCount,
              GROUP_CONCAT(CASE WHEN m.subtitle_approximate = 1 AND m.episode IS NOT NULL
                                THEN printf('E%02d', m.episode) END) AS approxEpisodes
         FROM media m LEFT JOIN media p ON p.id = m.parent_id
        WHERE m.torrent_hash IS NOT NULL AND m.completed_at IS NOT NULL
          AND m.completed_at >= datetime('now', ?)
        GROUP BY m.torrent_hash
       HAVING (hasRo = 0 AND hasAudio = 0) OR approximate = 1
        ORDER BY until`,
    )
    .all(`+${RETRY_DAYS} days`, `-${RETRY_DAYS + ENDED_SHOWN_DAYS} days`) as unknown as Array<{
    mediaId: number;
    torrentName: string | null;
    baseTitle: string;
    season: number | null;
    episode: number | null;
    isPack: number;
    completedAt: string;
    until: string;
    lastCheckedAt: string | null;
    hasRo: number;
    approximate: number;
    episodeCount: number;
    approxEpisodes: string | null;
  }>;

  const now = (db.prepare("SELECT datetime('now') AS n").get() as { n: string }).n;
  const pad = (n: number) => String(n).padStart(2, "0");
  const toTitle = (r: (typeof rows)[number]) =>
    r.season == null
      ? r.baseTitle
      : r.episode == null || r.isPack || r.episodeCount > 1
        ? `${r.baseTitle} S${pad(r.season)} (pachet)`
        : `${r.baseTitle} S${pad(r.season)}E${pad(r.episode)}`;
  const toItem = (r: (typeof rows)[number]): SubtitleRetryTitle => ({
    mediaId: r.mediaId,
    title: toTitle(r),
    torrentName: r.torrentName,
    kind: r.hasRo ? "approximate" : "missing",
    approximateEpisodes:
      r.episodeCount > 1 && r.approxEpisodes ? r.approxEpisodes.split(",").sort() : [],
    completedAt: r.completedAt,
    until: r.until,
    lastCheckedAt: r.lastCheckedAt,
  });

  const found = (
    db
      .prepare(
        `SELECT id, timestamp, message FROM activity
          WHERE type = 'subtitle_fix' AND meta LIKE '%"via":"retry"%'
          ORDER BY timestamp DESC LIMIT 10`,
      )
      .all() as unknown as Array<{ id: string; timestamp: string; message: string }>
  ).map((e) => ({ id: String(e.id), timestamp: e.timestamp, message: e.message }));

  return {
    searching: rows.filter((r) => r.until > now).map(toItem),
    // Aproximativele expirate au totuși subtitrare.
    ended: rows
      .filter((r) => r.until <= now && !r.hasRo)
      .map(toItem)
      .reverse(),
    found,
  };
}
