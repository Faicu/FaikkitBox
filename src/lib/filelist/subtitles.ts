// ---------------------------------------------------------------------------
// Asigură subtitrare română corectă la finalul unei descărcări Filelist (film
// sau, pentru pachete de episoade, fiecare episod din torrent — vezi
// processSeasonPack). Apelat din pollUntilComplete (download.ts) și din
// backfillSubtitles, înainte de refreshPlexLibrary.
//
// Pentru fiecare fișier media (filmul însuși, sau un episod dintr-un pachet),
// verificările rulează în ordine, oprindu-se la prima care se potrivește:
//  1. Are deja subtitrare română încorporată în fișier? (ffprobe) — nimic de
//     făcut.
//  2. Are deja audio nativ în română? (ffprobe pe track-ul audio, sau o
//     platformă cunoscută doar cu conținut românesc, ex. ANTP) — nu are
//     nevoie de subtitrare.
//  3. Are deja un .srt urmărit de qBittorrent? — redenumit (prin API, nu
//     direct pe disc, altfel qBittorrent pierde evidența fișierului) și/sau
//     convertit la UTF-8 dacă e cazul.
//  4. Are deja un .srt extern, descărcat de sistem într-o rulare anterioară
//     (nu urmărit de qBittorrent, deci invizibil la pasul 3)? — nu mai caută
//     din nou.
//  5. Nimic din toate astea — caută pe OpenSubtitles, apoi (dacă rezultatul
//     nu e o potrivire clară de sursă+rezoluție) și pe subs.ro, alege
//     candidatul cel mai apropiat de numele fișierului (vezi
//     pickBestByRelease) și îl descarcă.
//
// Orice eroare aici e prinsă și logată — nu trebuie să blocheze niciodată
// refresh-ul Plex care urmează.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readFile, writeFile } from "node:fs/promises";
import { join, dirname, basename, extname } from "node:path";
import iconv from "iconv-lite";
import { qbitGet, qbitListFiles, qbitRenameFile, qbitSetFilePriority, type QbitFileInfo } from "../qbit-client";
import { searchSubtitles, searchSeasonSubtitles, downloadSubtitle, type OpenSubtitlesResult } from "../opensubtitles-client";
import {
  searchSubsRo,
  downloadSubsRoZip,
  extractSrtEntriesFromZip,
  subsRoItemMatchesSeason,
} from "../subsro-client";
import { type SubtitleOutcome, CORRECTED_OUTCOMES, OK_OUTCOMES, SHORT_LABELS } from "./subtitle-outcomes";
import { lookupTitleByImdbId, searchImdbIdByReleaseName } from "../tmdb-title-lookup";

export type { SubtitleOutcome };

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

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
}

// Citește un fișier cu reîncercări scurte — imediat după un rename prin API-ul
// qBittorrent, fișierul poate să nu fie încă vizibil instant la o citire
// directă (mai ales pe montări de rețea), deși API-ul a răspuns deja cu
// succes. Fără retry, prima citire poate da ENOENT chiar dacă fișierul chiar
// există (confirmat: apare pe disc la o verificare manuală câteva secunde mai
// târziu).
async function readFileWithRetry(absPath: string, attempts = 4, delayMs = 500): Promise<Buffer> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await readFile(absPath);
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

// Verifică (și corectează, dacă e cazul) encoding-ul unui .srt deja scris pe
// disc — folosit pentru fișierele care vin cu torrentul (nu descărcate de
// noi, deci nu le controlăm bytes-ii din start). Scrierea se face direct pe
// disc, în afara API-ului qBittorrent: schimbă doar conținutul, nu calea,
// deci nu afectează evidența fișierelor din qBittorrent (spre deosebire de
// redenumire, care trebuie mereu prin API) — DAR modifică bytes-ii fișierului,
// deci nu mai corespund hash-ului piesei din .torrent. Chiar înainte de
// scriere, excludem fișierul de la download/seed în qBittorrent (`exclude`),
// ca un eventual "Force Recheck" viitor să nu-l mai re-verifice/redescarce
// (anulând conversia) și să nu-l mai oferim la seed altor peers cu bytes
// modificați (hash mismatch pentru ei). Excluderea e permanentă și
// intenționată — un .srt are dimensiune neglijabilă, nu afectează ratio-ul.
async function ensureUtf8SrtOnDisk(absPath: string, exclude: () => Promise<void>): Promise<boolean> {
  try {
    const buf = await readFileWithRetry(absPath);
    const { text, wasConverted } = decodeToUtf8Text(buf);
    if (!wasConverted) return false;
    await exclude().catch((e) =>
      console.warn(`[subtitles] Nu am putut exclude .srt de la seed în qBittorrent (${absPath}):`, e),
    );
    await writeFile(absPath, text, "utf8");
    return true;
  } catch (e) {
    console.warn(`[subtitles] Verificare/conversie UTF-8 eșuată pentru ${absPath}:`, e);
    return false;
  }
}

// Verifică dacă două fișiere din același torrent partajează cel puțin o
// piesă — dacă da, excluderea unuia singur de la seed (qbitSetFilePriority)
// nu protejează complet la un recheck, pentru că piesa comună tot e "wanted"
// prin celălalt fișier. Doar avertisment, nu blochează conversia.
function piecesOverlap(a?: [number, number], b?: [number, number]): boolean {
  if (!a || !b) return false;
  return a[0] <= b[1] && b[0] <= a[1];
}

const MEDIA_EXTENSIONS = [".mkv", ".mp4", ".avi", ".m2ts", ".ts", ".wmv", ".mov"];
const ROMANIAN_LANG_CODES = ["ro", "rum", "ron"];

// Extrage sezon+episod dintr-un nume de fișier (ex. "...S08E01..." → {8, 1}).
// Folosit atât pentru a asocia fiecare fișier media cu subtitrarea lui
// corectă într-un pachet de episoade, cât și pentru a determina sezonul
// pachetului (din primul fișier media care se potrivește).
function parseSeasonEpisode(name: string): { season: number; episode: number } | null {
  const m = name.match(/S(\d{1,3})E(\d{1,3})/i);
  if (!m) return null;
  return { season: Number(m[1]), episode: Number(m[2]) };
}

// Cheie normalizată (ex. "S08E01"), indiferent de padding-ul original.
function episodeKeyFrom(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

// Cheie normalizată pentru potrivire exactă între un fișier media și
// subtitrarea/candidatul lui.
function extractEpisodeKey(name: string): string | null {
  const se = parseSeasonEpisode(name);
  return se ? episodeKeyFrom(se.season, se.episode) : null;
}

// ---------------------------------------------------------------------------
// Helper-e comune, folosite atât pentru fluxul de film (un singur fișier
// media per torrent) cât și pentru fiecare episod dintr-un pachet de sezon
// (processSeasonPack) — evită duplicarea acelorași verificări/decizii.
// ---------------------------------------------------------------------------

interface SubtitleWinner {
  source: "opensubtitles" | "subsro";
  release: string;
  getContent: () => Promise<Buffer | null>;
}

// Alege cea mai bună subtitrare disponibilă pentru un fișier țintă: întâi
// OpenSubtitles, apoi (doar dacă OpenSubtitles n-a dat o potrivire
// "confident" de sursă+rezoluție) subs.ro. `getSubsRoCandidates` e lazy —
// apelat doar dacă chiar e nevoie, ca să nu facem căutări/descărcări subs.ro
// inutile când OpenSubtitles are deja o potrivire bună.
async function resolveBestSubtitle(
  targetName: string,
  osCandidates: OpenSubtitlesResult[],
  getSubsRoCandidates: () => Promise<Array<{ release: string; content: Buffer }>>,
): Promise<{ winner: SubtitleWinner; confident: boolean } | null> {
  let winner: SubtitleWinner | null = null;
  let winnerScore = -1;
  let winnerConfident = false;

  const osBest = pickBestByRelease(osCandidates, (r) => r.release, (r) => r.downloadCount, targetName);
  if (osBest) {
    winner = {
      source: "opensubtitles",
      release: osBest.candidate.release,
      getContent: () => downloadSubtitle(osBest.candidate.fileId),
    };
    winnerScore = osBest.score;
    winnerConfident = osBest.confident;
  }

  if (!winnerConfident) {
    const subsRoCandidates = await getSubsRoCandidates();
    const subsRoBest = pickBestByRelease(subsRoCandidates, (e) => e.release, () => 0, targetName);
    if (subsRoBest && subsRoBest.score > winnerScore) {
      const chosenContent = subsRoBest.candidate.content;
      winner = { source: "subsro", release: subsRoBest.candidate.release, getContent: async () => chosenContent };
      winnerConfident = subsRoBest.confident;
    }
  }

  if (!winner) return null;
  return { winner, confident: winnerConfident };
}

// Descarcă și scrie pe disc subtitrarea aleasă de resolveBestSubtitle,
// convertind la UTF-8 dacă e cazul.
async function downloadAndWriteSubtitle(
  winner: SubtitleWinner,
  confident: boolean,
  destPath: string,
): Promise<{ outcome: SubtitleOutcome; detail: string }> {
  const sourceLabel = winner.source === "opensubtitles" ? "OpenSubtitles" : "subs.ro";
  const content = await winner.getContent();
  if (!content) {
    console.warn(`[subtitles] descărcare ${sourceLabel} eșuată pentru release „${winner.release}"`);
    return {
      outcome: "download_failed",
      detail: `descărcarea subtitrării de pe ${sourceLabel} (release „${winner.release}") a eșuat`,
    };
  }

  try {
    const { text, wasConverted } = decodeToUtf8Text(content);
    await writeFile(destPath, text, "utf8");
    const encodingNote = wasConverted ? " (encoding convertit la UTF-8)" : "";
    if (confident) {
      console.log(`[subtitles] subtitrare ${sourceLabel} salvată → ${destPath}`);
      return {
        outcome: "downloaded_opensubtitles",
        detail: `subtitrare descărcată de pe ${sourceLabel}, release „${winner.release}" (potrivire sursă+rezoluție confirmată)${encodingNote}`,
      };
    }
    console.warn(`[subtitles] subtitrare aproximativă salvată (verifică sincronizarea) → ${destPath}`);
    return {
      outcome: "downloaded_opensubtitles_approximate",
      detail: `subtitrare aproximativă descărcată de pe ${sourceLabel}, release „${winner.release}" (fără potrivire clară de sursă/rezoluție — verifică sincronizarea)${encodingNote}`,
    };
  } catch (e) {
    console.warn(`[subtitles] scriere .srt eșuată (${destPath}):`, e);
    return {
      outcome: "download_failed",
      detail: `scrierea subtitrării descărcate pe disk a eșuat: ${e instanceof Error ? e.message : e}`,
    };
  }
}

interface TrackedSrtContext {
  qbitUrl: string;
  torrentHash: string;
  qbitUser: string;
  qbitPass: string;
  savePath: string;
}

// Redenumește (dacă e cazul, prin API-ul qBittorrent) și verifică/convertește
// la UTF-8 (dacă e cazul, excluzând fișierul de la seed) un .srt deja
// urmărit de qBittorrent, asociat cu un anume fișier media.
async function handleTrackedSrt(
  current: QbitFileInfo,
  targetSrtRelPath: string,
  mediaFilePieceRange: [number, number] | undefined,
  ctx: TrackedSrtContext,
): Promise<{ outcome: SubtitleOutcome; detail: string }> {
  const { qbitUrl, torrentHash, qbitUser, qbitPass, savePath } = ctx;
  const needsRename = current.name !== targetSrtRelPath;
  if (needsRename) {
    try {
      await qbitRenameFile(qbitUrl, torrentHash, current.name, targetSrtRelPath, qbitUser, qbitPass);
      console.log(`[subtitles] .srt redenumit → ${targetSrtRelPath}`);
    } catch (e) {
      console.warn(`[subtitles] redenumire .srt eșuată:`, e);
      return {
        outcome: "download_failed",
        detail: `redenumirea .srt a eșuat: ${e instanceof Error ? e.message : e}`,
      };
    }
  }

  const finalAbsPath = join(savePath, targetSrtRelPath);
  const wasReencoded = await ensureUtf8SrtOnDisk(finalAbsPath, () =>
    qbitSetFilePriority(qbitUrl, torrentHash, current.index, 0, qbitUser, qbitPass),
  );
  if (wasReencoded) {
    console.log(`[subtitles] .srt convertit la UTF-8 → ${targetSrtRelPath}`);
  }

  if (!needsRename && !wasReencoded) {
    return { outcome: "srt_already_ok", detail: "are deja un .srt denumit corect și codat UTF-8" };
  }

  const parts: string[] = [];
  if (needsRename) {
    parts.push(`.srt redenumit → "${basename(targetSrtRelPath)}" (Plex îl recunoaște acum ca română)`);
  }
  if (wasReencoded) {
    parts.push(
      "conținut convertit la UTF-8 (era codat altfel — diacriticele ar fi ieșit corupte în Plex); exclus de la seed în qBittorrent (dimensiune neglijabilă, evită conflicte de hash la un eventual recheck)",
    );
    if (piecesOverlap(current.piece_range, mediaFilePieceRange)) {
      parts.push(
        "risc rezidual: piesa .srt-ului e comună cu piesa fișierului video (încă seed-uit) — un recheck viitor tot ar putea re-descărca acea piesă și anula conversia",
      );
    }
  }
  return { outcome: needsRename ? "renamed_srt" : "reencoded_srt", detail: parts.join("; ") };
}

// Verifică/convertește la UTF-8 un .srt extern deja descărcat de sistem
// (nu urmărit de qBittorrent, deci invizibil pentru handleTrackedSrt) — nu
// mai caută din nou o subtitrare pentru acest fișier.
async function handleSidecarSrt(sidecarAbsPath: string): Promise<{ outcome: SubtitleOutcome; detail: string }> {
  const wasReencoded = await ensureUtf8SrtOnDisk(sidecarAbsPath, async () => {});
  return {
    outcome: "srt_already_ok",
    detail: wasReencoded
      ? "are deja un .srt extern (descărcat anterior), acum convertit la UTF-8 — netrackuit de qBittorrent, nu mai caut din nou"
      : "are deja un .srt extern (descărcat anterior sau plasat manual), denumit și codat corect — netrackuit de qBittorrent, nu mai caut din nou",
  };
}

interface EnsureRomanianSubtitleParams {
  qbitUrl: string;
  qbitUser: string;
  qbitPass: string;
  torrentHash: string;
  torrentName: string;
  imdbId?: string | null;
  // Ajută căutarea TMDB de rezervă (când imdbId lipsește) să aleagă corect
  // între /search/movie și /search/tv. Fără el, se încearcă ambele.
  mediaType?: "movie" | "tv";
}

// Rezultatul unei singure verificări/corectări — nu mai loghează nimic
// direct, doar întoarce ce s-a întâmplat. Logarea (o singură intrare per
// rulare, fie o descărcare, fie un backfill întreg) se face în logSubtitleRun.
export interface SubtitleRunItem {
  torrentName: string;
  // Titlul filmului/serialului (via TMDB, pornind de la IMDb id) — folosit
  // pentru afișare în jurnal/push, în loc de numele tehnic al lansării
  // (ex. "The.Death.of.Robin.Hood.2026.1080p.AMZN.WEB-DL..."). Cade pe
  // torrentName când nu avem IMDb id sau căutarea TMDB eșuează.
  displayTitle: string;
  outcome: SubtitleOutcome;
  detail: string;
  release?: string;
  path?: string;
}

function item(
  torrentName: string,
  displayTitle: string,
  outcome: SubtitleOutcome,
  detail: string,
  extra?: { release?: string; path?: string },
): SubtitleRunItem {
  return { torrentName, displayTitle, outcome, detail, ...extra };
}

export async function ensureRomanianSubtitle(
  params: EnsureRomanianSubtitleParams,
): Promise<SubtitleRunItem> {
  const { qbitUrl, qbitUser, qbitPass, torrentHash, torrentName } = params;

  const [files, savePath, imdbLookup] = await Promise.all([
    qbitListFiles(qbitUrl, torrentHash, qbitUser, qbitPass),
    getTorrentSavePath(qbitUrl, torrentHash, qbitUser, qbitPass),
    // Dacă avem deja IMDb id (torrent descărcat prin site), luăm doar
    // titlul. Dacă nu (torrent adăugat manual în qBittorrent), încercăm să
    // găsim IMDb id-ul căutând titlul extras din numele lansării pe TMDB —
    // altfel n-am avea cum să căutăm subtitrarea pe OpenSubtitles.
    params.imdbId
      ? lookupTitleByImdbId(params.imdbId).then((title) => ({ imdbId: params.imdbId!, title }))
      : searchImdbIdByReleaseName(torrentName, params.mediaType),
  ]);
  const imdbId: string | null = params.imdbId ?? imdbLookup?.imdbId ?? null;
  const displayTitle = imdbLookup?.title ?? torrentName;
  if (!files.length || !savePath) {
    return item(torrentName, displayTitle, "no_media_file", "nu am putut lista fișierele torrentului în qBittorrent");
  }

  // Un fișier din torrent poate avea prioritate 0 ("nu descărca") — apare în
  // listă, dar nu există fizic pe disc, deși torrentul e altfel complet.
  // Ignorăm complet astfel de fișiere, altfel un .srt "fantomă" ar da eroare
  // la citire (ENOENT) sau ar fi asociat greșit cu media descărcată.
  const downloadedFiles = files.filter((f) => Number(f.progress ?? 0) >= 1);

  const mediaFiles = downloadedFiles.filter((f) =>
    MEDIA_EXTENSIONS.includes(extname(f.name).toLowerCase()),
  );
  if (!mediaFiles.length) {
    return item(torrentName, displayTitle, "no_media_file", "niciun fișier media recunoscut în torrent");
  }
  // Torrent cu mai multe episoade ("season pack") — procesat separat, per
  // episod (fiecare fișier media asociat cu subtitrarea lui după SxxExx).
  if (mediaFiles.length > 1) {
    return processSeasonPack({
      mediaFiles,
      downloadedFiles,
      savePath,
      qbitUrl,
      torrentHash,
      qbitUser,
      qbitPass,
      torrentName,
      displayTitle,
      imdbId,
    });
  }
  const mediaFile = mediaFiles[0];

  const mediaAbsPath = join(savePath, mediaFile.name);
  const mediaBaseName = basename(mediaFile.name, extname(mediaFile.name));
  const mediaDir = dirname(mediaFile.name);
  const targetSrtRelPath = mediaDir === "." ? `${mediaBaseName}.ro.srt` : `${mediaDir}/${mediaBaseName}.ro.srt`;

  if (await hasEmbeddedRomanianSubtitle(mediaAbsPath)) {
    return item(
      torrentName,
      displayTitle,
      "already_embedded",
      "are deja subtitrare română încorporată în fișierul media — nimic de făcut",
    );
  }

  const alreadyRomanianDetail = await detectAlreadyRomanianContent(mediaAbsPath, mediaFile.name);
  if (alreadyRomanianDetail) {
    return item(torrentName, displayTitle, "audio_already_romanian", alreadyRomanianDetail);
  }

  const srtFiles = downloadedFiles.filter((f) => f.name.toLowerCase().endsWith(".srt"));

  // Caz 2: exact un .srt în torrent, deja identificabil ca subtitrarea
  // filmului — redenumit/convertit dacă e cazul.
  if (srtFiles.length === 1) {
    const { outcome, detail } = await handleTrackedSrt(srtFiles[0], targetSrtRelPath, mediaFile.piece_range, {
      qbitUrl,
      torrentHash,
      qbitUser,
      qbitPass,
      savePath,
    });
    return item(torrentName, displayTitle, outcome, detail, { path: targetSrtRelPath });
  }

  // Mai multe .srt-uri — probabil deja există unul cu limba corectă marcată
  // (ex. "movie.ro.srt" alături de "movie.en.srt"); nu ne amestecăm.
  if (srtFiles.length > 1) {
    return item(
      torrentName,
      displayTitle,
      "multiple_srt_skipped",
      `conține ${srtFiles.length} fișiere .srt — sar peste, posibil deja etichetate corect pe limbi`,
    );
  }

  // Un .srt descărcat de noi (OpenSubtitles/subs.ro) e scris direct pe disc,
  // în afara torrentului — qBittorrent nu-l "vede" niciodată ca aparținând
  // torrentului (nu era în .torrent-ul original), deci `srtFiles` de mai sus
  // (bazat strict pe evidența qBittorrent) rămâne mereu gol pentru el, chiar
  // și la rulări ulterioare. Fără verificarea asta, am redescărca aceeași
  // subtitrare la fiecare backfill. Verificăm direct pe disc, la calea exactă
  // unde am scrie noi unul nou, înainte să căutăm extern din nou.
  const sidecarAbsPath = join(savePath, targetSrtRelPath);
  if (await fileExists(sidecarAbsPath)) {
    const { outcome, detail } = await handleSidecarSrt(sidecarAbsPath);
    return item(torrentName, displayTitle, outcome, detail);
  }

  // Caz 1: nicio subtitrare deloc — încercăm OpenSubtitles, apoi (dacă
  // rezultatul nu e o potrivire "confident" de sursă+rezoluție) și subs.ro,
  // care are des exact release-ul căutat pentru lansări românești recente.
  if (!imdbId) {
    console.warn(`[subtitles] "${torrentName}": fără IMDb id, nu pot căuta subtitrare`);
    return item(
      torrentName,
      displayTitle,
      "no_imdb",
      "fără subtitrare și fără IMDb id disponibil — nu pot căuta pe OpenSubtitles/subs.ro",
    );
  }

  const osResults = await searchSubtitles(imdbId, "ro");
  const resolved = await resolveBestSubtitle(torrentName, osResults, async () => {
    // O arhivă subs.ro poate conține mai multe variante (una per
    // sursă/rezoluție), fiecare tratată ca un candidat separat, scorat la fel.
    const subsRoItems = await searchSubsRo(imdbId, "ro");
    const zipEntries: Array<{ release: string; content: Buffer }> = [];
    for (const it of subsRoItems.slice(0, 3)) {
      const zipBuf = await downloadSubsRoZip(it.id);
      if (zipBuf) zipEntries.push(...extractSrtEntriesFromZip(zipBuf));
    }
    return zipEntries;
  });

  if (!resolved) {
    return item(
      torrentName,
      displayTitle,
      "no_subtitle_found",
      `niciun rezultat pe OpenSubtitles sau subs.ro pentru IMDb ${imdbId}`,
    );
  }

  const destPath = join(savePath, mediaDir === "." ? "" : mediaDir, `${mediaBaseName}.ro.srt`);
  const { outcome, detail } = await downloadAndWriteSubtitle(resolved.winner, resolved.confident, destPath);
  return item(torrentName, displayTitle, outcome, detail, { release: resolved.winner.release, path: destPath });
}

// ---------------------------------------------------------------------------
// Pachet de episoade (season pack) — fiecare fișier media procesat separat,
// asociat cu subtitrarea lui după cheia SxxExx. Rezultatele OpenSubtitles
// (căutare pe tot sezonul, un singur apel) și subs.ro (căutare + arhive,
// preluate lazy — doar dacă chiar e nevoie) sunt partajate între toate
// episoadele din același torrent, nu re-cerute per episod. Agregă totul
// într-un singur SubtitleRunItem, cu detaliu per episod în `detail`.
// ---------------------------------------------------------------------------

interface ProcessSeasonPackParams {
  mediaFiles: QbitFileInfo[];
  downloadedFiles: QbitFileInfo[];
  savePath: string;
  qbitUrl: string;
  torrentHash: string;
  qbitUser: string;
  qbitPass: string;
  torrentName: string;
  displayTitle: string;
  imdbId: string | null;
}

async function processSeasonPack(params: ProcessSeasonPackParams): Promise<SubtitleRunItem> {
  const {
    mediaFiles,
    downloadedFiles,
    savePath,
    qbitUrl,
    torrentHash,
    qbitUser,
    qbitPass,
    torrentName,
    displayTitle,
    imdbId,
  } = params;

  const seasonNumber = mediaFiles.map((f) => parseSeasonEpisode(f.name)?.season).find((s) => s != null) ?? null;

  if (!imdbId || seasonNumber == null) {
    return item(
      torrentName,
      displayTitle,
      "season_pack_skipped",
      `pachet cu ${mediaFiles.length} fișiere media — ${
        !imdbId ? "fără IMDb id" : "nu am putut determina sezonul din numele fișierelor"
      }, nu pot căuta subtitrări per episod`,
    );
  }

  // OpenSubtitles pentru tot sezonul — un singur apel, dar lazy: doar dacă
  // vreun episod chiar ajunge la pasul de căutare externă (nu are rost dacă
  // toate episoadele au deja embedded/tracked/sidecar rezolvate).
  let osSeasonResults: OpenSubtitlesResult[] | null = null;
  async function getOsSeasonResults(): Promise<OpenSubtitlesResult[]> {
    if (!osSeasonResults) osSeasonResults = await searchSeasonSubtitles(imdbId!, seasonNumber!, "ro");
    return osSeasonResults;
  }

  // subs.ro — la fel, lazy, doar dacă vreun episod chiar are nevoie (nicio
  // potrivire "confident" în OpenSubtitles pentru el). Un sezon în
  // desfășurare apare adesea ca mai multe pachete PARȚIALE, publicate pe
  // măsură ce ies episoadele (ex. "Episoadele 1-4", apoi separat "Episoadele
  // 5-8"), toate potrivind același "Sezonul N" din descriere — de asta
  // descărcăm TOATE pachetele sezonului găsite (până la un plafon generos),
  // nu doar primele 1-2, altfel am rata episoadele dintr-un pachet mai vechi.
  // Rezultatele din toate pachetele sunt puse laolaltă și filtrate per
  // episod mai jos — un episod care nu apare în niciunul rămâne fără
  // subtitrare de pe subs.ro (raportat explicit, nu blochează restul).
  let subsRoEntries: Array<{ release: string; content: Buffer }> | null = null;
  async function getSubsRoEntries(): Promise<Array<{ release: string; content: Buffer }>> {
    if (subsRoEntries) return subsRoEntries;
    subsRoEntries = [];
    const items = await searchSubsRo(imdbId!, "ro");
    const seasonItems = items.filter((it) => subsRoItemMatchesSeason(it, seasonNumber!));
    for (const it of seasonItems.slice(0, 6)) {
      const zipBuf = await downloadSubsRoZip(it.id);
      if (zipBuf) subsRoEntries.push(...extractSrtEntriesFromZip(zipBuf));
    }
    return subsRoEntries;
  }

  interface EpisodeResult {
    episodeKey: string;
    outcome: SubtitleOutcome;
    detail: string;
  }
  const episodeResults: EpisodeResult[] = [];

  for (const mediaFile of mediaFiles) {
    const episodeKey = extractEpisodeKey(mediaFile.name);
    if (!episodeKey) {
      episodeResults.push({
        episodeKey: basename(mediaFile.name, extname(mediaFile.name)),
        outcome: "no_subtitle_found",
        detail: "nu am putut determina numărul episodului din numele fișierului",
      });
      continue;
    }

    const mediaAbsPath = join(savePath, mediaFile.name);
    const mediaBaseName = basename(mediaFile.name, extname(mediaFile.name));
    const mediaDir = dirname(mediaFile.name);
    const targetSrtRelPath = mediaDir === "." ? `${mediaBaseName}.ro.srt` : `${mediaDir}/${mediaBaseName}.ro.srt`;

    if (await hasEmbeddedRomanianSubtitle(mediaAbsPath)) {
      episodeResults.push({
        episodeKey,
        outcome: "already_embedded",
        detail: "are deja subtitrare română încorporată",
      });
      continue;
    }

    const alreadyRomanianDetail = await detectAlreadyRomanianContent(mediaAbsPath, mediaFile.name);
    if (alreadyRomanianDetail) {
      episodeResults.push({ episodeKey, outcome: "audio_already_romanian", detail: alreadyRomanianDetail });
      continue;
    }

    const episodeSrtFiles = downloadedFiles.filter(
      (f) => f.name.toLowerCase().endsWith(".srt") && extractEpisodeKey(f.name) === episodeKey,
    );

    if (episodeSrtFiles.length === 1) {
      const { outcome, detail } = await handleTrackedSrt(episodeSrtFiles[0], targetSrtRelPath, mediaFile.piece_range, {
        qbitUrl,
        torrentHash,
        qbitUser,
        qbitPass,
        savePath,
      });
      episodeResults.push({ episodeKey, outcome, detail });
      continue;
    }

    if (episodeSrtFiles.length > 1) {
      episodeResults.push({
        episodeKey,
        outcome: "multiple_srt_skipped",
        detail: `${episodeSrtFiles.length} fișiere .srt găsite pentru acest episod — sar peste`,
      });
      continue;
    }

    // .srt extern descărcat anterior (nu urmărit de qBittorrent) — la fel ca
    // la filme, verificăm direct pe disc înainte să căutăm din nou.
    const sidecarAbsPath = join(savePath, targetSrtRelPath);
    if (await fileExists(sidecarAbsPath)) {
      const { outcome, detail } = await handleSidecarSrt(sidecarAbsPath);
      episodeResults.push({ episodeKey, outcome, detail });
      continue;
    }

    // Căutare externă — OpenSubtitles (tot sezonul, preluat lazy) filtrat la
    // acest episod, apoi subs.ro (lazy) dacă nu avem o potrivire clară.
    const osSeasonForEpisode = (await getOsSeasonResults()).filter((r) => {
      if (r.seasonNumber == null || r.episodeNumber == null) return extractEpisodeKey(r.release) === episodeKey;
      return episodeKeyFrom(r.seasonNumber, r.episodeNumber) === episodeKey;
    });

    const resolved = await resolveBestSubtitle(mediaFile.name, osSeasonForEpisode, async () => {
      const allSubsRo = await getSubsRoEntries();
      return allSubsRo.filter((e) => extractEpisodeKey(e.release) === episodeKey);
    });

    if (!resolved) {
      episodeResults.push({ episodeKey, outcome: "no_subtitle_found", detail: "nicio subtitrare găsită" });
      continue;
    }

    const destPath = join(savePath, mediaDir === "." ? "" : mediaDir, `${mediaBaseName}.ro.srt`);
    const { outcome, detail } = await downloadAndWriteSubtitle(resolved.winner, resolved.confident, destPath);
    episodeResults.push({ episodeKey, outcome, detail });
  }

  const corrected = episodeResults.filter((r) => CORRECTED_OUTCOMES.includes(r.outcome)).length;
  const ok = episodeResults.filter((r) => OK_OUTCOMES.includes(r.outcome)).length;
  const failed = episodeResults.length - corrected - ok;

  const summary = `${episodeResults.length} episoade — ${corrected} corectate, ${ok} deja ok, ${failed} fără subtitrare`;
  const perEpisode = episodeResults
    .sort((a, b) => a.episodeKey.localeCompare(b.episodeKey))
    .map((r) => `${r.episodeKey}: ${r.detail}`)
    .join("; ");

  const outcome: SubtitleOutcome = corrected > 0 ? "season_corrected" : failed > 0 ? "season_no_subtitle_found" : "season_already_ok";
  return item(torrentName, displayTitle, outcome, `${summary} — ${perEpisode}`);
}

// ---------------------------------------------------------------------------
// Logging: o singură intrare de activitate per rulare (o descărcare sau un
// backfill întreg), cu lista per-torrent atașată în meta.items pentru
// afișarea de detalii la click în UI.
// ---------------------------------------------------------------------------

export type SubtitleRunTrigger = "download" | "backfill";

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
      ? `${items[0].displayTitle}: ${SHORT_LABELS[items[0].outcome]}`
      : `Backfill subtitrări: ${items.length} verificate — ${corrected} corectate, ${ok} deja ok, ${rest} sărite/eșuate`;

  // La o descărcare unică, dacă n-a fost nevoie de nicio intervenție
  // (subtitrare deja încorporată sau .srt deja corect) nu trimitem push —
  // rămâne vizibil în jurnal, dar nu mai e nimic nou de anunțat. La backfill
  // trimitem mereu, rezumatul e util indiferent de rezultat.
  const skipPush = trigger === "download" && OK_OUTCOMES.includes(items[0].outcome);

  try {
    const { logActivity } = await import("../activity-log");
    await logActivity(
      "subtitle_fix",
      message,
      {
        trigger,
        total: items.length,
        corrected,
        ok,
        rest,
        byOutcome: Object.entries(byOutcome).map(([outcome, count]) => ({ outcome, count })),
        items: items.map((it) => ({
          torrentName: it.torrentName,
          displayTitle: it.displayTitle,
          outcome: it.outcome,
          detail: it.detail,
          release: it.release,
          path: it.path,
        })),
      },
      { skipPush },
    );
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

// Verifică prin ffprobe dacă track-ul audio principal e deja în română —
// conținut nativ românesc (emisiuni TV, producții locale) n-are nevoie de
// nicio subtitrare. Aceeași limitare ca la subtitrare: dacă ffprobe lipsește
// sau fișierul n-are deloc tag de limbă pe track-ul audio, tratăm ca
// "necunoscut" (returnăm false) — apelantul mai are șansa heuristicii de
// platformă (knownRomanianOnlySourceTag) înainte să caute extern.
async function hasRomanianAudio(mediaAbsPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "a",
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

// Platforme/surse cunoscute care oferă exclusiv conținut audio nativ în
// română (emisiuni TV românești) — indiciu de rezervă când ffprobe nu poate
// confirma limba audio (fișier fără tag de limbă setat pe track, frecvent la
// rip-uri TV). Listă mică, extensibilă — adaugă alte platforme aici dacă
// apar cazuri similare.
const ROMANIAN_ONLY_PLATFORM_TAGS = ["ANTP"]; // Antena Play

function knownRomanianOnlySourceTag(mediaFileName: string): string | null {
  return ROMANIAN_ONLY_PLATFORM_TAGS.find((tag) => findTag(mediaFileName, [tag]) === tag) ?? null;
}

// Verifică (audio ffprobe, apoi heuristica de platformă) dacă fișierul e deja
// conținut românesc, care nu are nevoie de nicio subtitrare — evită erori
// "fără IMDb id" pentru emisiuni TV locale (fără prezență pe IMDb) și evită
// să căutăm inutil o subtitrare pentru ceva deja în română.
async function detectAlreadyRomanianContent(
  mediaAbsPath: string,
  mediaFileName: string,
): Promise<string | null> {
  if (await hasRomanianAudio(mediaAbsPath)) {
    return "conținutul audio e deja în română (detectat prin ffprobe) — nu necesită subtitrare";
  }
  const platformTag = knownRomanianOnlySourceTag(mediaFileName);
  if (platformTag) {
    return `sursă cunoscută cu conținut exclusiv românesc (${platformTag}) — presupun audio deja în română, nu caut subtitrare`;
  }
  return null;
}

const RESOLUTION_TAGS = ["2160p", "1080p", "720p", "480p"];
// Modul de obținere a materialului (rip/encode), distinct de platforma de
// streaming — un torrent "HULU.WEB-DL" și unul "AMZN.WEB-DL" au același mod
// de obținere, dar sunt surse diferite; înainte erau amestecate într-o
// singură listă, ceea ce făcea ca platforma să fie complet ignorată.
const ACQUISITION_TAGS = ["WEB-DL", "WEBDL", "WEBRip", "BluRay", "BDRip", "BRRip", "HDTV", "DVDRip", "REMUX"];
// Platforma/serviciul de streaming de unde provine fișierul — la fel de
// importantă ca modul de obținere pentru sincronizare (rip-uri diferite de
// pe platforme diferite au adesea tăieturi/intro diferite).
const PLATFORM_TAGS = [
  "AMZN",
  "NF",
  "DSNP",
  "HMAX",
  "MAX",
  "ATVP",
  "HULU",
  "PCOK",
  "STAN",
  "iT",
  "MA",
  "SHO",
  "CRAV",
];
const CODEC_TAGS = ["H264", "x264", "H265", "x265", "HEVC", "AV1", "XviD", "DivX"];

// Caută un tag dintr-o listă ca token delimitat (punct/underscore/cratimă/
// spațiu la ambele capete, sau începutul/sfârșitul numelui) — evită
// potriviri false pe substring (ex. "MA" în interiorul altui cuvânt).
// Cratima internă a unor tag-uri (ex. "WEB-DL") e opțională, ca să prindă și
// varianta fără cratimă ("WEBDL"), deja listată separat oricum.
function findTag(name: string, tags: string[]): string | null {
  for (const tag of tags) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/-/g, "-?");
    const re = new RegExp(`(?:^|[.\\s_-])${escaped}(?:[.\\s_-]|$)`, "i");
    if (re.test(name)) return tag;
  }
  return null;
}

interface ReleaseTags {
  resolution: string | null;
  acquisition: string | null;
  platform: string | null;
  codec: string | null;
  group: string | null;
}

function extractTags(name: string): ReleaseTags {
  const resolution = findTag(name, RESOLUTION_TAGS);
  const acquisition = findTag(name, ACQUISITION_TAGS);
  const platform = findTag(name, PLATFORM_TAGS);
  const codec = findTag(name, CODEC_TAGS);
  const groupMatch = name.match(/-([A-Za-z0-9]+)$/);
  const group = groupMatch ? groupMatch[1].toLowerCase() : null;
  return { resolution, acquisition, platform, codec, group };
}

export interface ScoredRelease<T> {
  candidate: T;
  score: number;
  confident: boolean;
}

// Alege, dintr-o listă de candidați (rezultate OpenSubtitles, variante dintr-o
// arhivă subs.ro etc.), pe cel al cărui nume de release se potrivește cel mai
// bine cu numele fișierului media — rezoluție, mod de obținere (WEB-DL/
// BluRay/...), platformă (HULU/AMZN/...), codec și grup de release — ca
// subtitrarea aleasă să fie identică sau cât mai apropiată de fișier, nu doar
// "compatibilă" (o subtitrare pentru altă sursă/calitate desincronizează
// timpii de afișare). Generic — folosit atât pentru OpenSubtitles cât și
// pentru subs.ro, ca scorul unui candidat de la o sursă să poată fi comparat
// direct cu scorul unui candidat de la cealaltă sursă.
//
// "confident" rămâne definit strict pe rezoluție+mod de obținere (cele mai
// relevante pentru sincronizare); platformă/codec/grup contează doar pentru
// alegerea între mai mulți candidați deja compatibili, ca să câștige cel mai
// apropiat de numele exact al fișierului.
function pickBestByRelease<T>(
  candidates: T[],
  releaseOf: (c: T) => string,
  popularityOf: (c: T) => number,
  targetName: string,
): ScoredRelease<T> | null {
  if (!candidates.length) return null;

  const target = extractTags(targetName);

  let best: T | null = null;
  let bestScore = -1;
  let bestConfident = false;
  let bestPopularity = -Infinity;

  for (const c of candidates) {
    const tags = extractTags(releaseOf(c) || "");
    let score = 0;
    const resMatch = !!target.resolution && tags.resolution === target.resolution;
    const acqMatch = !!target.acquisition && tags.acquisition === target.acquisition;
    const platformMatch = !!target.platform && tags.platform === target.platform;
    const codecMatch = !!target.codec && tags.codec === target.codec;
    const groupMatch = !!target.group && tags.group === target.group;
    if (resMatch) score += 3;
    if (acqMatch) score += 2;
    if (platformMatch) score += 2;
    if (codecMatch) score += 1;
    if (groupMatch) score += 2;

    const popularity = popularityOf(c);
    if (score > bestScore || (score === bestScore && popularity > bestPopularity)) {
      best = c;
      bestScore = score;
      bestConfident = resMatch && acqMatch;
      bestPopularity = popularity;
    }
  }

  if (!best) return null;
  return { candidate: best, score: bestScore, confident: bestConfident };
}
