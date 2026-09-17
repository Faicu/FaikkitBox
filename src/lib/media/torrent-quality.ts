// Detectare calitate dintr-un nume de lansare — sursă unică, folosită atât în
// download.ts (notificări torrent adăugat/complet).

export type TorrentQualityLabel = "4K HDR" | "4K" | "1080p HDR" | "1080p" | "720p" | "SD";

export function detectTorrentQuality(name: string): TorrentQualityLabel {
  const n = name.toLowerCase();
  const is4k = /\b(4k|2160p)\b/.test(n);
  // „dv" e inclus: Dolby Vision e HDR chiar când numele nu scrie „HDR".
  const isHdr = /\b(dovi|dv|hdr\d*\+?|hlg)\b|dolby.?vision/.test(n);
  if (is4k && isHdr) return "4K HDR";
  if (is4k) return "4K";
  if (/\b1080p\b/.test(n)) return isHdr ? "1080p HDR" : "1080p";
  if (/\b720p\b/.test(n)) return "720p";
  return "SD";
}
