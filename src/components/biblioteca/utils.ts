import { formatDateTime } from "@/components/tehnic/utils";
import type { PlexBrowseItem, ShowEpisodeEntry } from "@/lib/services/plex-browse";

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

// „Episodul 8” — placeholder-ul TMDB, acceptat ca final după două săptămâni.
// Lângă „S10E08” ar spune de două ori același lucru.
const GENERIC_EPISODE_TITLE = /^episo(?:dul|de)\s*\d+$/i;

export function displayEpisodeTitle(title: string | null): string | null {
  return title && !GENERIC_EPISODE_TITLE.test(title.trim()) ? title : null;
}

export function itemLabel(item: PlexBrowseItem): string {
  return item.type === "movie" ? item.title : (item.show ?? "—");
}

// addedAt e în secunde (convenția Plex); formatDateTime vrea ISO.
export function addedDate(unixSec: number): string {
  if (!unixSec) return "—";
  return formatDateTime(new Date(unixSec * 1000).toISOString());
}

// Episoadele unui serial pe sezoane (pe sezonul real — ordonarea după data
// adăugării dădea un al doilea „Sezonul N”). Cel mai nou sezon primul, „Fără
// sezon” la coadă; în sezon, E1 → En.
export type SeasonGroup = { season: number | null; episodes: ShowEpisodeEntry[] };

export function groupBySeason(episodes: ShowEpisodeEntry[]): SeasonGroup[] {
  const bySeason = new Map<number | null, ShowEpisodeEntry[]>();
  for (const ep of episodes) {
    const list = bySeason.get(ep.season);
    if (list) list.push(ep);
    else bySeason.set(ep.season, [ep]);
  }
  return [...bySeason.entries()]
    .map(([season, eps]) => ({ season, episodes: eps }))
    .sort((a, b) => (b.season ?? -Infinity) - (a.season ?? -Infinity));
}

export function matchesQuery(item: PlexBrowseItem, q: string): boolean {
  if (!q) return true;
  const n = norm(q);
  return [item.title, item.show, item.originalTitle].some((t) => !!t && norm(t).includes(n));
}

const STALE_UNWATCHED_SECONDS = 90 * 24 * 60 * 60; // 3 luni

// De curățat: nevăzut de nimeni, iar adăugarea nu e recentă. La seriale,
// `addedAt` e ultimul episod — un serial care primește episoade nu e „uitat”.
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

// Următorul episod în ora României: `airstamp` (TVmaze) e un instant cu fus,
// convertit de toLocaleString (corect și la ora de vară). Fără TVmaze, data
// TMDB fără oră.
export function nextEpisodeWhen(
  airDate: string | null,
  airstamp: string | null,
): { text: string; soon: boolean } | null {
  const when = airstamp ? new Date(airstamp) : airDate ? new Date(`${airDate}T00:00:00`) : null;
  if (!when || Number.isNaN(when.getTime())) return null;

  const dayLabel = when.toLocaleDateString("ro-RO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const time = airstamp
    ? when.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })
    : null;

  // Zile calendaristice: un episod de mâine dimineață e „mâine” chiar peste 9h.
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(when) - startOfDay(new Date())) / 86_400_000);
  const relative =
    days === 0 ? "azi" : days === 1 ? "mâine" : days > 1 && days <= 7 ? `în ${days} zile` : null;

  const head = relative ?? dayLabel;
  return { text: time ? `${head}, ${time}` : head, soon: days >= 0 && days <= 2 };
}

// Calitățile alegibile la urmărire — aceleași etichete ca detectTorrentQuality.
export const WATCH_QUALITIES = ["4K HDR", "4K", "1080p HDR", "1080p", "720p", "SD"];

// Data difuzării, scurt („6 ian. 2026”), la miezul nopții local — în UTC ar
// putea sări o zi.
export function airDateLabel(airDate: string | null): string | null {
  if (!airDate) return null;
  const d = new Date(`${airDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("ro-RO", { day: "numeric", month: "short", year: "numeric" });
}

// Și mai scurt, pentru lista de episoade: „26 sept.” (anul doar dacă nu e cel curent).
export function airDateShort(airDate: string | null): string | null {
  if (!airDate) return null;
  const d = new Date(`${airDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("ro-RO", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

// Cadrele sunt salvate la `original` (pentru drawer); ca miniatură, varianta
// de 300px — altfel sute de KB per rând.
export function stillThumb(url: string | null): string | null {
  return url ? url.replace(/\/t\/p\/[^/]+\//, "/t/p/w300/") : null;
}

// Momentul, scurt: „azi, 20:29”, „ieri, 20:29”, „27 sept., 20:29” — pentru
// rândurile înguste. `unixSec` în secunde.
export function dayTimeLabel(unixSec: number, withTime = true): string {
  if (!unixSec) return "—";
  const d = new Date(unixSec * 1000);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
  const day =
    days === 0
      ? "azi"
      : days === 1
        ? "ieri"
        : d.toLocaleDateString("ro-RO", {
            day: "numeric",
            month: "short",
            ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
          });
  if (!withTime) return day;
  const time = d.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

// Ultima verificare a urmăririi — format SQLite în UTC (fără „Z”, new Date()
// ar citi-o ca oră locală).
export function lastCheckedLabel(sqliteUtc: string | null): string {
  if (!sqliteUtc) return "Încă neverificat";
  const ms = new Date(`${sqliteUtc.replace(" ", "T")}Z`).getTime();
  if (Number.isNaN(ms)) return "Încă neverificat";
  return `Verificat ${dayTimeLabel(Math.floor(ms / 1000))}`;
}

// Data SQLite (UTC) → „27 oct., 14:05” — termenul unei ștergeri programate.
export function deleteTimeLabel(at: string): string {
  return new Date(`${at.replace(" ", "T")}Z`).toLocaleString("ro-RO", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
