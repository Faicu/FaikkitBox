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

// Ora episodului următor din lista TVmaze. Întâi după număr; dacă numerotarea
// diferă (Insula Iubirii: TMDB S10E18 = TVmaze S10E20, 7 nov. 2026), episodul
// din același sezon cu data cea mai apropiată de a TMDB.
export function pickAirstamp(
  stamps: { seasonNumber: number; episodeNum: number; airstamp: string | null }[],
  next: { seasonNumber: number; episodeNumber: number; airDate?: string | null },
): string | null {
  const airDate = next.airDate ?? null;
  const sameSeason = stamps.filter((a) => a.seasonNumber === next.seasonNumber);
  const byNumber = matchingAirstamp(
    sameSeason.find((a) => a.episodeNum === next.episodeNumber)?.airstamp ?? null,
    airDate,
  );
  if (byNumber || !airDate) return byNumber;

  // Față de amiaza zilei TMDB: un episod de seară din ziua dinainte n-are voie să iasă mai aproape.
  const day = new Date(`${airDate}T12:00:00Z`).getTime();
  const candidates = sameSeason
    .map((a) => ({ a, ok: matchingAirstamp(a.airstamp, airDate) }))
    .filter((c): c is { a: (typeof sameSeason)[number]; ok: string } => !!c.ok)
    .sort(
      (x, y) =>
        Math.abs(new Date(x.ok).getTime() - day) - Math.abs(new Date(y.ok).getTime() - day) ||
        Math.abs(x.a.episodeNum - next.episodeNumber) -
          Math.abs(y.a.episodeNum - next.episodeNumber),
    );
  return candidates[0]?.ok ?? null;
}
