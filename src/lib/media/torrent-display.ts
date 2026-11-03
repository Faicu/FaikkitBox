// Numele unui torrent din `media` — același în jurnal, push, Watcher și la
// ștergeri.

import { getDb } from "../db";
import { mediaLabel } from "./title-label";

export interface TorrentDisplay {
  label: string;
  title: string;
  posterPath: string | null;
}

export function torrentDisplay(torrentHash: string): TorrentDisplay | null {
  // Cât se desface un pachet, rândul-pachet coexistă cu episoadele lui; după,
  // rămân doar episoadele — pachetul se recunoaște după numărul lor (The
  // Shield S01 apărea „S01E01”).
  const row = getDb()
    .prepare(
      `SELECT media_type, title, year, season, episode, is_season_pack, poster_path,
              (SELECT COUNT(DISTINCT episode) FROM media WHERE torrent_hash = m.torrent_hash) AS episodes
         FROM media m
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
        poster_path: string | null;
        episodes: number;
      }
    | undefined;
  if (!row) return null;
  const isMovie = row.media_type === "movie";
  return {
    label: mediaLabel({
      title: row.title,
      year: isMovie ? row.year : null,
      season: isMovie ? null : row.season,
      episode: row.episode,
      isSeasonPack: !!row.is_season_pack || row.episodes > 1,
    }),
    title: row.title,
    posterPath: row.poster_path,
  };
}
