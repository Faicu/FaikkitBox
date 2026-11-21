// Adăugarea unui fișier .torrent de mână (Bibliotecă, doar admin) — pentru
// titlurile care nu sunt pe Filelist. Din fișier: numele, mărimea și hash-ul;
// din IMDb ID: restul, de pe TMDB. După trimitere, același drum ca o
// descărcare Filelist (finishFilelistDownload).

import { getDb } from "../db";
import { parseSeasonEpisodeFromName } from "../media/torrent-name-parse";
import {
  autoResolveManualMedia,
  computeTorrentInfoHash,
  finishFilelistDownload,
  readTorrentInfo,
  sendTorrentToQbit,
} from "./download";

export const MAX_TORRENT_FILE_BYTES = 10 * 1024 * 1024;

export interface TorrentFileInput {
  torrentBase64: string;
  imdb: string;
  // „Filelist”, „TorrentLeech” sau ce a scris omul la „Altceva”.
  source: string;
  sourceUrl?: string | null;
  // Doar la seriale, când numele lansării nu le conține.
  season?: number | null;
  episode?: number | null;
  dryRun?: boolean;
}

export type TorrentFileResult =
  | {
      status: "preview";
      torrentName: string;
      size: number;
      mediaType: "movie" | "tv";
      title: string;
      year: number | null;
      posterPath: string | null;
      // Ce s-a găsit în nume; null la serial = trebuie completat de mână.
      season: number | null;
      episode: number | null;
      needsSeason: boolean;
      existingMediaId: number | null;
    }
  | { status: "ok"; mediaId: number | null; torrentName: string }
  | { status: "error"; error: string };

// Numele lansării fără extensia video, la torrentele cu un singur fișier.
function releaseName(name: string): string {
  return name.replace(/\.(mkv|mp4|avi|m2ts|ts)$/i, "");
}

export async function addTorrentFileCore(
  input: TorrentFileInput,
  requestedByUserId: number | null,
): Promise<TorrentFileResult> {
  const imdbId = /tt\d{7,}/.exec(input.imdb)?.[0];
  if (!imdbId) return { status: "error", error: "IMDb ID invalid (ex. tt1793239)" };

  const buf = Buffer.from(input.torrentBase64, "base64");
  if (buf.length === 0 || buf.length > MAX_TORRENT_FILE_BYTES) {
    return { status: "error", error: "Fișierul .torrent lipsește sau e prea mare" };
  }
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) as ArrayBuffer;
  const info = readTorrentInfo(buf);
  const torrentHash = computeTorrentInfoHash(bytes);
  if (!info || !torrentHash) return { status: "error", error: "Fișierul nu e un .torrent valid" };
  const torrentName = releaseName(info.name);

  const { lookupTmdbInfoByImdbId } = await import("../tmdb/tmdb-title-lookup");
  const tmdb = await lookupTmdbInfoByImdbId(imdbId).catch(() => null);
  if (!tmdb) return { status: "error", error: `TMDB nu găsește ${imdbId}` };
  const isMovie = tmdb.mediaType === "movie";

  const parsed = isMovie ? null : parseSeasonEpisodeFromName(torrentName);
  const season = input.season ?? parsed?.season ?? null;
  const episode = input.season != null ? (input.episode ?? null) : (parsed?.episode ?? null);

  const existing = getDb()
    .prepare("SELECT id FROM media WHERE torrent_hash = ?")
    .get(torrentHash) as { id: number } | undefined;

  if (input.dryRun) {
    return {
      status: "preview",
      torrentName,
      size: info.size,
      mediaType: tmdb.mediaType,
      title: tmdb.title,
      year: tmdb.year ? Number(tmdb.year) : null,
      posterPath: tmdb.posterPath ? `https://image.tmdb.org/t/p/w154${tmdb.posterPath}` : null,
      season: parsed?.season ?? null,
      episode: parsed?.episode ?? null,
      needsSeason: !isMovie && !parsed,
      existingMediaId: existing?.id ?? null,
    };
  }

  if (existing) return { status: "error", error: "Torrentul e deja în bibliotecă" };
  if (!isMovie && season == null) {
    return { status: "error", error: "Completează sezonul — nu apare în numele lansării" };
  }
  const source = input.source.trim();
  if (!source) return { status: "error", error: "Alege sursa" };

  const media = await autoResolveManualMedia(imdbId, torrentName, isMovie);
  if (!media) return { status: "error", error: `Nu am putut citi datele TMDB pentru ${imdbId}` };
  if (!isMovie) {
    media.season = season;
    media.episode = episode;
    media.isSeasonPack = episode == null;
  }

  const sent = await sendTorrentToQbit(bytes, torrentName, isMovie);
  if (!sent.ok) return { status: "error", error: sent.error };
  if (sent.duplicate) return { status: "error", error: "Torrentul există deja în qBittorrent" };

  const sourceUrl = input.sourceUrl?.trim() || null;
  // Un link Filelist poartă id-ul torrentului — rândul se leagă de el ca la
  // descărcările din aplicație.
  const filelistId =
    /filelist/i.test(source) && sourceUrl ? Number(/[?&]id=(\d+)/.exec(sourceUrl)?.[1] ?? 0) : 0;

  const mediaId = await finishFilelistDownload({
    params: {
      torrentId: filelistId,
      torrentName,
      categoryId: 0,
      categoryName: source,
      size: info.size,
      imdb: imdbId,
      requestedByUserId,
      media,
    },
    catId: 0,
    catName: source,
    savePath: sent.savePath,
    isMovie,
    torrentHash,
  });
  if (mediaId != null && sourceUrl) {
    getDb().prepare("UPDATE media SET source_url = ? WHERE id = ?").run(sourceUrl, mediaId);
  }
  return { status: "ok", mediaId, torrentName };
}
