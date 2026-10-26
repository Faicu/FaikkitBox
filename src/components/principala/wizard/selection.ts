// Funcțiile pure de selecție ale wizard-ului — fără stare, React sau rețea,
// testabile separat.

import { detectQuality } from "@/components/filelist/quality-utils";
import type { QualitySet } from "@/components/filelist/types";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import { rankTorrents, type TorrentKind } from "@/lib/media/torrent-rank";
import type { Quality } from "./types";

export function pickFromSet(set: QualitySet, quality: Quality): FilelistTorrent[] {
  if (quality === "720p") return set.t720;
  if (quality === "1080p") return set.t1080;
  if (quality === "1080p HDR") return set.t1080Hdr;
  if (quality === "4K") return set.t4k;
  return set.t4kHdr;
}

// Statusurile TMDB ale unui serial care mai poate primi episoade.
export const ONGOING_TV_STATUSES = new Set([
  "Returning Series",
  "In Production",
  "Planned",
  "Pilot",
]);

export function tvStatusLabel(status: string): string {
  switch (status) {
    case "Returning Series":
      return "va reveni cu sezoane noi";
    case "In Production":
      return "sezon nou în lucru";
    case "Planned":
      return "sezon nou anunțat, nefilmat încă";
    case "Pilot":
      return "doar episod pilot deocamdată";
    default:
      return status;
  }
}

// Ordinea calităților, pentru „upgrade” față de Plex — același vocabular ca
// plexQualityFromMedia. Necunoscutul primește 0, deci niciodată „mai bun”.
// Rezoluția primează, HDR departajează: 4K fără HDR > 1080p HDR.
const QUALITY_RANK: Record<string, number> = {
  "720p": 1,
  "1080p": 2,
  "1080p HDR": 3,
  "4K": 4,
  "4K HDR": 5,
};

// Perechile HDR / fără HDR la aceeași rezoluție („1080p” și „4K” = fără HDR) —
// pentru „Există și în HDR” și întoarcerea la varianta fără HDR.
export function hdrVariantOf(q: Quality): Quality | null {
  if (q === "1080p") return "1080p HDR";
  if (q === "4K") return "4K HDR";
  return null;
}

export function sdrVariantOf(q: Quality): Quality | null {
  if (q === "1080p HDR") return "1080p";
  if (q === "4K HDR") return "4K";
  return null;
}

export function qualityRank(q: string | null): number {
  return q ? (QUALITY_RANK[q] ?? 0) : 0;
}

// Direcția descărcării față de Plex — ambele sensuri sunt legitime (4K HDR
// peste 1080p, dar și 1080p peste 4K pentru un TV mai vechi); rezultatul e un
// al doilea fișier, nu o înlocuire. `owned` = TOATE calitățile din Plex.
// `null` = nu propunem nimic: calitatea aleasă e deja deținută, sau nu există
// un rang cunoscut de comparat (o a doua descărcare pe ghicite e exact
// duplicatul de evitat). Referința e cea mai bună calitate deținută.
export type QualityDirection = "upgrade" | "downgrade";

export function qualityDirection(
  owned: readonly string[],
  chosen: string | null,
): QualityDirection | null {
  if (!chosen) return null;
  if (owned.includes(chosen)) return null;
  const to = qualityRank(chosen);
  if (to === 0) return null;
  const from = Math.max(0, ...owned.map(qualityRank));
  if (from === 0) return null;
  return to > from ? "upgrade" : "downgrade";
}

// Primul din `matchesForQuality` (deja ordonată).
export function bestOf(list: FilelistTorrent[]): FilelistTorrent | null {
  return list[0] ?? null;
}

// Torrentele la o calitate, fără cele excluse, cel mai bun primul — pentru
// alegerea automată și pentru lista manuală (admin).
export function matchesForQuality(
  torrents: FilelistTorrent[],
  quality: Quality,
  kind: TorrentKind,
): FilelistTorrent[] {
  return rankTorrents(
    torrents.filter((t) => {
      const q = detectQuality(t.name);
      if (quality === "720p") return q.is720p;
      if (quality === "1080p") return q.is1080p;
      if (quality === "1080p HDR") return q.is1080pHdr;
      if (quality === "4K") return q.is4k;
      return q.is4kHdr;
    }),
    kind,
  );
}

const ALL_QUALITIES: Quality[] = ["720p", "1080p", "1080p HDR", "4K", "4K HDR"];

// Calitățile cu măcar un torrent, cele mai apropiate de `preferred` întâi —
// pentru „nu există la calitatea aleasă”, ca să afli că există la alta.
export function availableQualities(
  torrents: FilelistTorrent[],
  preferred: Quality,
  kind: TorrentKind,
): Quality[] {
  return otherQualitiesWhere(preferred, (q) => matchesForQuality(torrents, q, kind).length > 0);
}

// Calitățile diferite de `preferred` care îndeplinesc condiția, cele mai
// apropiate întâi.
export function otherQualitiesWhere(preferred: Quality, has: (q: Quality) => boolean): Quality[] {
  const pref = ALL_QUALITIES.indexOf(preferred);
  return ALL_QUALITIES.filter((q) => q !== preferred && has(q)).sort(
    (a, b) => Math.abs(ALL_QUALITIES.indexOf(a) - pref) - Math.abs(ALL_QUALITIES.indexOf(b) - pref),
  );
}

// Numele afișat utilizatorilor obișnuiți, în locul lansării: titlul original
// fără punctuație, anul, S/E și calitatea („Transformers The Last Knight 2017
// 1080p HDR”). Un titlu în alt alfabet cade pe `fallbackTitle` (română).
export function friendlyReleaseName(input: {
  originalTitle: string;
  fallbackTitle?: string;
  year: string | null;
  quality: string;
  season?: number;
  episode?: number;
  isSeasonPack: boolean;
}): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const base =
    input.fallbackTitle && !isLatinTitle(input.originalTitle)
      ? input.fallbackTitle
      : input.originalTitle;
  const title = base
    .replace(/[:\u2013\u2014]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const part =
    input.season === undefined
      ? null
      : input.isSeasonPack || input.episode === undefined
        ? `Sezonul ${input.season}`
        : `S${pad(input.season)}E${pad(input.episode)}`;
  return [title, input.year, part, input.quality === "SD" ? null : input.quality]
    .filter(Boolean)
    .join(" ");
}

// Doar litere latine (cu diacritice), cifre, punctuație și spații.
export function isLatinTitle(title: string): boolean {
  return !/[^\p{Script=Latin}\p{N}\p{P}\p{S}\p{Z}]/u.test(title);
}
