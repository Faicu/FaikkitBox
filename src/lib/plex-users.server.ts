// Listă conturi Plex (prieteni/shared users) — folosită la înregistrare
// pentru a lega un cont nou de un cont Plex existent (username sau email).
// Sursa e plex.tv/api/users (contul de proprietar, nu serverul local), care
// întoarce username + email reale — spre deosebire de /accounts de pe
// serverul local, care nu are email și include doar cine a vizionat deja.

import { fetchJson } from "./services/shared";

export interface PlexAccountEntry {
  id: number;
  username: string;
  email: string | null;
}

interface PlexUsersResponse {
  MediaContainer?: {
    User?: Array<{ id?: string | number; title?: string; username?: string; email?: string }>;
  };
}

let cache: { entries: PlexAccountEntry[]; expiresAt: number } | null = null;
const CACHE_MS = 5 * 60_000;

export async function getPlexAccounts(): Promise<PlexAccountEntry[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.entries;

  const token = process.env.PLEX_TOKEN;
  if (!token) return [];

  try {
    const json = await fetchJson<PlexUsersResponse>(
      "https://plex.tv/api/users",
      { headers: { "X-Plex-Token": token, Accept: "application/json" } },
      8000,
    );
    const raw = json?.MediaContainer?.User ?? [];
    const entries: PlexAccountEntry[] = raw
      .map((u) => ({
        id: Number(u.id),
        username: String(u.username || u.title || "").trim(),
        email: u.email ? String(u.email).trim() : null,
      }))
      .filter((u) => Number.isFinite(u.id) && u.username);

    cache = { entries, expiresAt: Date.now() + CACHE_MS };
    return entries;
  } catch (e) {
    console.warn("[plex-users] Nu am putut obține lista de conturi Plex:", e);
    return cache?.entries ?? [];
  }
}

export async function matchPlexAccount(
  username: string,
  email: string,
): Promise<PlexAccountEntry | null> {
  const accounts = await getPlexAccounts();
  const uname = username.trim().toLowerCase();
  const mail = email.trim().toLowerCase();
  return (
    accounts.find(
      (a) =>
        a.username.toLowerCase() === uname || (mail && a.email && a.email.toLowerCase() === mail),
    ) ?? null
  );
}
