import { formatDateTime } from "@/components/tehnic/utils";
import type { PlexBrowseItem } from "@/lib/services/plex-browse";

export function norm(s: string): string {
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

export function matchesQuery(item: PlexBrowseItem, q: string): boolean {
  if (!q) return true;
  const n = norm(q);
  return norm(item.title).includes(n) || (!!item.show && norm(item.show).includes(n));
}
