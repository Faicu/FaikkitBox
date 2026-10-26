// Unirea episoadelor consecutive din „Vizionări recente” — funcție pură,
// testabilă (are cazuri de margine ușor de stricat).

import type { RecentWatch } from "./recent-watch-types";

// Episoade consecutive din același serial/sezon/user devin un card (S02E03-E05).
// Două condiții: numere consecutive ȘI intrări alăturate în listă — fără nimic
// între ele, nici vizionarea altcuiva. Fără a doua, un maraton întrerupt
// părea neîntrerupt. Doar episoadele terminate se unesc — altfel „34/41 min”
// ar părea să se refere la tot intervalul.
export function mergeConsecutiveEpisodes(items: RecentWatch[]): RecentWatch[] {
  // Descrescător, ca „alăturat” să însemne alăturat în lista văzută.
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
    // Ora celei mai recente vizionări, intervalul în ordine crescătoare.
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
    // Lista e descrescătoare, deci diferența așteptată e -1.
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
