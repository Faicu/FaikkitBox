// Listă conturi Plex (prieteni/shared users) — folosită la înregistrare
// pentru a lega un cont nou de un cont Plex existent (username sau email).
// Sursa e plex.tv/api/users (contul de proprietar, nu serverul local), care
// întoarce username + email reale — spre deosebire de /accounts de pe
// serverul local, care nu are email și include doar cine a vizionat deja.

import { fetchText } from "../services/shared";

export interface PlexAccountEntry {
  id: number;
  username: string;
  email: string | null;
}

let cache: { entries: PlexAccountEntry[]; expiresAt: number } | null = null;
const CACHE_MS = 5 * 60_000;

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? decodeXmlEntities(m[1]) : null;
}

// plex.tv/api/users ignoră Accept: application/json și tot răspunde XML —
// parsăm direct atributele <User .../> cu regex (structură simplă, stabilă,
// nu justifică o dependență XML nouă).
function parsePlexUsersXml(xml: string): PlexAccountEntry[] {
  const entries: PlexAccountEntry[] = [];
  const userTags = xml.match(/<User\b[^>]*>/g) ?? [];
  for (const tag of userTags) {
    const id = Number(attr(tag, "id"));
    const username = (attr(tag, "username") || attr(tag, "title") || "").trim();
    const email = attr(tag, "email")?.trim() || null;
    if (Number.isFinite(id) && username) entries.push({ id, username, email });
  }
  return entries;
}

export async function getPlexAccounts(): Promise<PlexAccountEntry[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.entries;

  const token = process.env.PLEX_TOKEN;
  if (!token) return [];

  try {
    const xml = await fetchText(
      "https://plex.tv/api/users",
      { headers: { "X-Plex-Token": token } },
      8000,
    );
    const entries = parsePlexUsersXml(xml);
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
