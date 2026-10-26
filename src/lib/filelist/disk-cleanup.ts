// ---------------------------------------------------------------------------
// Curățarea de pe disc după ce qBittorrent și-a șters fișierele. Subtitrările
// scrise de aplicație nu-i aparțin, deci rămâneau: un folder nu se mai putea
// șterge („Directory not empty”), iar lângă torrentele cu un singur fișier
// rămâneau orfane (9 găsite pe 28 sept. 2026).
// ---------------------------------------------------------------------------

import { readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

// `.respins` opțional: subtitrările puse deoparte sunt tot ale titlului.
const SUBTITLE_EXT_RE = /\.(srt|sub|idx|ass|ssa)(\.respins)?$/i;

// Subtitrările de lângă un video: același nume + sufixe de limbă opționale +
// extensie („Film.mkv” → „Film.ro.srt”, „Film.ro.forced.srt”, „Film.ro.srt.respins”).
export function sidecarSubtitleNames(videoFileName: string, dirEntries: string[]): string[] {
  const dot = videoFileName.lastIndexOf(".");
  if (dot <= 0) return [];
  const base = videoFileName.slice(0, dot);
  return dirEntries.filter((entry) => {
    if (!entry.startsWith(`${base}.`) || !SUBTITLE_EXT_RE.test(entry)) return false;
    // Doar sufix de limbă/etichetă — nu alt fișier care începe la fel
    // („Film.Extended.ro.srt”).
    const middle = entry.slice(base.length).replace(SUBTITLE_EXT_RE, "").replace(/^\./, "");
    return middle === "" || /^[A-Za-z-]{2,10}(\.(forced|sdh|cc|hi))?$/i.test(middle);
  });
}

// Gardă pentru ștergerea recursivă: calea STRICT în interiorul bibliotecii. Un
// torrent fără folder rădăcină are content_path = save_path — fără gardă, s-ar
// goli tot folderul de filme.
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

// Tot ce a rămas dintr-un torrent, de la rădăcina lui: folderul (recursiv) sau
// fișierul unic plus subtitrările lui. Nu aruncă.
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
