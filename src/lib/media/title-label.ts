// Cum se scrie numele unui titlu în texte (jurnal, push, Watcher) și ce apare
// sub nume în drawer-e. Numele în sine e `media.title` (română → titlu
// alternativ românesc → engleză → original, vezi getTmdbDetailsInternal).
// Fără importuri: e folosit și din client.

const pad = (n: number) => String(n).padStart(2, "0");

// „S02E04” / „Sezonul 6”; null fără sezon (film sau serial întreg).
export function seasonEpisodeLabel(
  season: number | null | undefined,
  episode: number | null | undefined,
  isSeasonPack = false,
): string | null {
  if (season == null) return null;
  if (isSeasonPack || episode == null) return `Sezonul ${season}`;
  return `S${pad(season)}E${pad(episode)}`;
}

// Film: „Titlu (2026)”; episod: „Serial — S02E04”; pachet: „Serial — Sezonul 6”.
export function mediaLabel(m: {
  title: string;
  year?: number | string | null;
  season?: number | null;
  episode?: number | null;
  isSeasonPack?: boolean;
}): string {
  const se = seasonEpisodeLabel(m.season, m.episode, m.isSeasonPack);
  if (se) return `${m.title} — ${se}`;
  return m.year ? `${m.title} (${m.year})` : m.title;
}

// Cu language=ro-RO, TMDB pune titlul original când lipsește traducerea —
// identic cu originalul înseamnă „fără titlu românesc”, mai puțin la
// producțiile românești.
export function hasRomanianTitle(
  ro: string | null | undefined,
  original: string | null | undefined,
  originalLanguage: string | null | undefined,
): boolean {
  return !!ro && (ro !== original || originalLanguage === "ro");
}

// Orice literă din afara alfabetului latin (호프, ゴジラ, ग़ज़ब).
const NON_LATIN = /(?!\p{Script=Latin})\p{L}/u;

export function isLatinTitle(s: string): boolean {
  return !NON_LATIN.test(s);
}

// Sub nume: originalul, iar dacă nu e în alfabet latin, engleza. Null când ar
// repeta numele.
export function secondaryTitle(
  main: string,
  original: string | null | undefined,
  english: string | null | undefined,
): string | null {
  const pick = original && !isLatinTitle(original) ? english || original : original || english;
  return pick && pick !== main ? pick : null;
}
