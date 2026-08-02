// ---------------------------------------------------------------------------
// Categorii Filelist.io
//
// Lista completă (verificată direct pe API, 2026-08-02) are 31 de ID-uri
// valide. Multe nu au legătură cu filme/seriale (Apps=8, Games=9/10,
// Music=11, Videoclips=12, Sport=13, Docs=16 — de fapt cărți/cursuri, nu
// documentare, Various=18, Books=29, Courses=30, XXX=7) — nu apar mai jos.
//
// Câteva categorii sunt MIXTE (filme + seriale amestecate în același ID) și
// nu pot fi încadrate curat nici la MOVIE_CATEGORIES, nici la
// SERIES_CATEGORIES fără riscul de a contamina rezultatele: Cartoons=15
// (desene animate — filme ȘI seriale), Mobile=22 (aplicații/jocuri +
// filme/seriale în format mobil — de asta NU mai e inclus la seriale, deși
// a fost istoric), Anime=24 (filme ȘI seriale anime), RO Dubbed=28 (filme ȘI
// seriale dublate). Rămân neclasificate — căutarea Filelist pur și simplu nu
// le va găsi (fallback: căutarea manuală din secțiunea Filelist).
// ---------------------------------------------------------------------------

// Filme: SD=1, DVD=2, DVD-RO=3, HD=4, HD-RO=19, 4K=6, 4K Blu-Ray=26, Blu-Ray=20, 3D=25
// Seriale: SD=23, HD=21, 4K=27, K-Drama=31
export const MOVIE_CATEGORIES = [1, 2, 3, 4, 6, 19, 20, 25, 26];
export const SERIES_CATEGORIES = [21, 23, 27, 31];
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
  31: "K-Drama",
};

export function isMovieCategory(catId: number): boolean {
  return MOVIE_CATEGORIES.includes(catId);
}
