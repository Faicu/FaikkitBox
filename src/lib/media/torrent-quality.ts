// Detectare calitate dintr-un nume de lansare — sursă unică, folosită atât în
// download.ts (notificări torrent adăugat/complet), cât și de detectQuality
// din components/filelist (care importă `isHdrReleaseName` de aici, ca cele
// două să nu ajungă cu reguli HDR ușor diferite).

export type TorrentQualityLabel = "4K HDR" | "4K" | "1080p HDR" | "1080p" | "720p" | "SD";

// Marcajele HDR dintr-un nume de lansare. „DV"/„DoVi" (Dolby Vision) intră și
// ele: o lansare marcată doar așa e tot HDR, chiar dacă numele nu scrie „HDR"
// (ex. „...Atmos DV HDR10P x265-HiDt"). Limitele de cuvânt sunt esențiale —
// fără ele „Advent" ar deveni Dolby Vision.
export function isHdrReleaseName(lowercaseName: string): boolean {
  return /\b(dovi|dv|hdr\d*\+?|hlg)\b|dolby.?vision/.test(lowercaseName);
}

export function detectTorrentQuality(name: string): TorrentQualityLabel {
  const n = name.toLowerCase();
  const is4k = /\b(4k|2160p)\b/.test(n);
  const isHdr = isHdrReleaseName(n);
  if (is4k && isHdr) return "4K HDR";
  if (is4k) return "4K";
  if (/\b1080p\b/.test(n)) return isHdr ? "1080p HDR" : "1080p";
  if (/\b720p\b/.test(n)) return "720p";
  return "SD";
}
