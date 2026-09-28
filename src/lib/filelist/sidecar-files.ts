// Subtitrările „sidecar" ale unui fișier video: în același folder, cu numele
// video-ului + sufix de limbă opțional + extensie de subtitrare
// ("Film.2026-GRUP.mkv" → "Film.2026-GRUP.ro.srt", "Film.2026-GRUP.srt").
//
// Folosit la ștergerea completă a unui torrent cu un singur fișier: acolo
// calea de conținut din qBittorrent e chiar fișierul video, iar `.ro.srt`-ul
// scris de aplicație lângă el nu aparține torrentului — qBittorrent nu-l
// știe, deci rămânea orfan pe disc (9 găsite pe 28 sept 2026). Funcție pură,
// primește lista de intrări din folder.
const SUBTITLE_EXT_RE = /\.(srt|sub|idx|ass|ssa)$/i;

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
// (ex. /media/ssd2tb/Filme) — fără garda asta, rmSync recursiv ar goli tot
// folderul de filme. Fără node:path: modulul ajunge și în bundle-ul de client.
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
