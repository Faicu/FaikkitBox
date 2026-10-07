// ---------------------------------------------------------------------------
// Gruparea și ordonarea torrentelor pentru tabul „Top Filelist" — funcții
// pure, fără rețea, ca să poată fi testate (vezi top-torrents.test.ts).
// Server function-ul (top-torrents.functions.ts) aduce datele și le trece pe
// aici.
// ---------------------------------------------------------------------------

import type { TmdbBasicInfo } from "../tmdb/tmdb-title-lookup";
import type { DiscoverTitle } from "../tmdb/tmdb.discover.functions";
import type { FilelistTorrent } from "./types";

export interface TopTorrentTitle extends DiscoverTitle {
  // Cheie unică în listă — același serial poate apărea cu episoade diferite.
  key: string;
  // "S10E07", "S10" (pachet de sezon) sau null la filme.
  episodeLabel: string | null;
  seeders: number;
  leechers: number;
  // IMDb id-ul titlului (din torrent) — pentru rating-ul IMDb.
  imdbId: string;
}

type SeasonEpisodeParser = (name: string) => { season: number; episode: number | null } | null;

// IMDb id-ul vine de la uploader — normalizat ca variații de scriere
// ("TT0066950", " tt0066950", "0066950") să nu rupă gruparea. Null dacă nu
// arată a IMDb id.
export function normalizeImdbId(raw: string | undefined): string | null {
  const m = raw?.trim().match(/^(?:tt)?(\d{7,9})$/i);
  return m ? `tt${m[1]}` : null;
}

export function episodeLabelFor(name: string, parse: SeasonEpisodeParser): string | null {
  const p = parse(name);
  if (!p) return null;
  const s = `S${String(p.season).padStart(2, "0")}`;
  return p.episode === null ? s : `${s}E${String(p.episode).padStart(2, "0")}`;
}

// Grupează după titlul TMDB rezolvat (tip + id), nu după IMDb id-ul brut —
// două release-uri ale aceluiași titlu cu IMDb id-uri diferite (ex. unul pus
// pe episod în loc de serial, dacă TMDB îl rezolvă) ajung pe același card.
// La seriale, grupul include și episodul/sezonul: fiecare episod e un card.
// Eticheta de episod se pune doar dacă TMDB zice că e serial — o miniserie
// urcată la seriale pe care TMDB o are ca film rămâne un card de film.
// Torrentele fără IMDb id valid sau nerezolvate pe TMDB sunt excluse.
// Ordonare: seederi + leecheri însumați pe grup; plafon aplicat separat pe
// filme și seriale, ca un tip să nu-l înghesuie pe celălalt din listă.
export function groupTopTorrents(
  torrents: FilelistTorrent[],
  tmdbByImdb: Map<string, TmdbBasicInfo | null>,
  parse: SeasonEpisodeParser,
  maxPerType: number,
): TopTorrentTitle[] {
  const groups = new Map<string, TopTorrentTitle>();
  for (const t of torrents) {
    const imdb = normalizeImdbId(t.imdb);
    const info = imdb ? tmdbByImdb.get(imdb) : null;
    if (!info) continue;
    const episodeLabel = info.mediaType === "tv" ? episodeLabelFor(t.name, parse) : null;
    const key = `${info.mediaType}-${info.id}-${episodeLabel ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.seeders += t.seeders;
      existing.leechers += t.leechers;
      continue;
    }
    groups.set(key, {
      key,
      id: info.id,
      mediaType: info.mediaType,
      title: info.title,
      originalTitle: info.originalTitle,
      year: info.year,
      posterUrl: info.posterPath ? `https://image.tmdb.org/t/p/w342${info.posterPath}` : null,
      imdbRating: null,
      imdbVotes: null,
      imdbId: imdb as string,
      episodeLabel,
      seeders: t.seeders,
      leechers: t.leechers,
    });
  }

  const ranked = [...groups.values()].sort(
    (a, b) => b.seeders + b.leechers - (a.seeders + a.leechers),
  );
  const perType = { movie: 0, tv: 0 };
  return ranked.filter((g) => ++perType[g.mediaType] <= maxPerType);
}

// Perioadele din care se poate alege în tab (orele de la urcare). Implicit
// 48h — cât acoperea lista înainte să existe alegerea.
export const TOP_PERIODS = [
  { hours: 24, label: "24h" },
  { hours: 48, label: "48h" },
  { hours: 72, label: "72h" },
  { hours: 168, label: "7 zile" },
] as const;
export type TopPeriodHours = (typeof TOP_PERIODS)[number]["hours"];
export const DEFAULT_TOP_PERIOD: TopPeriodHours = 48;

// Câte ore în urmă acoperă complet un set de loturi `latest-torrents`: cel mai
// vechi torrent din lotul care se oprește cel mai devreme. Un lot sub plafon
// conține tot ce există, deci nu limitează. Null = nelimitat.
export function coveredHours(
  batches: { capped: boolean; oldestUpload: string | null }[],
  now: number,
): number | null {
  let hours: number | null = null;
  for (const b of batches) {
    if (!b.capped || !b.oldestUpload) continue;
    const h = (now - parseUploadDate(b.oldestUpload)) / 3_600_000;
    if (hours === null || h < hours) hours = h;
  }
  return hours;
}

// Filelist dă data ca „2026-10-07 13:41:44", în ora României — aceeași cu a
// serverului, deci parsarea locală e corectă.
export function parseUploadDate(raw: string): number {
  return new Date(raw.replace(" ", "T")).getTime();
}
