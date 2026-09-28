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

// "Episodul 8" — TMDB întoarce asta când episodul n-are nume propriu, iar
// show-watch îl salvează ca răspuns final după două săptămâni (altfel ar
// reinteroga la nesfârșit). N-are rost afișat lângă "S10E08": ar spune de
// două ori același lucru.
const GENERIC_EPISODE_TITLE = /^episo(?:dul|de)\s*\d+$/i;

export function displayEpisodeTitle(title: string | null): string | null {
  return title && !GENERIC_EPISODE_TITLE.test(title.trim()) ? title : null;
}

export function itemLabel(item: PlexBrowseItem): string {
  return item.type === "movie" ? item.title : (item.show ?? "—");
}

// addedAt e unix timestamp în secunde (convenția Plex) — formatDateTime
// lucrează cu ISO, de-aia conversia
export function addedDate(unixSec: number): string {
  if (!unixSec) return "—";
  return formatDateTime(new Date(unixSec * 1000).toISOString());
}

// Gruparea pe sezoane a episoadelor unui serial, pentru lista din drawer.
//
// Grupare pe sezonul real, nu pe secvențe consecutive cronologic ca înainte:
// atâta timp cât lista era ordonată după data adăugării, un sezon reluat mai
// târziu producea un al doilea segment "Sezonul N". Acum episoadele vin deja
// sortate după (sezon, episod) din server, deci fiecare sezon apare o
// singură dată, cu episoadele lui în ordine.
//
// Cel mai nou sezon primul — acolo apar episoadele noi; „Fără sezon” la coadă.
// În interiorul sezonului rămâne ordinea firească, E1 → En.
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

// Semnal de curățenie: nimeni nu l-a vizionat de la adăugare, iar adăugarea
// nu e recentă (deci nu e doar "încă n-a apucat nimeni să-l vadă"). Pentru
// seriale, `addedAt` e episodul cel mai recent — un serial care încă
// primește episoade nu e "uitat", chiar dacă a început demult.
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

// Următorul episod, în ora României. `airstamp` (TVmaze) e un instant ISO cu
// fus, deci toLocaleString îl convertește singur în ora locală — nu calculăm
// noi niciun offset și nu se strică la trecerea la ora de vară. Când TVmaze
// n-are serialul, cădem pe data fără oră de la TMDB.
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

  // Zile calendaristice, nu diferență de 24h: un episod de mâine dimineață e
  // "mâine" chiar dacă până atunci mai sunt 9 ore.
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(when) - startOfDay(new Date())) / 86_400_000);
  const relative =
    days === 0 ? "azi" : days === 1 ? "mâine" : days > 1 && days <= 7 ? `în ${days} zile` : null;

  const head = relative ?? dayLabel;
  return { text: time ? `${head}, ${time}` : head, soon: days >= 0 && days <= 2 };
}

// Calitățile care se pot alege la urmărire (principală și rezervă) — aceleași
// etichete ca detectTorrentQuality. Folosite de drawer-ul serialului și de cel
// al filmului așteptat.
export const WATCH_QUALITIES = ["4K HDR", "4K", "1080p HDR", "1080p", "720p", "SD"];

// Data difuzării unui episod (YYYY-MM-DD, TMDB), scurt: „6 ian. 2026”.
// Miezul nopții local, nu UTC — altfel data ar putea sări cu o zi.
export function airDateLabel(airDate: string | null): string | null {
  if (!airDate) return null;
  const d = new Date(`${airDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("ro-RO", { day: "numeric", month: "short", year: "numeric" });
}

// Data difuzării, și mai scurt, pentru rândurile din lista de episoade:
// „26 sept.”, cu anul doar când nu e cel curent.
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

// Cadrele de episod se salvează la rezoluția `original` (pentru drawer-ul
// episodului, unde se văd mari). Ca miniatură de ~90px, aceeași imagine ar
// însemna sute de KB per rând — TMDB servește și o variantă de 300px.
export function stillThumb(url: string | null): string | null {
  return url ? url.replace(/\/t\/p\/[^/]+\//, "/t/p/w300/") : null;
}

// Momentul unui eveniment, scurt: „azi, 20:29”, „ieri, 20:29”, „27 sept.,
// 20:29”, cu anul doar când nu e cel curent. Pentru rândurile înguste din
// drawer, unde „28 septembrie 2026 la 21:40” rupea rândul în două.
// `unixSec` în secunde (convenția Plex, ca addedDate).
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

// Ultima verificare a urmăririi, pentru cardul de urmărire. Coloana e în
// formatul SQLite, în UTC ("2026-09-28 17:29:04") — fără "Z", new Date() ar
// citi-o ca oră locală.
export function lastCheckedLabel(sqliteUtc: string | null): string {
  if (!sqliteUtc) return "Încă neverificat";
  const ms = new Date(`${sqliteUtc.replace(" ", "T")}Z`).getTime();
  if (Number.isNaN(ms)) return "Încă neverificat";
  return `Verificat ${dayTimeLabel(Math.floor(ms / 1000))}`;
}
