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
