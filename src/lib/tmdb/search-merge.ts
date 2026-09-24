// Intercalarea rezultatelor celor două căutări TMDB (ro-RO și en-US) din
// wizard — vezi searchTmdb. Separată ca funcție pură ca să poată fi testată
// fără apeluri reale la TMDB.

interface SearchHit {
  id: number;
  media_type?: string;
}

// ro, en, ro, en… fără duplicate, doar filme și seriale. Când un titlu apare
// în ambele liste, se păstrează varianta en-US, de pe care
// searchTmdb citește anul, posterul și titlul original, ca înainte.
export function interleaveSearchResults<T extends SearchHit>(ro: T[], en: T[]): T[] {
  const isTitle = (r: T) => r.media_type === "movie" || r.media_type === "tv";
  const keyOf = (r: T) => `${r.media_type}:${r.id}`;
  const roTitles = ro.filter(isTitle);
  const enTitles = en.filter(isTitle);
  const enByKey = new Map(enTitles.map((r) => [keyOf(r), r]));
  const merged: T[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < Math.max(roTitles.length, enTitles.length); i++) {
    for (const r of [roTitles[i], enTitles[i]]) {
      if (!r || seen.has(keyOf(r))) continue;
      seen.add(keyOf(r));
      merged.push(enByKey.get(keyOf(r)) ?? r);
    }
  }
  return merged;
}
