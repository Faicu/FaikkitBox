// ---------------------------------------------------------------------------
// Calcul status Plex pentru seriale — badge-ul principal de pe cardul fixat.
//
// Prioritate (de la cel mai urgent/specific la cel mai general):
//   1. episod_nou            — ultimul episod a apărut de mai puțin de 24h
//                               și încă lipsește din Plex
//   2. complet                — toate sezoanele/episoadele apărute sunt în Plex
//   3. incomplet_ultim_sezon  — lipsește un episod chiar din ultimul sezon
//   4. complet_ultim_sezon    — ultimul sezon e complet (sezoanele anterioare
//                               pot lipsi parțial sau total, nu contează)
//   5. incomplet              — fallback generic (date ambigue)
//   6. lipsa                  — niciun episod din Plex
// ---------------------------------------------------------------------------

export type TvPlexStatus =
  | "complet"
  | "complet_ultim_sezon"
  | "incomplet_ultim_sezon"
  | "incomplet"
  | "episod_nou"
  | "lipsa";

interface SeasonQueryLike<T> {
  data?: T[];
}

export function computeTvPlexStatus(params: {
  allSeasonNums: number[];
  latestSeason: number | null;
  plexSeasonQueries: SeasonQueryLike<{ num: number; quality: string | null; watched: boolean }>[];
  tmdbSeasonQueries: SeasonQueryLike<{ episodeNum: number; aired: boolean }>[];
  lastAired: { airDateIso: string; inLibrary: boolean | null } | null;
}): TvPlexStatus | null {
  const { allSeasonNums, latestSeason, plexSeasonQueries, tmdbSeasonQueries, lastAired } = params;
  if (allSeasonNums.length === 0) return null;

  const allLoaded =
    plexSeasonQueries.every((q) => q.data !== undefined) &&
    tmdbSeasonQueries.every((q) => q.data !== undefined);
  if (!allLoaded) return null;

  let totalComplete = 0;
  let anyPresent = false;
  let lastSeasonComplete = true;
  const lastSeasonIdx = allSeasonNums.indexOf(latestSeason ?? -1);

  for (let i = 0; i < allSeasonNums.length; i++) {
    const plexEps = plexSeasonQueries[i].data ?? [];
    const tmdbEps = (tmdbSeasonQueries[i].data ?? []).filter((e) => e.aired);
    const plexSet = new Set(plexEps.map((e) => e.num));
    const epList = tmdbEps.map((e) => e.episodeNum);
    if (plexEps.length > 0) anyPresent = true;

    const seasonComplete =
      epList.length === 0 ? plexEps.length > 0 : epList.every((n) => plexSet.has(n));

    if (seasonComplete) totalComplete++;
    if (i === lastSeasonIdx) lastSeasonComplete = seasonComplete;
  }

  const overallComplete = totalComplete === allSeasonNums.length;

  // Episod apărut de mai puțin de 24h și încă lipsă din Plex — prioritar
  // peste orice alt status, e info temporară și urgentă.
  const hoursSinceAired = lastAired
    ? (Date.now() - new Date(lastAired.airDateIso).getTime()) / 3_600_000
    : Infinity;
  const newEpisodeUnavailable =
    !!lastAired && lastAired.inLibrary === false && hoursSinceAired >= 0 && hoursSinceAired < 24;

  if (!anyPresent) return "lipsa";
  if (newEpisodeUnavailable) return "episod_nou";
  if (overallComplete) return "complet";
  if (!lastSeasonComplete) return "incomplet_ultim_sezon";
  if (lastSeasonComplete) return "complet_ultim_sezon";
  return "incomplet";
}
