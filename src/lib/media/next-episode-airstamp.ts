// ---------------------------------------------------------------------------
// Ora exactă a următorului episod: de la TVmaze (TMDB dă doar data), dar doar
// dacă e același episod — cele două numerotează uneori diferit (Insula
// Iubirii, 28 sept. 2026: drawer-ul arăta o dată deja trecută). Acceptată doar
// la cel mult o zi de data TMDB; ziua de toleranță acoperă fusul orar.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export function matchingAirstamp(airstamp: string | null, airDate: string | null): string | null {
  if (!airstamp) return null;
  // Fără dată TMDB n-avem cu ce compara — ora TVmaze e singura informație.
  if (!airDate) return airstamp;
  const stamp = new Date(airstamp).getTime();
  const day = new Date(`${airDate}T00:00:00Z`).getTime();
  if (Number.isNaN(stamp) || Number.isNaN(day)) return null;
  // Ziua TMDB, întinsă cu o zi în ambele părți: [ziua-1 00:00, ziua+2 00:00) UTC.
  return stamp >= day - DAY_MS && stamp < day + 2 * DAY_MS ? airstamp : null;
}
