// Forma unei intrări din "Vizionări recente". Fișier doar de tipuri, ca
// funcția pură de unire (recent-watch-merge.ts) și testele ei să nu tragă
// după ele plex-browse.ts, care vorbește cu DB-ul și cu Plex.

export interface RecentWatch {
  ratingKey: string;
  title: string;
  show: string | null;
  season: number | null;
  episode: number | null;
  episodeEnd: number | null;
  thumbUrl: string | null;
  username: string;
  viewedAt: number;
  completed: boolean;
  progressMinutes: number | null;
  durationMinutes: number | null;
}
