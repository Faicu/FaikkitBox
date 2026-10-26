// Ce episoade consideră urmărirea ca apărute — funcție pură, testabilă fără TMDB.
//
// `aired` din TMDB înseamnă „data e strict înainte de azi”, prea strict: un
// episod lansat azi apare pe Filelist azi, dar s-ar fi descărcat mâine (MobLand,
// 25 sept. 2026). Fereastra e „azi + mâine”: Amazon publică MobLand cu o zi
// înaintea datei din TMDB. Descărcarea cere oricum IMDb-ul și S/E-ul exact.
// Nu mai larg: un serial în desfășurare ar avea mereu ceva „lipsă” și Filelist
// ar fi întrebat la fiecare ciclu, consumând limita orară a contului.
//
// Poziția de start la activare rămâne pe regula strictă — altfel un episod de
// azi ar fi sărit dacă urmărirea pornește chiar în ziua lui.

import type { EpisodeKey } from "./watch-position";

interface SeasonSchema {
  seasonNumber: number;
  episodes: Array<{ episodeNum: number; airDate: string | null; aired: boolean }>;
}

export function airedEpisodeKeys(
  schema: SeasonSchema[],
  opts: { includeUpcoming: boolean; today: string },
): EpisodeKey[] {
  const tomorrow = nextDay(opts.today);
  return schema.flatMap((s) =>
    s.episodes
      .filter(
        (e) => e.aired || (opts.includeUpcoming && e.airDate != null && e.airDate <= tomorrow),
      )
      .map((e) => ({ season: s.seasonNumber, episode: e.episodeNum })),
  );
}

// "2026-10-08" → "2026-10-09", în UTC, ca `today` (vezi show-watch.ts).
function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
