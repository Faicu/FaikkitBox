// Clasamentul torrentelor de la aceeași calitate — sursă unică pentru
// alegerea automată din wizard, pentru ordinea listei de alegere manuală
// (admin) și pentru urmărirea automată (movie-watch.ts, show-watch.ts).
//
// Pur, fără I/O: rulează și în browser, și pe server.
//
// Excluse complet: fără seederi, CAM/TS/TELESYNC, discurile Blu-ray complete
// (BDMV/ISO — Plex nu le redă ca fișier), lansările 3D (SBS/OU — pe un TV
// obișnuit se văd două imagini una lângă alta) și lansările WEB doar Dolby
// Vision (profil 5, fără strat HDR10 — pe un TV fără DV ies culori greșite sau
// transcodare). Restul, în ordine, fiecare criteriu decide doar la egalitate
// pe cele de deasupra:
//   0. REMUX mereu ultimul, chiar și intern (40–90 GB, bitrate prea mare
//      pentru redarea de la distanță)
//   1. intern Filelist (playWEB, playHD…)
//   2. sursa — seriale: WEB-DL > BluRay > WEBRip > altele;
//      filme: WEB-DL = BluRay > WEBRip > altele
//   3. REPACK/PROPER înaintea originalului
//   4. freeleech
//   5. seederi — de la 5 în sus contează la fel
//   6. încărcat mai recent

export type TorrentKind = "movie" | "tv";

export interface RankableTorrent {
  name: string;
  seeders: number;
  internal?: boolean;
  freeleech?: boolean;
  upload_date?: string;
}

const ENOUGH_SEEDERS = 5;

const LOW_QUALITY_SOURCE = /\b(cam|camrip|hdcam|ts|hdts|telesync|pdvd)\b/;
const DOLBY_VISION = /\b(dv|dovi)\b|dolby.?vision/;
const BLURAY = /\b(blu-?ray|bdrip)\b/;
const STEREO_3D = /\b(3d|h-?sbs|h-?ou|half-?(sbs|ou)|sbs)\b/;
const isRemux = (n: string) => /\b(bd)?remux\b/.test(n);

// Partea tehnică a numelui: de la anul lansării sau de la S01/S01E02 încolo.
// „TS", „3D", „CAM" se caută doar aici, ca un titlu care chiar conține
// cuvântul („Toy Story 3D", „TS Eliot…") să nu fie exclus. Un an chiar la
// începutul numelui e titlu („2012.2009.1080p…"), nu marcaj. Fără an sau
// sezon în nume, tot numele.
const RELEASE_MARK = /(?<=[.\s_([-])((19|20)\d{2}|s\d{1,2}(e\d{1,3})?)(?=$|[.\s_)\]-])/;
function releaseTail(n: string): string {
  const m = RELEASE_MARK.exec(n);
  return m ? n.slice(m.index) : n;
}

// Disc complet (folder BDMV sau imagine ISO, nu fișier video) — singura
// regulă din proiect: o folosește și căutarea Filelist (filelist-client.ts),
// care le scoate din orice listă, inclusiv din căutarea manuală.
//   - „COMPLETE.BLURAY" / „COMPLETE.UHD.BLURAY" (scene), „ISO", „BDMV";
//   - „BluRay"/„Blu-ray" + AVC/VC-1/MPEG-2 (codecul discului);
//   - „Blu-ray" cu cratimă + HEVC (discurile UHD) — „BluRay.HEVC" fără
//     cratimă e un encode obișnuit;
// în ultimele două cazuri, doar fără encode (x264/x265/H.264/H.265) și fără
// Remux.
export function isFullDisc(name: string): boolean {
  const n = name.toLowerCase();
  if (/\bcomplete[.\s-]?(uhd[.\s-]?)?blu-?ray\b/.test(n)) return true;
  if (/\b(iso|bdmv)\b/.test(n)) return true;
  if (/\b(x26[45]|h\.?26[45]|(bd)?remux)\b/.test(n)) return false;
  return (
    (/\bblu-?ray\b/.test(n) && /\b(avc|vc-?1|mpeg-?2)\b/.test(n)) ||
    (/\bblu-ray\b/.test(n) && /\bhevc\b/.test(n))
  );
}

export function isExcludedTorrent(t: RankableTorrent): boolean {
  if (!(t.seeders > 0)) return true;
  const n = t.name.toLowerCase();
  const tail = releaseTail(n);
  if (LOW_QUALITY_SOURCE.test(tail)) return true;
  if (isFullDisc(n)) return true;
  if (STEREO_3D.test(tail)) return true;
  // „DV.HDR" / „DV HDR10" are strat HDR10 de rezervă; doar „DV" nu — dar
  // numai la WEB: Dolby Vision de pe Blu-ray/Remux (profil 7) are mereu bază HDR10,
  // chiar dacă numele scrie doar „DoVi".
  if (DOLBY_VISION.test(n) && !/\bhdr/.test(n) && !BLURAY.test(n) && !isRemux(n)) return true;
  return false;
}

function sourceTier(name: string, kind: TorrentKind): number {
  const n = name.toLowerCase();
  if (/\bweb-?rip\b/.test(n)) return 2;
  // „WEB" simplu (lansările scene) e tot WEB-DL.
  if (/\bweb(-?dl)?\b/.test(n)) return 0;
  if (BLURAY.test(n)) return kind === "tv" ? 1 : 0;
  return 3;
}

const isRepack = (name: string) => /\b(repack\d*|proper|rerip)\b/i.test(name);

export function compareTorrents(kind: TorrentKind) {
  return (a: RankableTorrent, b: RankableTorrent): number =>
    Number(isRemux(a.name.toLowerCase())) - Number(isRemux(b.name.toLowerCase())) ||
    Number(!!b.internal) - Number(!!a.internal) ||
    sourceTier(a.name, kind) - sourceTier(b.name, kind) ||
    Number(isRepack(b.name)) - Number(isRepack(a.name)) ||
    Number(!!b.freeleech) - Number(!!a.freeleech) ||
    Math.min(b.seeders, ENOUGH_SEEDERS) - Math.min(a.seeders, ENOUGH_SEEDERS) ||
    uploadedAt(b) - uploadedAt(a);
}

function uploadedAt(t: RankableTorrent): number {
  const ms = t.upload_date ? new Date(t.upload_date).getTime() : 0;
  return Number.isNaN(ms) ? 0 : ms;
}

// Fără cele excluse, cel mai bun primul. Lucrează pe o copie.
export function rankTorrents<T extends RankableTorrent>(list: T[], kind: TorrentKind): T[] {
  return list.filter((t) => !isExcludedTorrent(t)).sort(compareTorrents(kind));
}
