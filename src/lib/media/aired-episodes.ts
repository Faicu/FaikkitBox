// Ce episoade consideră urmărirea serialelor (show-watch.ts) ca apărute —
// separat ca funcție pură, ca regula să poată fi testată fără TMDB.
//
// `aired` din TMDB înseamnă „data difuzării e STRICT înainte de azi" (TMDB
// dă doar data, fără oră). Pentru decizia de descărcare e prea strict: un
// episod lansat azi la 15:00 apare pe Filelist în aceeași zi, dar ar fi
// devenit „apărut" abia a doua zi, deci descărcat cu o zi întârziere
// (MobLand S02E02, 25 sept. 2026). Cu `includeUpcoming`, ziua lansării intră
// și ea; dacă torrentul nu e încă pe Filelist, căutarea nu găsește nimic și
// verificarea de peste 3 ore reîncearcă.
//
// Din 8 oct. 2026 fereastra e „azi + mâine": Amazon publică MobLand cu o zi
// înaintea datei din TMDB (S02E03 urcat pe Filelist pe 1 oct., S02E04 pe
// 8 oct., ambele datate de TMDB a doua zi), deci chiar și cu ziua lansării
// inclusă descărcarea venea cu o zi întârziere. Nu se descarcă nimic greșit — descărcarea cere în
// continuare un torrent cu IMDb-ul și S/E-ul exact. Fereastra rămâne scurtă
// intenționat: cu toate episoadele anunțate, orice serial în desfășurare ar
// avea mereu ceva „lipsă" și Filelist ar fi întrebat la fiecare ciclu,
// consumând limita orară a contului.
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
  opts: { includeUpcoming: boolean; today: string },
): EpisodeKey[] {
  const tomorrow = nextDay(opts.today);
  return schema.flatMap((s) =>
    s.episodes
      .filter((e) => e.aired || (opts.includeUpcoming && e.airDate != null && e.airDate <= tomorrow))
      .map((e) => ({ season: s.seasonNumber, episode: e.episodeNum })),
  );
}

// "2026-10-08" → "2026-10-09", în UTC, ca `today` (vezi show-watch.ts).
function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
