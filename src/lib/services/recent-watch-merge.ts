// Unirea episoadelor consecutive din "Vizionări recente", ca funcție pură:
// intră lista de vizionări, iese lista de carduri. Separată de plex-browse.ts
// (care vorbește cu DB-ul și cu Plex) ca să poată fi verificată singură —
// regula are cazuri de margine ușor de stricat la o rescriere.

import type { RecentWatch } from "./recent-watch-types";

// Unește episoade consecutive din același serial/sezon/user într-un singur
// card (ex. S02E03-E05), ca "Vizionări recente" să nu se umple cu rânduri
// separate pentru un maraton de episoade.
//
// Două condiții, amândouă obligatorii:
//
//  1. Episoadele să fie consecutive ca număr (E03, E04, E05).
//  2. Intrările să fie ALĂTURATE în lista cronologică — fără nimic între ele,
//     nici măcar vizionarea altui utilizator.
//
// A doua a lipsit la început, iar unirea se făcea pur pe numărul episodului:
// E01 și E02 apăreau ca un card „E01-E02" chiar dacă între ele, în timp,
// altcineva văzuse altceva. Adică lista părea să spună că maratonul a fost
// neîntrerupt, când de fapt nu fusese — iar intrarea celuilalt utilizator
// ajungea, vizual, după un card care o cuprindea în interval.
//
// Acum un maraton întrerupt dă două carduri („E01-E02" și „E03"), ceea ce e
// exact adevărul: două reprize.
//
// Doar episoadele terminate complet se unesc — un episod neterminat rămâne pe
// rândul lui, altfel minutele afișate ("34/41 min") ar părea să se refere la
// tot intervalul unit, nu la ultimul episod din el.
export function mergeConsecutiveEpisodes(items: RecentWatch[]): RecentWatch[] {
  // Cronologic descrescător, ca „alăturat în listă" să însemne alăturat în
  // ordinea în care vede utilizatorul lista, nu în ordinea din care a venit
  // interogarea.
  const ordered = [...items].sort((a, b) => b.viewedAt - a.viewedAt);

  const merged: RecentWatch[] = [];
  let run: RecentWatch[] = [];

  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      merged.push(run[0]);
      run = [];
      return;
    }
    // Cardul poartă ora celei mai recente vizionări din serie, dar
    // intervalul de episoade în ordine crescătoare.
    const latest = run.reduce((a, b) => (b.viewedAt > a.viewedAt ? b : a));
    const nums = run.map((r) => r.episode ?? 0).sort((a, b) => a - b);
    merged.push({ ...latest, episode: nums[0], episodeEnd: nums[nums.length - 1] });
    run = [];
  };

  const mergeable = (item: RecentWatch) =>
    item.show != null && item.season != null && item.episode != null && item.completed;

  for (const item of ordered) {
    if (!mergeable(item)) {
      flush();
      merged.push(item);
      continue;
    }
    const last = run[run.length - 1];
    // Lista e descrescătoare cronologic, iar un maraton se vede de sus în jos
    // ca episoade în ordine descrescătoare — de-aia diferența așteptată e -1.
    const continuesRun =
      last != null &&
      last.username === item.username &&
      last.show === item.show &&
      last.season === item.season &&
      item.episode === (last.episode ?? 0) - 1;

    if (continuesRun) run.push(item);
    else {
      flush();
      run = [item];
    }
  }
  flush();

  return merged;
}
