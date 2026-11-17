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

export interface RecentWatchTotals {
  all: number;
  last30Days: number;
  // Cea mai veche vizionare păstrată (secunde), null cât tabelul e gol.
  since: number | null;
}

export interface WatchStatsUser {
  username: string;
  count: number;
}

export interface WatchStatsBucket {
  key: string;
  label: string;
  count: number;
  users: WatchStatsUser[];
}

export interface WatchStatsPeriod {
  buckets: WatchStatsBucket[];
  users: WatchStatsUser[];
  total: number;
}

export interface RecentWatchStats {
  day: WatchStatsPeriod;
  week: WatchStatsPeriod;
  month: WatchStatsPeriod;
}
