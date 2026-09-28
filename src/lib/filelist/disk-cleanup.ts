// ---------------------------------------------------------------------------
// Curățarea de pe disc la ștergerea completă a unui titlu, după ce
// qBittorrent și-a șters propriile fișiere (deleteMediaEntry, log.ts).
//
// qBittorrent șterge doar ce a descărcat el. Subtitrările scrise de aplicație
// (`.ro.srt`) nu îi aparțin, deci rămâneau pe disc: într-un folder de
// torrent, qBittorrent nu-l putea șterge („Directory not empty" — reziduul
// The Crown S02, 2 sept 2026); lângă un torrent cu un singur fișier,
// rămâneau orfane în rădăcina bibliotecii (9 găsite pe 28 sept 2026).
// ---------------------------------------------------------------------------

import { readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const SUBTITLE_EXT_RE = /\.(srt|sub|idx|ass|ssa)$/i;

// Subtitrările „sidecar" ale unui fișier video: în același folder, cu numele
// video-ului + sufix de limbă opțional + extensie de subtitrare
// ("Film.2026-GRUP.mkv" → "Film.2026-GRUP.ro.srt", "Film.2026-GRUP.srt").
export function sidecarSubtitleNames(videoFileName: string, dirEntries: string[]): string[] {
  const dot = videoFileName.lastIndexOf(".");
  if (dot <= 0) return [];
  const base = videoFileName.slice(0, dot);
  return dirEntries.filter((entry) => {
    if (!entry.startsWith(`${base}.`) || !SUBTITLE_EXT_RE.test(entry)) return false;
    // Între nume și extensie: nimic sau un singur sufix de limbă/etichetă
    // ("ro", "en", "forced") — nu alt fișier care doar începe la fel.
    const middle = entry.slice(base.length + 1).replace(SUBTITLE_EXT_RE, "");
    return middle === "" || /^[A-Za-z-]{2,10}$/.test(middle);
  });
}

// Gardă pentru ștergerea recursivă: calea trebuie să fie STRICT în interiorul
// unui folder de bibliotecă, niciodată folderul însuși. Un torrent cu mai
// multe fișiere și fără folder rădăcină are ca content_path chiar save_path
// (ex. /media/ssd2tb/Filme) — fără garda asta, ștergerea recursivă ar goli
// tot folderul de filme.
export function isInsideMediaRoot(
  path: string,
  roots: string[] = [
    process.env.MEDIA_MOVIES_PATH ?? "/media/ssd2tb/Filme",
    process.env.MEDIA_SERIES_PATH ?? "/media/ssd2tb/Seriale",
  ],
): boolean {
  if (path.split("/").includes("..")) return false;
  const clean = path.replace(/\/+$/, "");
  return roots
    .map((r) => r.replace(/\/+$/, ""))
    .some((root) => clean.startsWith(`${root}/`) && clean.length > root.length + 1);
}

// Șterge tot ce a mai rămas dintr-un torrent, pornind de la rădăcina lui
// (qbitTorrentRootPath): folderul, recursiv, sau — pentru un torrent cu un
// singur fișier în rădăcina bibliotecii — fișierul plus subtitrările de lângă
// el. Nu aruncă: un reziduu rămas nu trebuie să oprească ștergerea din `media`.
export async function removeTorrentResidue(rootPath: string): Promise<void> {
  if (!isInsideMediaRoot(rootPath)) {
    console.warn(`[filelist] Ștergere refuzată, cale în afara bibliotecii: ${rootPath}`);
    return;
  }
  try {
    const isFolder = await stat(rootPath).then(
      (s) => s.isDirectory(),
      () => false,
    );
    if (!isFolder) {
      const dir = dirname(rootPath);
      for (const name of sidecarSubtitleNames(basename(rootPath), await readdir(dir))) {
        await rm(join(dir, name), { force: true });
      }
    }
    await rm(rootPath, { recursive: true, force: true });
  } catch (e) {
    console.warn("[filelist] Nu am putut curăța reziduul de pe disk:", e);
  }
}
