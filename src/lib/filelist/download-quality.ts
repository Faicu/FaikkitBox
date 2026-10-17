// Ce calitate are voie să descarce cineva care nu e admin: 1080p, iar altă
// calitate doar când titlul nu există deloc la 1080p pe Filelist (atunci
// wizard-ul îi sugerează calitățile disponibile).
//
// Verificarea se face pe server, după torrentele aduse de Filelist la
// căutarea din wizard (`rememberWizardTorrents`), nu după ce trimite
// browserul: numele torrentului din cererea de descărcare vine de la client,
// deci un torrent 4K putea fi trimis cu un nume „1080p". Memoria e per
// utilizator și expiră; după o repornire, utilizatorul caută din nou.

import { detectQuality } from "@/components/filelist/quality-utils";
import type { FilelistTorrent } from "@/lib/filelist.functions";

const TTL_MS = 6 * 60 * 60 * 1000;

interface Offer {
  name: string;
  // Titlul căutat are măcar un torrent 1080p pe Filelist.
  titleHas1080p: boolean;
  at: number;
}

const offers = new Map<string, Offer>();

export function rememberWizardTorrents(userId: number, torrents: FilelistTorrent[]): void {
  const now = Date.now();
  for (const [k, o] of offers) if (now - o.at > TTL_MS) offers.delete(k);
  const titleHas1080p = torrents.some((t) => detectQuality(t.name).is1080p);
  for (const t of torrents) {
    offers.set(`${userId}:${t.id}`, { name: t.name, titleHas1080p, at: now });
  }
}

export function qualityAllowed(torrentName: string, titleHas1080p: boolean): boolean {
  return detectQuality(torrentName).is1080p || !titleHas1080p;
}

export function checkNonAdminDownload(
  userId: number,
  torrentId: number,
): { ok: true } | { ok: false; error: string } {
  const offer = offers.get(`${userId}:${torrentId}`);
  if (!offer || Date.now() - offer.at > TTL_MS) {
    return {
      ok: false,
      error: "Torrentul nu mai e în căutarea ta recentă — caută din nou titlul și reîncearcă.",
    };
  }
  if (!qualityAllowed(offer.name, offer.titleHas1080p)) {
    return {
      ok: false,
      error: "Titlul e disponibil la 1080p — doar adminul poate descărca altă calitate.",
    };
  }
  return { ok: true };
}
