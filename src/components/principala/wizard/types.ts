// Tipurile wizard-ului de adăugare, scoase din AddMediaWizard.tsx ca să poată
// fi folosite deopotrivă de componentă, de funcțiile pure din `selection.ts`
// și de pașii care urmează să fie extrași în fișiere proprii.

import type { FilelistTorrent } from "@/lib/filelist.functions";

export type Quality = "720p" | "1080p" | "4K" | "4K HDR";

export type Step = "search" | "checking" | "result" | "pick" | "confirm" | "done";

// Tot ce aflăm despre un titlu într-o singură verificare: ce e în Plex, ce
// există pe Filelist, ce sezoane are.
export interface CheckResult {
  imdbId: string | null;
  originalTitle: string;
  plexFound: boolean;
  plexQuality: string | null;
  torrents: FilelistTorrent[];
  seasons: Array<{ seasonNumber: number; episodeCount: number }>;
}

export interface PlexSeasonEpisode {
  num: number;
  quality: string | null;
  watched: boolean;
}

export interface BulkDownloadItem {
  torrent: FilelistTorrent;
  season: number;
  episode?: number;
  isSeasonPack: boolean;
  label: string;
}

// Torrentul/pachetul în așteptare de alegere manuală (admin, mai mulți
// candidați la aceeași calitate) — un pas intermediar înainte de confirmare.
export interface TorrentChoiceContext {
  label: string;
  season?: number;
  episode?: number;
  isSeasonPack: boolean;
  candidates: FilelistTorrent[];
}
