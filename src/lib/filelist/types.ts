export interface FilelistTorrent {
  id: number;
  name: string;
  size: number; // bytes
  seeders: number;
  leechers: number;
  times_completed: number;
  category: number;
  categoryName: string;
  freeleech: boolean;
  internal: boolean;
  upload_date: string;
  imdb?: string;
  // Setat de checkFilelistForItemInternal (nu vine din API Filelist) — mereu
  // true acolo, întrucât căutarea se face exclusiv după ID IMDb. Absent
  // pentru rezultate care nu trec prin acel flux (ex. căutarea manuală din
  // secțiunea Filelist a paginii Lansări).
  matchedByImdb?: boolean;
}

export type FilelistCategory = "movies" | "series" | "all";

export interface FilelistSearchResult {
  status: "ok" | "error";
  error?: string;
  torrents: FilelistTorrent[];
}

export interface FilelistDownloadResult {
  status: "ok" | "error";
  error?: string;
  torrentName?: string;
  savePath?: string;
}

export interface FilelistLogEntry {
  id: number;
  name: string;
  size: number;
  category: number;
  categoryName: string;
  freeleech: boolean;
  internal: boolean;
  savePath: string;
  downloadedAt: string;
  completedAt: string | null;
  torrentHash?: string; // pentru resume polling după restart server
  imdb?: string; // pentru potrivirea subtitrărilor OpenSubtitles la completare
  requestedByUserId?: number | null; // cine a inițiat descărcarea (null = anterior legăturii de cont)
}

export interface FilelistApiTorrent {
  id?: number | string;
  name?: string;
  size?: number | string;
  seeders?: number | string;
  leechers?: number | string;
  times_completed?: number | string;
  category?: number | string;
  freeleech?: number | string;
  internal?: number | string;
  upload_date?: string;
  imdb?: string;
}

export interface QbitTorrentInfo {
  hash?: string;
  name?: string;
  progress?: number;
  state?: string;
}

export interface DownloadLogRow {
  id: number;
  name: string;
  size: number | null;
  category: number | null;
  category_name: string | null;
  freeleech: number | null;
  internal: number | null;
  save_path: string | null;
  downloaded_at: string;
  completed_at: string | null;
  torrent_hash: string | null;
  imdb: string | null;
  requested_by_user_id: number | null;
}
