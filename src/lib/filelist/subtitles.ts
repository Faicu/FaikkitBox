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
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname, basename, extname } from "node:path";
import iconv from "iconv-lite";
import { qbitGet, qbitListFiles, qbitRenameFile, type QbitFileInfo } from "../qbit-client";
import { searchSubtitles, downloadSubtitle, type OpenSubtitlesResult } from "../opensubtitles-client";

const execFileAsync = promisify(execFile);

// Plex citește .srt-urile externe ca UTF-8, fără detecție de encoding —
// subtitrările românești vechi (mai ales cele care vin direct în torrent,
// nu de pe OpenSubtitles) sunt frecvent Windows-1250, ceea ce corupe
// diacriticele în Plex. Verificăm strict dacă bytes-ii sunt deja UTF-8
// valid; dacă nu, presupunem Windows-1250 (cea mai comună codare pentru
// subtitrări românești salvate din Notepad pe Windows) și convertim.
const FALLBACK_ENCODING = "windows-1250";

function isValidUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

function decodeToUtf8Text(buf: Buffer): { text: string; wasConverted: boolean } {
  if (isValidUtf8(buf)) return { text: buf.toString("utf8"), wasConverted: false };
  return { text: iconv.decode(buf, FALLBACK_ENCODING), wasConverted: true };
}

// Verifică (și corectează, dacă e cazul) encoding-ul unui .srt deja scris pe
// disc — folosit pentru fișierele care vin cu torrentul (nu descărcate de
// noi, deci nu le controlăm bytes-ii din start). Scrierea se face direct pe
// disc, în afara API-ului qBittorrent: schimbă doar conținutul, nu calea,
// deci nu afectează evidența fișierelor din qBittorrent (spre deosebire de
// redenumire, care trebuie mereu prin API).
async function ensureUtf8SrtOnDisk(absPath: string): Promise<boolean> {
  try {
    const buf = await readFile(absPath);
    const { text, wasConverted } = decodeToUtf8Text(buf);
    if (!wasConverted) return false;
    await writeFile(absPath, text, "utf8");
    return true;
  } catch (e) {
    console.warn(`[subtitles] Verificare/conversie UTF-8 eșuată pentru ${absPath}:`, e);
    return false;
  }
}

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
  | "reencoded_srt"
  | "downloaded_opensubtitles"
  | "downloaded_opensubtitles_approximate"
  | "multiple_srt_skipped"
  | "no_imdb"
  | "no_subtitle_found"
  | "download_failed"
  | "no_media_file";

// Rezultatul unei singure verificări/corectări — nu mai loghează nimic
// direct, doar întoarce ce s-a întâmplat. Logarea (o singură intrare per
// rulare, fie o descărcare, fie un backfill întreg) se face în logSubtitleRun.
export interface SubtitleRunItem {
  torrentName: string;
  outcome: SubtitleOutcome;
  detail: string;
  release?: string;
  path?: string;
}

function item(
  torrentName: string,
  outcome: SubtitleOutcome,
  detail: string,
  extra?: { release?: string; path?: string },
): SubtitleRunItem {
  return { torrentName, outcome, detail, ...extra };
}

export async function ensureRomanianSubtitle(
  params: EnsureRomanianSubtitleParams,
): Promise<SubtitleRunItem> {
  const { qbitUrl, qbitUser, qbitPass, torrentHash, torrentName } = params;

  const [files, savePath] = await Promise.all([
    qbitListFiles(qbitUrl, torrentHash, qbitUser, qbitPass),
    getTorrentSavePath(qbitUrl, torrentHash, qbitUser, qbitPass),
  ]);
  if (!files.length || !savePath) {
    return item(torrentName, "no_media_file", "nu am putut lista fișierele torrentului în qBittorrent");
  }

  const mediaFile = pickMediaFile(files);
  if (!mediaFile) {
    return item(torrentName, "no_media_file", "niciun fișier media recunoscut în torrent");
  }

  const mediaAbsPath = join(savePath, mediaFile.name);
  const mediaBaseName = basename(mediaFile.name, extname(mediaFile.name));
  const mediaDir = dirname(mediaFile.name);
  const targetSrtRelPath = mediaDir === "." ? `${mediaBaseName}.ro.srt` : `${mediaDir}/${mediaBaseName}.ro.srt`;

  const hasEmbeddedRomanian = await hasEmbeddedRomanianSubtitle(mediaAbsPath);
  if (hasEmbeddedRomanian) {
    return item(
      torrentName,
      "already_embedded",
      "are deja subtitrare română încorporată în fișierul media — nimic de făcut",
    );
  }

  const srtFiles = files.filter((f) => f.name.toLowerCase().endsWith(".srt"));

  // Caz 2: exact un .srt în torrent, deja identificabil ca subtitrarea
  // filmului/episodului — trebuie redenumit după convenția Plex (dacă e
  // cazul) și verificat/convertit la UTF-8 (dacă e cazul) — altfel Plex
  // afișează diacriticele corupte, indiferent dacă numele e corect.
  if (srtFiles.length === 1) {
    const current = srtFiles[0];
    const needsRename = current.name !== targetSrtRelPath;
    if (needsRename) {
      try {
        await qbitRenameFile(qbitUrl, torrentHash, current.name, targetSrtRelPath, qbitUser, qbitPass);
        console.log(`[subtitles] "${torrentName}": .srt redenumit → ${targetSrtRelPath}`);
      } catch (e) {
        console.warn(`[subtitles] "${torrentName}": redenumire .srt eșuată:`, e);
        return item(
          torrentName,
          "download_failed",
          `redenumirea .srt "${current.name}" → "${targetSrtRelPath}" a eșuat: ${e instanceof Error ? e.message : e}`,
        );
      }
    }

    const finalAbsPath = join(savePath, targetSrtRelPath);
    const wasReencoded = await ensureUtf8SrtOnDisk(finalAbsPath);
    if (wasReencoded) {
      console.log(`[subtitles] "${torrentName}": .srt convertit la UTF-8 → ${targetSrtRelPath}`);
    }

    if (!needsRename && !wasReencoded) {
      return item(torrentName, "already_embedded", "are deja un .srt denumit corect și codat UTF-8");
    }

    const parts: string[] = [];
    if (needsRename) {
      parts.push(`.srt redenumit din "${current.name}" în "${targetSrtRelPath}" ca Plex să-l recunoască drept română`);
    }
    if (wasReencoded) {
      parts.push(
        "conținutul a fost convertit la UTF-8 (era codat altfel — diacriticele ar fi apărut corupte în Plex)",
      );
    }
    return item(torrentName, needsRename ? "renamed_srt" : "reencoded_srt", parts.join("; "), {
      path: targetSrtRelPath,
    });
  }

  // Mai multe .srt-uri — probabil deja există unul cu limba corectă marcată
  // (ex. "movie.ro.srt" alături de "movie.en.srt"); nu ne amestecăm.
  if (srtFiles.length > 1) {
    return item(
      torrentName,
      "multiple_srt_skipped",
      `conține ${srtFiles.length} fișiere .srt — sar peste, posibil deja etichetate corect pe limbi`,
    );
  }

  // Caz 1: nicio subtitrare deloc — încercăm OpenSubtitles.
  if (!params.imdbId) {
    console.warn(`[subtitles] "${torrentName}": fără IMDb id, nu pot căuta pe OpenSubtitles`);
    return item(
      torrentName,
      "no_imdb",
      "fără subtitrare și fără IMDb id disponibil — nu pot căuta pe OpenSubtitles",
    );
  }

  const results = await searchSubtitles(params.imdbId, "ro");
  if (!results.length) {
    return item(
      torrentName,
      "no_subtitle_found",
      `niciun rezultat pe OpenSubtitles pentru IMDb ${params.imdbId}`,
    );
  }

  const best = pickBestSubtitle(results, torrentName);
  if (!best) {
    return item(torrentName, "no_subtitle_found", "niciun rezultat OpenSubtitles utilizabil");
  }

  const content = await downloadSubtitle(best.result.fileId);
  if (!content) {
    console.warn(`[subtitles] "${torrentName}": descărcare OpenSubtitles eșuată`);
    return item(
      torrentName,
      "download_failed",
      `descărcarea subtitrării de pe OpenSubtitles (release "${best.result.release}") a eșuat`,
    );
  }

  const destPath = join(savePath, mediaDir === "." ? "" : mediaDir, `${mediaBaseName}.ro.srt`);
  try {
    const { text, wasConverted } = decodeToUtf8Text(content);
    await writeFile(destPath, text, "utf8");
    const encodingNote = wasConverted
      ? " (conținutul original nu era UTF-8, a fost convertit — altfel diacriticele apăreau corupte în Plex)"
      : "";
    if (best.confident) {
      console.log(`[subtitles] "${torrentName}": subtitrare OpenSubtitles salvată → ${destPath}`);
      return item(
        torrentName,
        "downloaded_opensubtitles",
        `subtitrare descărcată de pe OpenSubtitles (release "${best.result.release}", potrivire sursă+rezoluție confirmată) → ${destPath}${encodingNote}`,
        { release: best.result.release, path: destPath },
      );
    } else {
      console.warn(
        `[subtitles] "${torrentName}": subtitrare aproximativă salvată (fără potrivire clară de sursă/rezoluție), verifică sincronizarea → ${destPath}`,
      );
      return item(
        torrentName,
        "downloaded_opensubtitles_approximate",
        `subtitrare aproximativă descărcată de pe OpenSubtitles (release "${best.result.release}", fără potrivire clară de sursă/rezoluție) → ${destPath} — verifică sincronizarea${encodingNote}`,
        { release: best.result.release, path: destPath },
      );
    }
  } catch (e) {
    console.warn(`[subtitles] "${torrentName}": scriere .srt eșuată:`, e);
    return item(
      torrentName,
      "download_failed",
      `scrierea subtitrării descărcate pe disk a eșuat: ${e instanceof Error ? e.message : e}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Logging: o singură intrare de activitate per rulare (o descărcare sau un
// backfill întreg), cu lista per-torrent atașată în meta.items pentru
// afișarea de detalii la click în UI.
// ---------------------------------------------------------------------------

export type SubtitleRunTrigger = "download" | "backfill";

// Outcome-uri care au schimbat efectiv ceva pe disk — folosit și de
// backfillSubtitles (download.ts) ca să știe pentru ce categorii (filme/
// seriale) trebuie declanșat refresh Plex.
export const CORRECTED_OUTCOMES: SubtitleOutcome[] = [
  "renamed_srt",
  "reencoded_srt",
  "downloaded_opensubtitles",
  "downloaded_opensubtitles_approximate",
];
const OK_OUTCOMES: SubtitleOutcome[] = ["already_embedded"];

export async function logSubtitleRun(
  items: SubtitleRunItem[],
  trigger: SubtitleRunTrigger,
): Promise<void> {
  if (!items.length) return;

  const byOutcome: Record<string, number> = {};
  for (const it of items) byOutcome[it.outcome] = (byOutcome[it.outcome] ?? 0) + 1;

  const corrected = items.filter((it) => CORRECTED_OUTCOMES.includes(it.outcome)).length;
  const ok = items.filter((it) => OK_OUTCOMES.includes(it.outcome)).length;
  const rest = items.length - corrected - ok;

  const message =
    trigger === "download"
      ? `${items[0].torrentName}: ${items[0].detail}`
      : `Backfill subtitrări: ${items.length} verificate — ${corrected} corectate, ${ok} deja ok, ${rest} sărite/eșuate`;

  try {
    const { logActivity } = await import("../activity-log");
    await logActivity("subtitle_fix", message, {
      trigger,
      total: items.length,
      corrected,
      ok,
      rest,
      byOutcome: Object.entries(byOutcome).map(([outcome, count]) => ({ outcome, count })),
      items: items.map((it) => ({
        torrentName: it.torrentName,
        outcome: it.outcome,
        detail: it.detail,
        release: it.release,
        path: it.path,
      })),
    });
  } catch (e) {
    console.warn("[subtitles] Nu am putut loga rezumatul rulării:", e);
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
