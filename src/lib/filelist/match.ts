// ---------------------------------------------------------------------------
// Match torrent Filelist ↔ titlu TMDB — folosit de checkFilelistForItem,
// singura sursă de adevăr pentru "există pe Filelist?" (Descoperă + Lansări).
// ---------------------------------------------------------------------------

export function stripDiacritics(str: string): string {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Match strict, ancorat la începutul numelui — Filelist face doar căutare
// loose (substring) după nume, iar torrentele urmează convenția
// "Titlu.SxxExx..."/"Titlu.Anul...", deci titlul trebuie să apară chiar la
// început, nu doar oriunde în nume (altfel "Lucky" prinde și
// "I.Got.Lucky.Survival.Stories...").
export function torrentMatchesTitle(name: string, title: string): boolean {
  const words = stripDiacritics(title).trim().split(/\s+/).filter(Boolean).map(escapeRegex);
  if (words.length === 0) return false;
  const pattern = new RegExp(`^${words.join("[\\W_]+")}\\b`, "i");
  return pattern.test(stripDiacritics(name).trim());
}
