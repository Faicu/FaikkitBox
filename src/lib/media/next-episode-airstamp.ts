// ---------------------------------------------------------------------------
// Ora exactă a următorului episod: TVmaze, dar doar dacă e același episod.
//
// TMDB dă următorul episod cu dată, fără oră; ora o luăm de la TVmaze, după
// același cod SxxEyy. Numai că cele două numerotează uneori diferit. Găsit pe
// 28 sept. 2026 la Insula Iubirii: TMDB avea S10E08 pe 3 octombrie, iar
// „S10E08” al TVmaze era episodul din 26 septembrie — ora TVmaze are prioritate
// la afișare, deci drawer-ul arăta „Urmează S10E08 · sâmbătă, 26 septembrie”,
// o dată deja trecută.
//
// Ora e acceptată doar când ziua ei cade la cel mult o zi de data TMDB. Ziua
// de toleranță acoperă fusul orar: un episod american difuzat seara are, în
// UTC, deja data de a doua zi.
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
