import { formatDateTime } from "@/components/tehnic/utils";
import type { PlexBrowseItem } from "@/lib/services/plex-browse";

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function episodeCode(season: number | null, episode: number | null): string | null {
  return season != null && episode != null
    ? `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`
    : null;
}

export function itemLabel(item: PlexBrowseItem): string {
  if (item.type === "movie") return item.title;
  if (item.type === "tv_show") return item.show ?? "—";
  const code = episodeCode(item.season, item.episode);
  return `${item.show ?? "—"}${code ? ` — ${code}` : ""}${item.title ? ` · ${item.title}` : ""}`;
}

// addedAt e unix timestamp în secunde (convenția Plex) — formatDateTime
// lucrează cu ISO, de-aia conversia
export function addedDate(unixSec: number): string {
  if (!unixSec) return "—";
  return formatDateTime(new Date(unixSec * 1000).toISOString());
}

export type BrowseRow =
  | { kind: "single"; item: PlexBrowseItem }
  | { kind: "group"; key: string; show: string; items: PlexBrowseItem[] };

// Grupează episoadele consecutive (adiacente în lista sortată după addedAt)
// ale aceluiași serial într-un singur rând expandabil — un serial cu
// episoade lansate în zile diferite (deci neadiacente în listă) rămâne cu
// grupuri separate, nu unul singur, ca ordinea cronologică să rămână corectă.
export function groupConsecutiveEpisodes(items: PlexBrowseItem[]): BrowseRow[] {
  const rows: BrowseRow[] = [];
  let i = 0;
  while (i < items.length) {
    const cur = items[i];
    if (cur.type === "episode" && cur.show) {
      let j = i + 1;
      while (j < items.length && items[j].type === "episode" && items[j].show === cur.show) j++;
      if (j - i > 1) {
        rows.push({
          kind: "group",
          key: `${cur.show}-${cur.mediaId}`,
          show: cur.show,
          items: items.slice(i, j),
        });
        i = j;
        continue;
      }
    }
    rows.push({ kind: "single", item: cur });
    i++;
  }
  return rows;
}

// Împarte episoadele unui grup (deja în ordine cronologică) în segmente
// consecutive cu același sezon, pentru subtitluri "Sezonul N" — dacă
// sezonul sare înainte-înapoi cronologic, apar mai multe segmente separate
// pentru același sezon, ca ordinea cronologică să rămână corectă.
export type SeasonSegment = { season: number | null; items: PlexBrowseItem[] };

export function groupBySeasonConsecutive(items: PlexBrowseItem[]): SeasonSegment[] {
  const segments: SeasonSegment[] = [];
  for (const item of items) {
    const last = segments[segments.length - 1];
    if (last && last.season === item.season) {
      last.items.push(item);
    } else {
      segments.push({ season: item.season, items: [item] });
    }
  }
  return segments;
}

export function matchesQuery(item: PlexBrowseItem, q: string): boolean {
  if (!q) return true;
  const n = norm(q);
  return norm(item.title).includes(n) || (!!item.show && norm(item.show).includes(n));
}

const STALE_UNWATCHED_SECONDS = 90 * 24 * 60 * 60; // 3 luni

// Semnal de curățenie: nimeni nu l-a vizionat de la adăugare, iar adăugarea
// nu e recentă (deci nu e doar "încă n-a apucat nimeni să-l vadă").
export function isStaleUnwatched(item: PlexBrowseItem, nowSec = Date.now() / 1000): boolean {
  return item.watchedCount === 0 && nowSec - item.addedAt > STALE_UNWATCHED_SECONDS;
}

export type SortMode = "recent" | "mostWatched" | "unwatched";

export function sortItems(items: PlexBrowseItem[], mode: SortMode): PlexBrowseItem[] {
  if (mode === "mostWatched") {
    return [...items].sort((a, b) => b.watchedCount - a.watchedCount || b.addedAt - a.addedAt);
  }
  if (mode === "unwatched") {
    return items.filter((it) => it.watchedCount === 0).sort((a, b) => b.addedAt - a.addedAt);
  }
  return items;
}
