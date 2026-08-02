// ---------------------------------------------------------------------------
// Asigură subtitrare română corectă la finalul unei descărcări Filelist.
// Apelat din pollUntilComplete (download.ts) înainte de refreshPlexLibrary.
//
// Două cazuri tratate:
//  1. Torrentul are deja un .srt, dar cu denumire greșită pentru Plex —
//     redenumit prin API-ul qBittorrent (torrents/renameFile), altfel
//     qBittorrent pierde evidența fișierului și consideră torrentul incomplet.
//  2. Torrentul nu are nicio subtitrare (nici încorporată, nici .srt) —
//     căutăm pe OpenSubtitles după IMDb id și alegem rezultatul al cărui
//     "release" se potrivește cel mai bine cu sursa/rezoluția torrentului
//     (o subtitrare pentru altă sursă/calitate desincronizează timpii).
//
// Orice eroare aici e prinsă și logată — nu trebuie să blocheze niciodată
// refresh-ul Plex care urmează.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join, dirname, basename, extname } from "node:path";
import { qbitGet, qbitListFiles, qbitRenameFile, type QbitFileInfo } from "../qbit-client";
import { searchSubtitles, downloadSubtitle, type OpenSubtitlesResult } from "../opensubtitles-client";

const execFileAsync = promisify(execFile);

const MEDIA_EXTENSIONS = [".mkv", ".mp4", ".avi", ".m2ts", ".ts", ".wmv", ".mov"];
const ROMANIAN_LANG_CODES = ["ro", "rum", "ron"];

interface EnsureRomanianSubtitleParams {
  qbitUrl: string;
  cookie: string;
  qbitUser: string;
  qbitPass: string;
  torrentHash: string;
  torrentName: string;
  imdbId?: string | null;
}

export type SubtitleOutcome =
  | "already_embedded"
  | "renamed_srt"
  | "downloaded_opensubtitles"
  | "downloaded_opensubtitles_approximate"
  | "multiple_srt_skipped"
  | "no_imdb"
  | "no_subtitle_found"
  | "download_failed"
  | "no_media_file";

async function logSubtitleActivity(
  torrentName: string,
  outcome: SubtitleOutcome,
  message: string,
  meta?: Record<string, string | number | boolean | null | undefined>,
): Promise<void> {
  try {
    const { logActivity } = await import("../activity-log");
    await logActivity("subtitle_fix", `${torrentName}: ${message}`, { outcome, ...meta });
  } catch {
    // logActivity are propriul fail-soft; nimic de făcut aici
  }
}

export async function ensureRomanianSubtitle(
  params: EnsureRomanianSubtitleParams,
): Promise<SubtitleOutcome> {
  const { qbitUrl, qbitUser, qbitPass, torrentHash, torrentName } = params;

  const [files, savePath] = await Promise.all([
    qbitListFiles(qbitUrl, torrentHash, qbitUser, qbitPass),
    getTorrentSavePath(qbitUrl, torrentHash, qbitUser, qbitPass),
  ]);
  if (!files.length || !savePath) return "no_media_file";

  const mediaFile = pickMediaFile(files);
  if (!mediaFile) return "no_media_file";

  const mediaAbsPath = join(savePath, mediaFile.name);
  const mediaBaseName = basename(mediaFile.name, extname(mediaFile.name));
  const mediaDir = dirname(mediaFile.name);
  const targetSrtRelPath = mediaDir === "." ? `${mediaBaseName}.ro.srt` : `${mediaDir}/${mediaBaseName}.ro.srt`;

  const hasEmbeddedRomanian = await hasEmbeddedRomanianSubtitle(mediaAbsPath);
  if (hasEmbeddedRomanian) {
    await logSubtitleActivity(
      torrentName,
      "already_embedded",
      "are deja subtitrare română încorporată în fișierul media — nimic de făcut",
    );
    return "already_embedded";
  }

  const srtFiles = files.filter((f) => f.name.toLowerCase().endsWith(".srt"));

  // Caz 2: exact un .srt în torrent, deja identificabil ca subtitrarea
  // filmului/episodului — doar trebuie redenumit după convenția Plex.
  if (srtFiles.length === 1) {
    const current = srtFiles[0];
    if (current.name !== targetSrtRelPath) {
      try {
        await qbitRenameFile(qbitUrl, torrentHash, current.name, targetSrtRelPath, qbitUser, qbitPass);
        console.log(`[subtitles] "${torrentName}": .srt redenumit → ${targetSrtRelPath}`);
        await logSubtitleActivity(
          torrentName,
          "renamed_srt",
          `.srt redenumit din "${current.name}" în "${targetSrtRelPath}" ca Plex să-l recunoască drept română`,
          { from: current.name, to: targetSrtRelPath },
        );
        return "renamed_srt";
      } catch (e) {
        console.warn(`[subtitles] "${torrentName}": redenumire .srt eșuată:`, e);
        await logSubtitleActivity(
          torrentName,
          "download_failed",
          `redenumirea .srt "${current.name}" → "${targetSrtRelPath}" a eșuat: ${e instanceof Error ? e.message : e}`,
        );
        return "download_failed";
      }
    }
    return "already_embedded";
  }

  // Mai multe .srt-uri — probabil deja există unul cu limba corectă marcată
  // (ex. "movie.ro.srt" alături de "movie.en.srt"); nu ne amestecăm.
  if (srtFiles.length > 1) {
    await logSubtitleActivity(
      torrentName,
      "multiple_srt_skipped",
      `conține ${srtFiles.length} fișiere .srt — sar peste, posibil deja etichetate corect pe limbi`,
    );
    return "multiple_srt_skipped";
  }

  // Caz 1: nicio subtitrare deloc — încercăm OpenSubtitles.
  if (!params.imdbId) {
    console.warn(`[subtitles] "${torrentName}": fără IMDb id, nu pot căuta pe OpenSubtitles`);
    await logSubtitleActivity(
      torrentName,
      "no_imdb",
      "fără subtitrare și fără IMDb id disponibil — nu pot căuta pe OpenSubtitles",
    );
    return "no_imdb";
  }

  const results = await searchSubtitles(params.imdbId, "ro");
  if (!results.length) {
    await logSubtitleActivity(
      torrentName,
      "no_subtitle_found",
      `niciun rezultat pe OpenSubtitles pentru IMDb ${params.imdbId}`,
      { imdb: params.imdbId },
    );
    return "no_subtitle_found";
  }

  const best = pickBestSubtitle(results, torrentName);
  if (!best) return "no_subtitle_found";

  const content = await downloadSubtitle(best.result.fileId);
  if (!content) {
    console.warn(`[subtitles] "${torrentName}": descărcare OpenSubtitles eșuată`);
    await logSubtitleActivity(
      torrentName,
      "download_failed",
      `descărcarea subtitrării de pe OpenSubtitles (release "${best.result.release}") a eșuat`,
    );
    return "download_failed";
  }

  const destPath = join(savePath, mediaDir === "." ? "" : mediaDir, `${mediaBaseName}.ro.srt`);
  try {
    await writeFile(destPath, content, "utf8");
    if (best.confident) {
      console.log(`[subtitles] "${torrentName}": subtitrare OpenSubtitles salvată → ${destPath}`);
      await logSubtitleActivity(
        torrentName,
        "downloaded_opensubtitles",
        `subtitrare descărcată de pe OpenSubtitles (release "${best.result.release}", potrivire sursă+rezoluție confirmată) → ${destPath}`,
        { release: best.result.release, path: destPath },
      );
      return "downloaded_opensubtitles";
    } else {
      console.warn(
        `[subtitles] "${torrentName}": subtitrare aproximativă salvată (fără potrivire clară de sursă/rezoluție), verifică sincronizarea → ${destPath}`,
      );
      await logSubtitleActivity(
        torrentName,
        "downloaded_opensubtitles_approximate",
        `subtitrare aproximativă descărcată de pe OpenSubtitles (release "${best.result.release}", fără potrivire clară de sursă/rezoluție) → ${destPath} — verifică sincronizarea`,
        { release: best.result.release, path: destPath },
      );
      return "downloaded_opensubtitles_approximate";
    }
  } catch (e) {
    console.warn(`[subtitles] "${torrentName}": scriere .srt eșuată:`, e);
    await logSubtitleActivity(
      torrentName,
      "download_failed",
      `scrierea subtitrării descărcate pe disk a eșuat: ${e instanceof Error ? e.message : e}`,
    );
    return "download_failed";
  }
}

async function getTorrentSavePath(
  qbitUrl: string,
  hash: string,
  user: string,
  pass: string,
): Promise<string | null> {
  try {
    const res = await qbitGet(qbitUrl, `/api/v2/torrents/info?hashes=${hash}`, user, pass);
    if (!res.ok) return null;
    const list = (await res.json()) as Array<{ save_path?: string }>;
    return list[0]?.save_path ?? null;
  } catch {
    return null;
  }
}

function pickMediaFile(files: QbitFileInfo[]): QbitFileInfo | null {
  const mediaFiles = files.filter((f) =>
    MEDIA_EXTENSIONS.includes(extname(f.name).toLowerCase()),
  );
  if (!mediaFiles.length) return null;
  return mediaFiles.reduce((a, b) => (b.size > a.size ? b : a));
}

// Verifică prin ffprobe dacă fișierul media are deja un stream de subtitrare
// în română încorporat. Dacă ffprobe nu e disponibil pe server, tratăm ca
// "necunoscut" (returnăm false) — mai bine încercăm să adăugăm un .srt în
// plus decât să lăsăm filmul fără subtitrare deloc.
async function hasEmbeddedRomanianSubtitle(mediaAbsPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "s",
        "-show_entries",
        "stream_tags=language",
        "-of",
        "csv=p=0",
        mediaAbsPath,
      ],
      { timeout: 20_000 },
    );
    const langs = stdout
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean);
    return langs.some((l) => ROMANIAN_LANG_CODES.includes(l));
  } catch {
    return false;
  }
}

const SOURCE_TAGS = [
  "WEB-DL",
  "WEBDL",
  "WEBRip",
  "BluRay",
  "BDRip",
  "BRRip",
  "HDTV",
  "AMZN",
  "NF",
  "DSNP",
  "HMAX",
  "ATVP",
];
const RESOLUTION_TAGS = ["2160p", "1080p", "720p", "480p"];

function extractTags(name: string): { resolution: string | null; source: string | null; group: string | null } {
  const resolution = RESOLUTION_TAGS.find((r) => new RegExp(r, "i").test(name)) ?? null;
  const source = SOURCE_TAGS.find((s) => new RegExp(s.replace("-", "-?"), "i").test(name)) ?? null;
  const groupMatch = name.match(/-([A-Za-z0-9]+)$/);
  const group = groupMatch ? groupMatch[1].toLowerCase() : null;
  return { resolution, source, group };
}

// Alege subtitrarea OpenSubtitles al cărei "release" se potrivește cel mai
// bine cu numele torrentului (sursă + rezoluție + grup de release) — o
// subtitrare pentru altă sursă/calitate desincronizează timpii de afișare.
function pickBestSubtitle(
  results: OpenSubtitlesResult[],
  torrentName: string,
): { result: OpenSubtitlesResult; confident: boolean } | null {
  if (!results.length) return null;

  const target = extractTags(torrentName);

  let best: OpenSubtitlesResult | null = null;
  let bestScore = -1;
  let bestConfident = false;

  for (const r of results) {
    const tags = extractTags(r.release || "");
    let score = 0;
    const resMatch = !!target.resolution && tags.resolution === target.resolution;
    const srcMatch = !!target.source && tags.source === target.source;
    if (resMatch) score += 2;
    if (srcMatch) score += 2;
    if (target.group && tags.group === target.group) score += 1;

    if (
      score > bestScore ||
      (score === bestScore && best && r.downloadCount > best.downloadCount)
    ) {
      best = r;
      bestScore = score;
      bestConfident = resMatch && srcMatch;
    }
  }

  if (!best) return null;
  return { result: best, confident: bestConfident };
}
