// Ce torrent are voie să descarce cineva care nu e admin: doar unul adus de
// Filelist la propria căutare din wizard (`rememberWizardTorrents`), la orice
// calitate — selectorul de calitate e deschis tuturor.
//
// Verificarea se face pe server, nu după ce trimite browserul: ID-ul
// torrentului din cererea de descărcare vine de la client, deci altfel se
// putea descărca orice torrent de pe Filelist. Memoria e per utilizator și
// expiră; după o repornire, utilizatorul caută din nou.

import type { FilelistTorrent } from "@/lib/filelist.functions";

const TTL_MS = 6 * 60 * 60 * 1000;

const offers = new Map<string, number>();

export function rememberWizardTorrents(userId: number, torrents: FilelistTorrent[]): void {
  const now = Date.now();
  for (const [k, at] of offers) if (now - at > TTL_MS) offers.delete(k);
  for (const t of torrents) offers.set(`${userId}:${t.id}`, now);
}

export function checkNonAdminDownload(
  userId: number,
  torrentId: number,
): { ok: true } | { ok: false; error: string } {
  const at = offers.get(`${userId}:${torrentId}`);
  if (at === undefined || Date.now() - at > TTL_MS) {
    return {
      ok: false,
      error: "Torrentul nu mai e în căutarea ta recentă — caută din nou titlul și reîncearcă.",
    };
  }
  return { ok: true };
}
