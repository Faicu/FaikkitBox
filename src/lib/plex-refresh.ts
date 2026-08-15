// ---------------------------------------------------------------------------
// SINGURUL loc din tot proiectul care ar trebui să declanșeze un rescan de
// bibliotecă Plex. Orice funcție care adaugă sau șterge conținut media de pe
// disk — descărcări noi, ștergeri din jurnal, ștergere directă de torrente
// din pagina qBittorrent, corectare sau ștergere de subtitrări — trebuie să
// apeleze refreshPlexLibrary / refreshPlexLibraryForCategory de aici, ca
// Plex să reflecte imediat schimbarea, nu doar la următoarea scanare
// automată (poate dura ore).
// ---------------------------------------------------------------------------

import { isMovieCategory } from "./filelist/categories";

export type PlexLibraryType = "movie" | "show";

async function plexFindLibraryKey(type: PlexLibraryType): Promise<string | null> {
  const base = process.env.PLEX_URL ?? "http://127.0.0.1:32400";
  const token = process.env.PLEX_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${base}/library/sections`, {
      headers: { "X-Plex-Token": token, Accept: "application/json" },
    });
    if (!res.ok) {
      console.warn(`[plex-refresh] Plex library sections HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as {
      MediaContainer?: { Directory?: Array<{ type?: string; key?: string }> };
    };
    const dirs = data?.MediaContainer?.Directory ?? [];
    const match = dirs.find((d) => d.type === type);
    return match ? String(match.key) : null;
  } catch (e) {
    console.warn(`[plex-refresh] Eroare la găsirea secțiunii Plex:`, e);
    return null;
  }
}

async function plexRefreshLibraryBySection(sectionKey: string): Promise<void> {
  const base = process.env.PLEX_URL ?? "http://127.0.0.1:32400";
  const token = process.env.PLEX_TOKEN;
  if (!token) return;
  try {
    const res = await fetch(`${base}/library/sections/${sectionKey}/refresh`, {
      method: "GET",
      headers: { "X-Plex-Token": token, Accept: "application/json" },
    });
    if (!res.ok) {
      console.warn(`[plex-refresh] Plex refresh HTTP ${res.status} pentru secțiunea ${sectionKey}`);
    }
  } catch (e) {
    console.warn(`[plex-refresh] Eroare Plex refresh:`, e);
  }
}

// Rescanează secțiunea Plex (filme sau seriale).
export async function refreshPlexLibrary(plexType: PlexLibraryType): Promise<void> {
  const sectionKey = await plexFindLibraryKey(plexType);
  if (sectionKey) await plexRefreshLibraryBySection(sectionKey);
}

// Variantă comodă când avem doar id-ul numeric de categorie Filelist, nu
// tipul de bibliotecă Plex rezolvat deja.
export async function refreshPlexLibraryForCategory(category: number): Promise<void> {
  return refreshPlexLibrary(isMovieCategory(category) ? "movie" : "show");
}

// Rescanează ambele biblioteci (filme + seriale) — folosit când nu putem
// determina cu certitudine tipul conținutului șters (ex. ștergere de torrent
// direct din pagina qBittorrent, fără categorie Filelist asociată).
export async function refreshPlexLibraries(): Promise<void> {
  await Promise.all([refreshPlexLibrary("movie"), refreshPlexLibrary("show")]);
}
