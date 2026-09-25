// Cât avansează poziția de start a urmăririi (`auto_download_from`) după o
// verificare care a pornit descărcări — funcție pură, ca regula să poată fi
// testată fără TMDB, Filelist sau qBittorrent.
//
// De ce avansează: urmărirea compară ce a apărut (TMDB) cu ce avem (`media`).
// Un episod descărcat de urmărire, văzut și apoi șters din Bibliotecă își
// pierde rândul, deci la verificarea următoare ar fi părut din nou „lipsă" și
// ar fi fost redescărcat. Cu poziția mutată peste el, nu mai e căutat.
//
// De ce fără goluri: dacă lipsesc E03 și E04, iar pe Filelist a apărut doar
// E04, o poziție mutată la E04 ar sări definitiv peste E03. Avansăm deci doar
// peste episoadele consecutive acoperite și ne oprim la primul care lipsește.
//
// De ce nu dincolo de ce a descărcat urmărirea în verificarea asta: regula e
// „poziția ajunge până la ultimul episod adus de urmărire", nu o reevaluare a
// întregului serial.

// Sursa unică a tipului — show-watch.ts și aired-episodes.ts îl importă de aici.
export type EpisodeKey = { season: number; episode: number };

const ord = (k: EpisodeKey) => k.season * 1000 + k.episode;
const key = (k: EpisodeKey) => `${k.season}x${k.episode}`;

export function advancedWatchFrom(input: {
  // Poziția curentă; null = urmărire „backfill", de la începutul serialului.
  from: EpisodeKey | null;
  // Episoadele apărute, după TMDB (aceeași listă din care s-au calculat
  // episoadele lipsă).
  aired: EpisodeKey[];
  // Acoperite după verificare: deținute, aduse de un pachet de sezon în curs,
  // sau descărcate chiar acum.
  covered: EpisodeKey[];
  // Ce a descărcat urmărirea în verificarea asta (un pachet = toate
  // episoadele apărute ale sezonului lui).
  downloadedNow: EpisodeKey[];
}): EpisodeKey | null {
  if (input.downloadedNow.length === 0) return input.from;
  const cap = Math.max(...input.downloadedNow.map(ord));
  const coveredKeys = new Set(input.covered.map(key));
  const start = input.from ? ord(input.from) : 0;

  let position = input.from;
  for (const k of [...input.aired].sort((a, b) => ord(a) - ord(b))) {
    if (ord(k) <= start) continue;
    if (ord(k) > cap || !coveredKeys.has(key(k))) break;
    position = k;
  }
  return position;
}
