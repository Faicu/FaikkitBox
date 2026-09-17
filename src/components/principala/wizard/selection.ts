// Funcțiile pure de selecție/clasificare folosite de wizard — fără stare,
// fără React, fără rețea. Scoase din AddMediaWizard.tsx ca să poată fi citite
// și testate separat de cele 1200 de linii de componentă.

import { detectQuality } from "@/components/filelist/quality-utils";
import type { QualitySet } from "@/components/filelist/types";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import type { Quality } from "./types";

export function pickFromSet(set: QualitySet, quality: Quality): FilelistTorrent[] {
  if (quality === "720p") return set.t720;
  if (quality === "1080p") return set.t1080;
  if (quality === "4K") return set.t4k;
  return set.t4kHdr;
}

// Statusurile TMDB pentru un serial care încă poate primi sezoane/episoade
// noi — restul ("Ended", "Canceled") înseamnă că seria s-a încheiat definitiv.
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

// Ordinea calităților, pentru a decide dacă o descărcare ar fi un upgrade
// față de ce e deja în Plex. `plexQualityFromMedia` (plex-shared.ts) produce
// exact același vocabular, deci comparația e directă; orice altceva
// (rezoluții exotice, "480") primește 0 — necunoscut, deci niciodată "mai
// bun decât", ca să nu propunem un upgrade pe baza unei ghiceli.
const QUALITY_RANK: Record<string, number> = {
  "720p": 1,
  "1080p": 2,
  "4K": 3,
  "4K HDR": 4,
};

export function qualityRank(q: string | null): number {
  return q ? (QUALITY_RANK[q] ?? 0) : 0;
}

// În ce direcție ar duce descărcarea calității alese, față de ce e deja în
// Plex. Ambele sensuri sunt legitime: iei 4K HDR peste 1080p, dar și 1080p
// peste 4K HDR (spațiu, un TV care nu duce 4K, un telefon). În ambele cazuri
// rezultatul e un al doilea fișier, nu o înlocuire — de-aia ecranul spune
// explicit asta.
//
// `owned` e lista COMPLETĂ a calităților din Plex, fiindcă un film poate fi
// acolo în mai multe versiuni deodată. `null` înseamnă "nu propunem nimic":
//  - calitatea aleasă e deja în bibliotecă (inclusiv ca a doua versiune) —
//    altfel, cu 4K HDR + 1080p deținute, ecranul ți-ar fi oferit vesel un
//    "upgrade la 4K HDR" pe care deja îl ai;
//  - niciun rang cunoscut de comparat (0 — listă goală, doar rezoluții
//    exotice, sau alegere necunoscută): n-am ști în ce direcție ne mișcăm, iar
//    o a doua descărcare pe baza unei ghiceli e exact duplicatul de evitat.
//
// Referința e cea mai bună calitate deținută: cu 4K HDR + 720p în bibliotecă,
// un 1080p e un downgrade față de ce ai mai bun, nu un upgrade față de 720p.
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

export function bestOf(list: FilelistTorrent[]): FilelistTorrent | null {
  return list.length ? [...list].sort((a, b) => b.seeders - a.seeders)[0] : null;
}

export function sortBySeeders(list: FilelistTorrent[]): FilelistTorrent[] {
  return [...list].sort((a, b) => b.seeders - a.seeders);
}

// Toate torrentele care se potrivesc la o calitate, sortate după seederi —
// folosit pentru alegerea manuală (admin), la filme și la sezoane/episoade
// individuale.
export function matchesForQuality(
  torrents: FilelistTorrent[],
  quality: Quality,
): FilelistTorrent[] {
  return sortBySeeders(
    torrents.filter((t) => {
      const q = detectQuality(t.name);
      if (quality === "720p") return q.is720p;
      if (quality === "1080p") return q.is1080p;
      if (quality === "4K") return q.is4k;
      return q.is4kHdr;
    }),
  );
}
