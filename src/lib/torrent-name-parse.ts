// Extrage sezon/episod dintr-un nume de lansare — sursă unică, folosită atât
// de buildTorrentDisplayName (tmdb-title-lookup.ts, notificări) cât și de
// pinned-watcher.ts (etichetarea "Torrente noi"). `episode: null` înseamnă
// pachet de sezon complet (numele conține doar "Sxx", fără "Exx") — distinct
// de un episod individual, ca să nu etichetăm greșit un pachet de sezon ca
// fiind un singur episod (FileList înlocuiește des episoadele individuale cu
// un pachet de sezon la câteva ore după ultimul episod lansat).
export function parseSeasonEpisodeFromName(
  name: string,
): { season: number; episode: number | null } | null {
  const epMatch = name.match(/S(\d{2})E(\d{2})/i);
  if (epMatch) return { season: parseInt(epMatch[1], 10), episode: parseInt(epMatch[2], 10) };
  const seasonMatch = name.match(/S(\d{2})(?!\d)/i);
  if (seasonMatch) return { season: parseInt(seasonMatch[1], 10), episode: null };
  return null;
}
