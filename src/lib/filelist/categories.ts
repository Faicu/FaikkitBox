// ---------------------------------------------------------------------------
// Categorii Filelist.io (31 de ID-uri, verificate pe API 2 aug. 2026). Cele
// fără filme/seriale nu apar aici. Cele mixte rămân necăutate: Cartoons=15,
// Mobile=22, Anime=24 — ar contamina rezultatele.
//
// Excepție: RO Dubbed=28 (filme și seriale) se caută, ca MIXED_CATEGORIES:
// căutarea e după IMDb, deci nu aduce celălalt tip, iar tipul descărcării vine
// din ce s-a cerut, nu din categorie. Urmărirea automată o exclude — o
// variantă doar dublată nu se alege fără om.
// ---------------------------------------------------------------------------

// Filme: SD=1, DVD=2, DVD-RO=3, HD=4, HD-RO=19, 4K=6, 4K Blu-Ray=26, Blu-Ray=20
// Seriale: SD=23, HD=21, 4K=27, K-Drama=31
//
// 3D=25 nu se caută (doar SBS/OU și discuri — nimic redabil pe un TV obișnuit),
// dar rămâne film pentru isMovieCategory. 20/26 rămân: discurile complete sunt
// excluse după nume, iar REMUX-ul e uneori singura variantă la o calitate.
export const MOVIE_CATEGORIES = [1, 2, 3, 4, 6, 19, 20, 26];
export const STEREO_3D_CATEGORY = 25;
export const SERIES_CATEGORIES = [21, 23, 27, 31];
export const MIXED_CATEGORIES = [28];
export const RO_DUBBED_CATEGORY = 28;
export const ALL_CATEGORIES = [...MOVIE_CATEGORIES, ...SERIES_CATEGORIES, ...MIXED_CATEGORIES];

// API-ul poate da categoria ca text („Movies HD”) — mapată la ID.
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
  "Movies Blu-Ray": 20,
  "Filme Blu-Ray": 20,
  "TV-Series HD": 21,
  "Seriale HD": 21,
  "TV-Series SD": 23,
  "Seriale SD": 23,
  "Movies 3D": 25,
  "Filme 3D": 25,
  "Movies 4K Blu-Ray": 26,
  "Filme 4K Blu-Ray": 26,
  "TV-Series 4K": 27,
  "Seriale 4K": 27,
  "RO Dubbed": 28,
  "K-Drama": 31,
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
  20: "Filme Blu-Ray",
  21: "Seriale HD",
  23: "Seriale SD",
  25: "Filme 3D",
  26: "Filme 4K Blu-Ray",
  27: "Seriale 4K",
  28: "RO Dubbed",
  31: "K-Drama",
};

export function isMovieCategory(catId: number): boolean {
  return MOVIE_CATEGORIES.includes(catId) || catId === STEREO_3D_CATEGORY;
}

export function isSeriesCategory(catId: number): boolean {
  return SERIES_CATEGORIES.includes(catId);
}

export function isMixedCategory(catId: number): boolean {
  return MIXED_CATEGORIES.includes(catId);
}
