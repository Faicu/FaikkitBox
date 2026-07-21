// ---------------------------------------------------------------------------
// Categorii Filelist.io
// ---------------------------------------------------------------------------

// Filme: SD=1, DVD=2, DVD-RO=3, HD=4, HD-RO=19, 4K=6, 4K-RO=26
// Seriale: SD=23, HD=21, HD-RO=22, 4K=27
export const MOVIE_CATEGORIES = [1, 2, 3, 4, 6, 19, 26];
export const SERIES_CATEGORIES = [21, 22, 23, 27];
export const ALL_CATEGORIES = [...MOVIE_CATEGORIES, ...SERIES_CATEGORIES];

// Filelist API poate returna categoria ca string (ex: "Movies HD") — mapăm la ID numeric
const CATEGORY_STRING_MAP: Record<string, number> = {
  "Movies SD": 1,
  "Filme SD": 1,
  "Movies DVD": 2,
  "Filme DVD": 2,
  "Movies DVD-RO": 3,
  "Filme DVD-RO": 3,
  "Movies HD": 4,
  "Filme HD": 4,
  "Movies 4K": 6,
  "Filme 4K": 6,
  "Movies HD-RO": 19,
  "Filme HD-RO": 19,
  "Movies 4K-RO": 26,
  "Filme 4K-RO": 26,
  "TV-Series HD": 21,
  "Seriale HD": 21,
  "TV-Series HD-RO": 22,
  "Seriale HD-RO": 22,
  "TV-Series SD": 23,
  "Seriale SD": 23,
  "TV-Series 4K": 27,
  "Seriale 4K": 27,
};

export function parseCategoryId(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const mapped = CATEGORY_STRING_MAP[raw.trim()];
    if (mapped !== undefined) return mapped;
    const n = Number(raw);
    if (!isNaN(n)) return n;
  }
  return 0;
}

export const CATEGORY_NAMES: Record<number, string> = {
  1: "Filme SD",
  2: "Filme DVD",
  3: "Filme DVD-RO",
  4: "Filme HD",
  6: "Filme 4K",
  19: "Filme HD-RO",
  21: "Seriale HD",
  22: "Seriale HD-RO",
  23: "Seriale SD",
  26: "Filme 4K-RO",
  27: "Seriale 4K",
};

export function isMovieCategory(catId: number): boolean {
  return MOVIE_CATEGORIES.includes(catId);
}
