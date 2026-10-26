// ---------------------------------------------------------------------------
// SINGURUL loc care declanșează rescanarea Plex. Orice adaugă sau șterge
// conținut de pe disc (descărcări, ștergeri, subtitrări) trece pe aici, ca
// Plex să vadă schimbarea imediat, nu la scanarea automată.
// ---------------------------------------------------------------------------

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

// /refresh doar pune scanarea în coadă — un emptyTrash imediat n-ar avea ce
// curăța, iar titlul șters rămânea fantomă (The Crown S06, 2 sept. 2026).
// Așteptăm ca „scanning” să revină la false, cu plafon de timp.
async function plexWaitForScanIdle(sectionKey: string, timeoutMs = 20_000): Promise<void> {
  const base = process.env.PLEX_URL ?? "http://127.0.0.1:32400";
  const token = process.env.PLEX_TOKEN;
  if (!token) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/library/sections`, {
        headers: { "X-Plex-Token": token, Accept: "application/json" },
      });
      if (res.ok) {
        const data = (await res.json()) as {
          MediaContainer?: { Directory?: Array<{ key?: string; scanning?: boolean }> };
        };
        const dir = data?.MediaContainer?.Directory?.find((d) => String(d.key) === sectionKey);
        if (!dir?.scanning) return;
      }
    } catch (e) {
      console.warn(`[plex-refresh] Eroare la verificarea stării scanării:`, e);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.warn(`[plex-refresh] Scanarea secțiunii ${sectionKey} nu s-a terminat în ${timeoutMs}ms`);
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
      return;
    }
    // O clipă, ca scanarea să pornească efectiv.
    await new Promise((r) => setTimeout(r, 500));
    await plexWaitForScanIdle(sectionKey);
  } catch (e) {
    console.warn(`[plex-refresh] Eroare Plex refresh:`, e);
  }
}

// Rescanează secțiunea Plex (filme sau seriale).
export async function refreshPlexLibrary(plexType: PlexLibraryType): Promise<void> {
  const sectionKey = await plexFindLibraryKey(plexType);
  if (sectionKey) await plexRefreshLibraryBySection(sectionKey);
}

async function plexEmptyTrashBySection(sectionKey: string): Promise<void> {
  const base = process.env.PLEX_URL ?? "http://127.0.0.1:32400";
  const token = process.env.PLEX_TOKEN;
  if (!token) return;
  try {
    const res = await fetch(`${base}/library/sections/${sectionKey}/emptyTrash`, {
      method: "PUT",
      headers: { "X-Plex-Token": token, Accept: "application/json" },
    });
    if (!res.ok) {
      console.warn(
        `[plex-refresh] Plex emptyTrash HTTP ${res.status} pentru secțiunea ${sectionKey}`,
      );
    }
  } catch (e) {
    console.warn(`[plex-refresh] Eroare Plex emptyTrash:`, e);
  }
}

// Rescanare plus golirea coșului: refresh-ul simplu doar marchează fișierele
// lipsă, iar wizard-ul ar crede titlul încă în Plex. Doar pentru ștergeri.
export async function refreshPlexLibraryAndEmptyTrash(plexType: PlexLibraryType): Promise<void> {
  const sectionKey = await plexFindLibraryKey(plexType);
  if (!sectionKey) return;
  await plexRefreshLibraryBySection(sectionKey);
  await plexEmptyTrashBySection(sectionKey);
}

export async function refreshPlexLibrariesAndEmptyTrash(): Promise<void> {
  await Promise.all([
    refreshPlexLibraryAndEmptyTrash("movie"),
    refreshPlexLibraryAndEmptyTrash("show"),
  ]);
}
