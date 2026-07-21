import type { FilelistTorrent } from "@/lib/filelist.functions";

export interface PinnedItem {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  originalTitle: string;
  posterUrl: string | null;
}

// Grupare torrente pe sezoane — ambele moduri pot coexista pe același sezon
export interface QualitySet {
  t1080: FilelistTorrent[];
  t4k: FilelistTorrent[];
  t4kHdr: FilelistTorrent[];
}

export interface SeasonGroup {
  seasonNum: number;
  byQuality: QualitySet; // pack sezon întreg (poate fi gol)
  episodes: Map<number, QualitySet>; // episoade individuale (poate fi gol)
}
