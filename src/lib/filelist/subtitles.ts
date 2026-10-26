// ---------------------------------------------------------------------------
// Subtitrarea română la finalul unei descărcări (film, sau fiecare episod
// dintr-un pachet) și la „Corectează subtitrare”, înainte de refresh-ul Plex.
// Aici doar orchestrarea; pașii per fișier sunt în subtitle-pipeline.ts:
// verificări (subtitle-checks), surse (subtitle-sources: OpenSubtitles,
// subs.ro), codare (subtitle-encoding), scriere (subtitle-apply).
//
// Orice eroare e prinsă — nu trebuie să blocheze refresh-ul Plex.
// ---------------------------------------------------------------------------

import { readdir, unlink } from "node:fs/promises";
import { join, dirname, basename, extname } from "node:path";
import { qbitGet, qbitListFiles, type QbitFileInfo } from "../qbit-client";
import {
  searchSubtitles,
  searchEpisodeSubtitles,
  searchSeasonSubtitles,
  type OpenSubtitlesResult,
} from "./opensubtitles-client";
import {
  searchSubsRo,
  downloadSubsRoZip,
  extractSrtEntries,
  subsRoItemMatchesSeason,
  type SubsRoSrtEntry,
} from "./subsro-client";
import {
  type SubtitleOutcome,
  CORRECTED_OUTCOMES,
  OK_OUTCOMES,
  shortLabelFor,
  type SubtitleSource,
  type SubtitleSync,
  type SubtitleFileReport,
  type SubtitleRejectionReport,
} from "./subtitle-outcomes";
import { lookupTitleByImdbId, searchImdbIdByReleaseName } from "../tmdb/tmdb-title-lookup";
import { MEDIA_EXTENSIONS, parseSeasonEpisode, extractEpisodeKey } from "./subtitle-checks";
import { processMediaFile, type ProcessMediaFileResult } from "./subtitle-pipeline";

// Rezultatul unui fișier media, ca rapoarte pentru jurnalul structurat.
function reportsOf(
  torrent: string,
  episode: string | null,
  r: ProcessMediaFileResult,
): { file: SubtitleFileReport; rejected: SubtitleRejectionReport[] } {
  return {
    file: {
      torrent,
      episode,
      outcome: r.outcome,
      source: r.source ?? null,
      release: r.release ?? null,
      matchedCriteria: r.matchedCriteria ?? null,
      maxCriteria: r.maxCriteria ?? null,
      syncScore: r.sync?.score ?? null,
      syncOffset: r.sync?.offset ?? null,
      syncGood: r.sync?.good ?? null,
      compared: r.compared ?? null,
      movedAside: r.movedAside ?? null,
      replacedApproximate: r.replacedApproximate ?? false,
    },
    rejected: (r.rejected ?? []).map((v) => ({ torrent, episode, ...v })),
  };
}

export type { SubtitleOutcome };

interface EnsureRomanianSubtitleParams {
  qbitUrl: string;
  qbitUser: string;
  qbitPass: string;
  torrentHash: string;
  torrentName: string;
  imdbId?: string | null;
  // Ajută căutarea TMDB de rezervă (fără imdbId) să aleagă film sau serial.
  mediaType?: "movie" | "tv";
  // Caută o variantă mai bună pentru o subtitrare „aproximativă” deja pusă.
  upgradeApproximate?: boolean;
  // La un pachet: doar episoadele aproximative se reverifică — cele exacte nu
  // consumă din limita OpenSubtitles. Lipsă = toate.
  approximateEpisodes?: ReadonlySet<string>;
}

// Rezultatul unei verificări — fără logare; logSubtitleRun scrie o singură
// intrare per rulare.
export interface SubtitleRunItem {
  torrentName: string;
  // Titlul (TMDB, din IMDb id) pentru jurnal și push, în locul numelui tehnic
  // al lansării; altfel torrentName.
  displayTitle: string;
  outcome: SubtitleOutcome;
  detail: string;
  release?: string;
  path?: string;
  // Câte criterii (rezoluție, sursă, platformă, codec, grup) s-au potrivit din
  // cele identificabile — doar când s-a descărcat o subtitrare.
  matchedCriteria?: number;
  maxCriteria?: number;
  // De unde a venit subtitrarea — doar la descărcări.
  source?: SubtitleSource;
  // Sincronizarea măsurată față de subtitrarea încorporată, când există.
  sync?: SubtitleSync;
  // Jurnalul structurat: un raport per fișier și variantele respinse.
  files?: SubtitleFileReport[];
  rejected?: SubtitleRejectionReport[];
  // La un pachet: detaliul fiecărui episod, scris pe rândul lui în `media`.
  episodeDetails?: Record<string, string>;
}

function item(
  torrentName: string,
  displayTitle: string,
  outcome: SubtitleOutcome,
  detail: string,
  extra?: {
    release?: string;
    path?: string;
    matchedCriteria?: number;
    maxCriteria?: number;
    source?: SubtitleSource;
    sync?: SubtitleSync;
    files?: SubtitleFileReport[];
    rejected?: SubtitleRejectionReport[];
    episodeDetails?: Record<string, string>;
  },
): SubtitleRunItem {
  return { torrentName, displayTitle, outcome, detail, ...extra };
}

export async function ensureRomanianSubtitle(
  params: EnsureRomanianSubtitleParams,
): Promise<SubtitleRunItem> {
  const { qbitUrl, qbitUser, qbitPass, torrentHash, torrentName } = params;

  const [files, savePath, imdbLookup] = await Promise.all([
    // O eroare la listare (torrent șters manual) se tratează ca listă goală.
    qbitListFiles(qbitUrl, torrentHash, qbitUser, qbitPass).catch(() => []),
    getTorrentSavePath(qbitUrl, torrentHash, qbitUser, qbitPass),
    // Fără IMDb id (torrent adăugat direct în qBittorrent) îl căutăm pe TMDB
    // după titlul din numele lansării — altfel n-am avea cum căuta pe
    // OpenSubtitles.
    params.imdbId
      ? lookupTitleByImdbId(params.imdbId).then((title) => ({ imdbId: params.imdbId!, title }))
      : searchImdbIdByReleaseName(torrentName, params.mediaType),
  ]);
  const imdbId: string | null = params.imdbId ?? imdbLookup?.imdbId ?? null;
  const displayTitle = imdbLookup?.title ?? torrentName;
  if (!files.length || !savePath) {
    return item(
      torrentName,
      displayTitle,
      "no_media_file",
      "nu am putut lista fișierele torrentului în qBittorrent",
    );
  }

  // Fișierele cu prioritate 0 („nu descărca”) apar în listă, dar nu există pe
  // disc — un .srt „fantomă” ar da ENOENT sau s-ar asocia greșit.
  const downloadedFiles = files.filter((f) => Number(f.progress ?? 0) >= 1);

  const mediaFiles = downloadedFiles.filter((f) =>
    MEDIA_EXTENSIONS.includes(extname(f.name).toLowerCase()),
  );
  if (!mediaFiles.length) {
    return item(
      torrentName,
      displayTitle,
      "no_media_file",
      "niciun fișier media recunoscut în torrent",
    );
  }
  // Pachet de episoade: fiecare episod cu subtitrarea lui, după SxxEyy.
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
      upgradeApproximate: params.upgradeApproximate,
      approximateEpisodes: params.approximateEpisodes,
    });
  }
  const mediaFile = mediaFiles[0];

  if (!imdbId) {
    console.log(`[subtitles] "${torrentName}": fără IMDb id, nu pot căuta subtitrare`);
    return item(
      torrentName,
      displayTitle,
      "no_imdb",
      "fără subtitrare și fără IMDb id disponibil — nu pot căuta pe OpenSubtitles/subs.ro",
    );
  }

  const matchingSrtFiles = downloadedFiles.filter((f) => f.name.toLowerCase().endsWith(".srt"));

  // Episod individual: toți candidații trec prin filtrul de episod
  // (resolveBestSubtitle) — S.W.A.T. Exiles S01E02 primise subtitrarea lui
  // S01E01 (2 oct. 2026). Filmele rămân nefiltrate.
  const episode = parseSeasonEpisode(torrentName) ?? parseSeasonEpisode(mediaFile.name);
  const episodeKey = extractEpisodeKey(torrentName);

  const result = await processMediaFile({
    mediaFile,
    matchingSrtFiles,
    savePath,
    qbitUrl,
    torrentHash,
    qbitUser,
    qbitPass,
    searchTargetName: torrentName,
    expectedEpisodeKey: episodeKey,
    upgradeApproximate: params.upgradeApproximate,
    getOsCandidates: () =>
      episode
        ? searchEpisodeSubtitles(imdbId, episode.season, episode.episode, "ro")
        : searchSubtitles(imdbId, "ro"),
    getSubsRoCandidates: async () => {
      // O arhivă subs.ro poate avea mai multe variante, fiecare un candidat.
      // La un episod, arhivele sezonului lui au întâietate — altfel, la un
      // serial cu multe sezoane, primele arhive puteau fi ale altor sezoane.
      const subsRoItems = await searchSubsRo(imdbId);
      const ordered = episode
        ? [
            ...subsRoItems.filter((it) => subsRoItemMatchesSeason(it, episode.season)),
            ...subsRoItems.filter((it) => !subsRoItemMatchesSeason(it, episode.season)),
          ]
        : subsRoItems;
      const zipEntries: SubsRoSrtEntry[] = [];
      // Până la 6 arhive și la filme: cea potrivită release-ului poate fi a
      // patra (The Invite).
      for (const it of ordered.slice(0, 6)) {
        const zipBuf = await downloadSubsRoZip(it.id);
        if (zipBuf) zipEntries.push(...(await extractSrtEntries(zipBuf)));
      }
      return zipEntries;
    },
  });

  const report = reportsOf(torrentName, extractEpisodeKey(mediaFile.name), result);
  return item(torrentName, displayTitle, result.outcome, result.detail, {
    release: result.release,
    path: result.path,
    matchedCriteria: result.matchedCriteria,
    maxCriteria: result.maxCriteria,
    source: result.source,
    sync: result.sync,
    files: [report.file],
    rejected: report.rejected,
  });
}

// ---------------------------------------------------------------------------
// Șterge de pe disc .srt-urile separate ale fișierelor din torrent (orice
// limbă), pentru o re-căutare curată cu „Corectează subtitrare”. Subtitrările
// încorporate rămân.
// ---------------------------------------------------------------------------

export type DeleteSubtitleResult =
  { status: "ok"; deleted: string[] } | { status: "error"; deleted: []; error: string };

export async function deleteRomanianSubtitle(params: {
  qbitUrl: string;
  qbitUser: string;
  qbitPass: string;
  torrentHash: string;
}): Promise<DeleteSubtitleResult> {
  const { qbitUrl, qbitUser, qbitPass, torrentHash } = params;
  const [files, savePath] = await Promise.all([
    qbitListFiles(qbitUrl, torrentHash, qbitUser, qbitPass).catch(() => []),
    getTorrentSavePath(qbitUrl, torrentHash, qbitUser, qbitPass),
  ]);
  if (!files.length || !savePath) {
    return { status: "error", deleted: [], error: "nu am putut lista fișierele torrentului" };
  }

  const downloadedFiles = files.filter((f) => Number(f.progress ?? 0) >= 1);
  const mediaFiles = downloadedFiles.filter((f) =>
    MEDIA_EXTENSIONS.includes(extname(f.name).toLowerCase()),
  );
  if (!mediaFiles.length) {
    return { status: "error", deleted: [], error: "niciun fișier media recunoscut în torrent" };
  }

  const deleted: string[] = [];
  for (const mediaFile of mediaFiles) {
    const mediaBaseName = basename(mediaFile.name, extname(mediaFile.name)).toLowerCase();
    const mediaDir = dirname(mediaFile.name);
    const dirAbsPath = mediaDir === "." ? savePath : join(savePath, mediaDir);
    let entries: string[];
    try {
      entries = await readdir(dirAbsPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const lower = entry.toLowerCase();
      if (!lower.endsWith(".srt") || !lower.startsWith(mediaBaseName)) continue;
      const absPath = join(dirAbsPath, entry);
      try {
        await unlink(absPath);
        deleted.push(mediaDir === "." ? entry : `${mediaDir}/${entry}`);
      } catch (e) {
        console.warn(`[subtitles] ștergere .srt eșuată (${absPath}):`, e);
      }
    }
  }

  if (!deleted.length) {
    return { status: "error", deleted: [], error: "nu am găsit niciun fișier .srt de șters" };
  }
  return { status: "ok", deleted };
}

// ---------------------------------------------------------------------------
// Pachet de episoade: fiecare fișier prin processMediaFile, asociat după
// SxxEyy. Căutările OpenSubtitles (un apel pe sezon) și subs.ro sunt comune
// tuturor episoadelor și făcute doar dacă e nevoie. Rezultatul e un singur
// SubtitleRunItem, cu detaliu per episod.
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
  upgradeApproximate?: boolean;
  approximateEpisodes?: ReadonlySet<string>;
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
    upgradeApproximate,
    approximateEpisodes,
  } = params;

  const seasonNumber =
    mediaFiles.map((f) => parseSeasonEpisode(f.name)?.season).find((s) => s != null) ?? null;

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

  // Lazy: doar dacă vreun episod ajunge la căutarea externă.
  let osSeasonResults: OpenSubtitlesResult[] | null = null;
  async function getOsSeasonResults(): Promise<OpenSubtitlesResult[]> {
    if (!osSeasonResults)
      osSeasonResults = await searchSeasonSubtitles(imdbId!, seasonNumber!, "ro");
    return osSeasonResults;
  }

  // subs.ro, tot lazy. Un sezon în desfășurare apare ca mai multe pachete
  // parțiale („Episoadele 1-4”, apoi „5-8”), deci le luăm pe TOATE (până la un
  // plafon) — altfel am rata episoadele din pachetele mai vechi.
  let subsRoEntries: SubsRoSrtEntry[] | null = null;
  async function getSubsRoEntries(): Promise<SubsRoSrtEntry[]> {
    if (subsRoEntries) return subsRoEntries;
    subsRoEntries = [];
    const items = await searchSubsRo(imdbId!);
    const seasonItems = items.filter((it) => subsRoItemMatchesSeason(it, seasonNumber!));
    for (const it of seasonItems.slice(0, 6)) {
      const zipBuf = await downloadSubsRoZip(it.id);
      if (zipBuf) subsRoEntries.push(...(await extractSrtEntries(zipBuf)));
    }
    return subsRoEntries;
  }

  interface EpisodeResult {
    episodeKey: string;
    outcome: SubtitleOutcome;
    detail: string;
  }
  const episodeResults: EpisodeResult[] = [];
  const files: SubtitleFileReport[] = [];
  const rejected: SubtitleRejectionReport[] = [];

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

    const matchingSrtFiles = downloadedFiles.filter(
      (f) => f.name.toLowerCase().endsWith(".srt") && extractEpisodeKey(f.name) === episodeKey,
    );

    const result = await processMediaFile({
      mediaFile,
      matchingSrtFiles,
      savePath,
      qbitUrl,
      torrentHash,
      qbitUser,
      qbitPass,
      searchTargetName: mediaFile.name,
      expectedEpisodeKey: episodeKey,
      upgradeApproximate:
        !!upgradeApproximate && (!approximateEpisodes || approximateEpisodes.has(episodeKey)),
      // Filtrul pe episod e în resolveBestSubtitle.
      getOsCandidates: getOsSeasonResults,
      getSubsRoCandidates: getSubsRoEntries,
    });

    episodeResults.push({ episodeKey, outcome: result.outcome, detail: result.detail });
    const report = reportsOf(torrentName, episodeKey, result);
    files.push(report.file);
    rejected.push(...report.rejected);
  }

  const corrected = episodeResults.filter((r) => CORRECTED_OUTCOMES.includes(r.outcome)).length;
  const ok = episodeResults.filter((r) => OK_OUTCOMES.includes(r.outcome)).length;
  const failed = episodeResults.length - corrected - ok;

  const summary = `${episodeResults.length} episoade — ${corrected} corectate, ${ok} deja ok, ${failed} fără subtitrare`;
  const perEpisode = episodeResults
    .sort((a, b) => a.episodeKey.localeCompare(b.episodeKey))
    .map((r) => `${r.episodeKey}: ${r.detail}`)
    .join("; ");

  const outcome: SubtitleOutcome =
    corrected > 0
      ? "season_corrected"
      : failed > 0
        ? "season_no_subtitle_found"
        : "season_already_ok";
  return item(torrentName, displayTitle, outcome, `${summary} — ${perEpisode}`, {
    files: files.sort((a, b) => (a.episode ?? "").localeCompare(b.episode ?? "")),
    rejected,
    episodeDetails: Object.fromEntries(episodeResults.map((r) => [r.episodeKey, r.detail])),
  });
}

// ---------------------------------------------------------------------------
// O singură intrare de activitate per rulare (descărcare sau backfill), cu
// detaliile per torrent în meta.items.
// ---------------------------------------------------------------------------

export type SubtitleRunTrigger = "download" | "backfill";

export async function logSubtitleRun(
  items: SubtitleRunItem[],
  trigger: SubtitleRunTrigger,
  // `via: "retry"` — găsită de reîncercarea zilnică; lista „Găsite” din
  // Watcher se citește după marcajul ăsta.
  extra?: { via?: "retry" },
): Promise<void> {
  if (!items.length) return;

  const byOutcome: Record<string, number> = {};
  for (const it of items) byOutcome[it.outcome] = (byOutcome[it.outcome] ?? 0) + 1;

  const corrected = items.filter((it) => CORRECTED_OUTCOMES.includes(it.outcome)).length;
  const ok = items.filter((it) => OK_OUTCOMES.includes(it.outcome)).length;
  const rest = items.length - corrected - ok;

  const message =
    trigger === "download"
      ? `${items[0].displayTitle}: ${shortLabelFor(items[0].outcome, {
          source: items[0].source,
          matchedCriteria: items[0].matchedCriteria,
          maxCriteria: items[0].maxCriteria,
          sync: items[0].sync,
        })}`
      : `Backfill subtitrări: ${items.length} verificate — ${corrected} corectate, ${ok} deja ok, ${rest} sărite/eșuate`;

  // La o descărcare fără nicio intervenție (subtitrare deja bună) nu trimitem
  // push — rămâne în jurnal. La backfill, mereu.
  const skipPush = trigger === "download" && OK_OUTCOMES.includes(items[0].outcome);

  try {
    const { logActivity } = await import("../activity-log");
    await logActivity(
      "subtitle_fix",
      message,
      {
        trigger,
        via: extra?.via,
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
          matchedCriteria: it.matchedCriteria,
          maxCriteria: it.maxCriteria,
          source: it.source,
          syncScore: it.sync?.score,
          syncOffset: it.sync?.offset,
          syncGood: it.sync?.good,
        })),
        // Jurnalul structurat (SubtitleFixDrawer), legat de itemi prin `torrent`.
        files: items.flatMap((it) => (it.files ?? []).map((f) => ({ ...f }))),
        rejected: items.flatMap((it) => (it.rejected ?? []).map((r) => ({ ...r }))),
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
