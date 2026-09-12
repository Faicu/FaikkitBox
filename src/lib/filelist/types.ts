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
