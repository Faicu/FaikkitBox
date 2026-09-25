// Ce episoade consideră urmărirea serialelor (show-watch.ts) ca apărute —
// separat ca funcție pură, ca regula să poată fi testată fără TMDB.
//
// `aired` din TMDB înseamnă „data difuzării e STRICT înainte de azi" (TMDB
// dă doar data, fără oră). Pentru decizia de descărcare e prea strict: un
// episod lansat azi la 15:00 apare pe Filelist în aceeași zi, dar ar fi
// devenit „apărut" abia a doua zi, deci descărcat cu o zi întârziere
// (MobLand S02E02, 25 sept. 2026). Cu `includeToday`, ziua lansării intră și
// ea; dacă torrentul nu e încă pe Filelist, căutarea nu găsește nimic și
// verificarea de peste 3 ore reîncearcă.
//
// Poziția de start la activarea urmăririi rămâne pe regula strictă: acolo
// „apărut" înseamnă „deja trecut, nu-l mai descărca", iar un episod de azi
// ar fi fost sărit dacă urmărirea se pornea chiar în ziua lui.

import type { EpisodeKey } from "./watch-position";

interface SeasonSchema {
  seasonNumber: number;
  episodes: Array<{ episodeNum: number; airDate: string | null; aired: boolean }>;
}

export function airedEpisodeKeys(
  schema: SeasonSchema[],
  opts: { includeToday: boolean; today: string },
): EpisodeKey[] {
  return schema.flatMap((s) =>
    s.episodes
      .filter((e) => e.aired || (opts.includeToday && e.airDate != null && e.airDate <= opts.today))
      .map((e) => ({ season: s.seasonNumber, episode: e.episodeNum })),
  );
}
