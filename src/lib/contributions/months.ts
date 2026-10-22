// Logica pură a contribuțiilor lunare — fără importuri server, ca s-o poată
// folosi și clientul (afișare) și serverul (alocare/validare).

export const DEFAULT_TARGET = 250;
export const MIN_PER_MONTH = 15;
export const RECOMMENDED_PER_MONTH = 25;
export const MAX_MONTHS = 12;

export type PaymentMethod = "revolut" | "iban" | "cash";
export type MonthStatus = "confirmed" | "pending" | "unpaid" | "exempt";

const TZ = "Europe/Bucharest";

// Luna curentă în București, „YYYY-MM". Nu din UTC: pe 1 noiembrie la 00:30
// ora României e încă 31 octombrie în UTC, iar contribuția trebuie să treacă
// deja pe luna nouă.
export function currentMonth(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}`;
}

export function isMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  const mon = (index % 12) + 1;
  return `${year}-${String(mon).padStart(2, "0")}`;
}

// Primele `count` luni, începând cu `start`, pe care utilizatorul nu le are
// deja acoperite (plătite sau în așteptare). Avansul „sare" peste ce e deja
// plătit în loc să dubleze o lună.
export function allocateMonths(start: string, count: number, covered: Iterable<string>): string[] {
  const taken = new Set(covered);
  const out: string[] = [];
  let m = start;
  while (out.length < count) {
    if (!taken.has(m)) out.push(m);
    m = addMonths(m, 1);
  }
  return out;
}

// Ținta unei luni = ultima țintă setată la sau înaintea ei. Schimbarea țintei
// se aplică de la luna curentă înainte; lunile trecute rămân pe ce aveau.
export function effectiveTarget(
  month: string,
  targets: Array<{ month: string; target: number }>,
): number {
  let best: { month: string; target: number } | null = null;
  for (const t of targets) {
    if (t.month <= month && (!best || t.month > best.month)) best = t;
  }
  return best?.target ?? DEFAULT_TARGET;
}

export function validateDeclaration(months: number, perMonth: number): string | null {
  if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) {
    return `Numărul de luni trebuie să fie între 1 și ${MAX_MONTHS}.`;
  }
  if (!Number.isInteger(perMonth) || perMonth < MIN_PER_MONTH) {
    return `Suma minimă este ${MIN_PER_MONTH} lei pe lună.`;
  }
  if (perMonth > 10_000) return "Suma e prea mare.";
  return null;
}

const MONTH_NAMES = [
  "ianuarie",
  "februarie",
  "martie",
  "aprilie",
  "mai",
  "iunie",
  "iulie",
  "august",
  "septembrie",
  "octombrie",
  "noiembrie",
  "decembrie",
];

// „octombrie 2026"; cu `withYear: false` doar „octombrie".
export function monthLabel(month: string, withYear = true): string {
  const [y, m] = month.split("-").map(Number);
  const name = MONTH_NAMES[m - 1] ?? month;
  return withYear ? `${name} ${y}` : name;
}

// Lunile unei plăți, compact: „octombrie 2026" sau „nov 2026 – ian 2027".
export function monthsRangeLabel(months: string[]): string {
  if (months.length === 0) return "—";
  const sorted = [...months].sort();
  if (sorted.length === 1) return monthLabel(sorted[0]);
  return `${monthLabel(sorted[0])} – ${monthLabel(sorted[sorted.length - 1])}`;
}

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  revolut: "Revolut",
  iban: "Transfer bancar",
  cash: "Numerar",
};

// ---------------------------------------------------------------------------
// Utilizator activ — cine se uită des vede cardul de plată mai insistent.
// ---------------------------------------------------------------------------

export interface ActivitySettings {
  minMovies: number;
  minEpisodes: number;
  windowDays: number;
}

export const DEFAULT_ACTIVITY: ActivitySettings = { minMovies: 3, minEpisodes: 5, windowDays: 30 };

export interface ViewCounts {
  movies: number;
  episodes: number;
}

// Pragul e combinat: fiecare film valorează 1/minMovies, fiecare episod
// 1/minEpisodes, activ de la 1. La 3/5: 3 filme, 5 episoade sau 2 filme +
// 2 episoade. Un prag 0 scoate tipul respectiv din calcul.
export function isActiveViewer(counts: ViewCounts, s: ActivitySettings): boolean {
  const score =
    (s.minMovies > 0 ? counts.movies / s.minMovies : 0) +
    (s.minEpisodes > 0 ? counts.episodes / s.minEpisodes : 0);
  return score >= 1 - 1e-9;
}

// Titluri distincte din fereastră (revăzutul nu se numără de două ori);
// trailerele/clipurile nu contează.
export function countViews(
  views: Array<{ ratingKey?: string; type: string; viewedAt: number }>,
  sinceSec: number,
): ViewCounts {
  const movies = new Set<string>();
  const episodes = new Set<string>();
  views.forEach((v, i) => {
    if (v.viewedAt < sinceSec) return;
    const key = v.ratingKey ?? `#${i}`;
    if (v.type === "movie") movies.add(key);
    else if (v.type === "episode") episodes.add(key);
  });
  return { movies: movies.size, episodes: episodes.size };
}

export function validateActivitySettings(s: ActivitySettings): string | null {
  const ok = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n <= max;
  if (!ok(s.minMovies, 1000) || !ok(s.minEpisodes, 1000)) {
    return "Pragurile trebuie să fie numere întregi, de la 0 în sus.";
  }
  if (s.minMovies === 0 && s.minEpisodes === 0) {
    return "Cel puțin unul dintre praguri trebuie să fie mai mare decât 0.";
  }
  if (!Number.isInteger(s.windowDays) || s.windowDays < 1 || s.windowDays > 365) {
    return "Perioada trebuie să fie între 1 și 365 de zile.";
  }
  return null;
}
