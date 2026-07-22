import type { FilelistTorrent } from "@/lib/filelist.functions";
import type { QualitySet, SeasonGroup } from "./types";

// ---------------------------------------------------------------------------
// Utilitar: elimină diacriticele pentru căutări externe (Filelist nu le suportă)
// ---------------------------------------------------------------------------

export function stripDiacritics(str: string): string {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Match strict, ancorat la începutul numelui — Filelist face doar căutare
// loose (substring) după nume, iar torrentele urmează convenția
// "Titlu.SxxExx..."/"Titlu.Anul...", deci titlul trebuie să apară chiar la
// început, nu doar oriunde în nume (altfel "Lucky" prinde și
// "I.Got.Lucky.Survival.Stories...").
export function torrentMatchesTitle(name: string, title: string): boolean {
  const words = stripDiacritics(title).trim().split(/\s+/).filter(Boolean).map(escapeRegex);
  if (words.length === 0) return false;
  const pattern = new RegExp(`^${words.join("[\\W_]+")}\\b`, "i");
  return pattern.test(stripDiacritics(name).trim());
}

export function filterTorrentsForItem(
  torrents: FilelistTorrent[],
  title: string,
  imdbId?: string | null,
): FilelistTorrent[] {
  return torrents.filter((t) => {
    if (t.imdb && imdbId) return t.imdb === imdbId;
    return torrentMatchesTitle(t.name, title);
  });
}

// ---------------------------------------------------------------------------
// Detectare calitate torrent
// ---------------------------------------------------------------------------

export function detectQuality(name: string) {
  const n = name.toLowerCase();
  const is4k = /2160p|4k/.test(n);
  const is4kHdr = is4k && /hdr/.test(n);
  const is1080p = /1080p/.test(n);
  return { is1080p, is4k: is4k && !is4kHdr, is4kHdr };
}

export function emptyQualitySet(): QualitySet {
  return { t1080: [], t4k: [], t4kHdr: [] };
}

export function groupTorrentsBySeasonEpisode(torrents: FilelistTorrent[]): SeasonGroup[] {
  const seasonMap = new Map<number, SeasonGroup>();

  for (const t of torrents) {
    const seasonMatch = t.name.match(/S(\d{2})/i);
    if (!seasonMatch) continue;
    const seasonNum = parseInt(seasonMatch[1], 10);
    if (seasonNum === 0) continue;

    if (!seasonMap.has(seasonNum)) {
      seasonMap.set(seasonNum, {
        seasonNum,
        byQuality: emptyQualitySet(),
        episodes: new Map(),
      });
    }

    const group = seasonMap.get(seasonNum)!;
    const epMatch = t.name.match(/S\d{2}E(\d{2})/i);
    const q = detectQuality(t.name);

    if (epMatch) {
      const epNum = parseInt(epMatch[1], 10);
      if (!group.episodes.has(epNum)) {
        group.episodes.set(epNum, emptyQualitySet());
      }
      const ep = group.episodes.get(epNum)!;
      if (q.is1080p) ep.t1080.push(t);
      if (q.is4k) ep.t4k.push(t);
      if (q.is4kHdr) ep.t4kHdr.push(t);
    } else {
      const bq = group.byQuality;
      if (q.is1080p) bq.t1080.push(t);
      if (q.is4k) bq.t4k.push(t);
      if (q.is4kHdr) bq.t4kHdr.push(t);
    }
  }

  return Array.from(seasonMap.values()).sort((a, b) => a.seasonNum - b.seasonNum);
}
