import type { FilelistTorrent } from "@/lib/filelist.functions";

// Grupare torrente pe sezoane — ambele moduri pot coexista pe același sezon
export interface QualitySet {
  t720: FilelistTorrent[];
  t1080: FilelistTorrent[];
  t4k: FilelistTorrent[];
  t4kHdr: FilelistTorrent[];
}

export interface SeasonGroup {
  seasonNum: number;
  byQuality: QualitySet; // pack sezon întreg (poate fi gol)
  episodes: Map<number, QualitySet>; // episoade individuale (poate fi gol)
}
