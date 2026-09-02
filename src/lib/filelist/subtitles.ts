// ---------------------------------------------------------------------------
// Asigură subtitrare română corectă la finalul unei descărcări Filelist (film
// sau, pentru pachete de episoade, fiecare episod din torrent — vezi
// processSeasonPack). Apelat din pollUntilComplete (download.ts) și din
// corectSubtitleForMedia (corecție punctuală per titlu), înainte de
// refreshPlexLibrary.
//
// Fișierul ăsta e doar orchestrare (film vs. pachet, agregare rezultate,
// logging) — logica per fișier media (cei 4 pași, aplicați identic la film
// și la fiecare episod dintr-un pachet) trăiește în subtitle-pipeline.ts:
//  1. subtitle-checks.ts    — are deja subtitrare/audio română? .srt existent
//     pare română?
//  2. subtitle-sources.ts   — alege cea mai bună subtitrare dintre
//     OpenSubtitles și subs.ro (clienții HTTP: opensubtitles-client.ts,
//     subsro-client.ts).
//  3. subtitle-encoding.ts  — decodare/conversie UTF-8, I/O cu retry.
//  4. subtitle-apply.ts     — redenumire prin API qBittorrent, scriere pe
//     disc a subtitrării alese.
//
// Orice eroare aici e prinsă și logată — nu trebuie să blocheze niciodată
// refresh-ul Plex care urmează.
// ---------------------------------------------------------------------------

import { readdir, unlink } from "node:fs/promises";
import { join, dirname, basename, extname } from "node:path";
import { qbitGet, qbitListFiles, type QbitFileInfo } from "../qbit-client";
import {
  searchSubtitles,
  searchSeasonSubtitles,
  type OpenSubtitlesResult,
} from "./opensubtitles-client";
import {
  searchSubsRo,
  downloadSubsRoZip,
  extractSrtEntries,
  subsRoItemMatchesSeason,
} from "./subsro-client";
import {
  type SubtitleOutcome,
  CORRECTED_OUTCOMES,
  OK_OUTCOMES,
  SHORT_LABELS,
} from "./subtitle-outcomes";
import { lookupTitleByImdbId, searchImdbIdByReleaseName } from "../tmdb/tmdb-title-lookup";
import {
  MEDIA_EXTENSIONS,
  parseSeasonEpisode,
  episodeKeyFrom,
  extractEpisodeKey,
} from "./subtitle-checks";
import { processMediaFile } from "./subtitle-pipeline";

export type { SubtitleOutcome };

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
  // Câte din criteriile aplicabile (rezoluție/mod obținere/platformă/codec/
  // grup) s-au potrivit, din câte erau identificabile în numele fișierului
  // țintă — prezent doar când s-a descărcat efectiv o subtitrare (nu la
  // rezultate gen "deja are subtitrare" unde nu s-a făcut nicio scorare).
  matchedCriteria?: number;
  maxCriteria?: number;
}

function item(
  torrentName: string,
  displayTitle: string,
  outcome: SubtitleOutcome,
  detail: string,
  extra?: { release?: string; path?: string; matchedCriteria?: number; maxCriteria?: number },
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
    return item(
      torrentName,
      displayTitle,
      "no_media_file",
      "nu am putut lista fișierele torrentului în qBittorrent",
    );
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
    return item(
      torrentName,
      displayTitle,
      "no_media_file",
      "niciun fișier media recunoscut în torrent",
    );
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

  if (!imdbId) {
    console.warn(`[subtitles] "${torrentName}": fără IMDb id, nu pot căuta subtitrare`);
    return item(
      torrentName,
      displayTitle,
      "no_imdb",
      "fără subtitrare și fără IMDb id disponibil — nu pot căuta pe OpenSubtitles/subs.ro",
    );
  }

  const matchingSrtFiles = downloadedFiles.filter((f) => f.name.toLowerCase().endsWith(".srt"));

  const result = await processMediaFile({
    mediaFile,
    matchingSrtFiles,
    savePath,
    qbitUrl,
    torrentHash,
    qbitUser,
    qbitPass,
    searchTargetName: torrentName,
    getOsCandidates: () => searchSubtitles(imdbId, "ro"),
    getSubsRoCandidates: async () => {
      // O arhivă subs.ro poate conține mai multe variante (una per
      // sursă/rezoluție), fiecare tratată ca un candidat separat, scorat la fel.
      const subsRoItems = await searchSubsRo(imdbId);
      const zipEntries: Array<{ release: string; content: Buffer }> = [];
      for (const it of subsRoItems.slice(0, 3)) {
        const zipBuf = await downloadSubsRoZip(it.id);
        if (zipBuf) zipEntries.push(...(await extractSrtEntries(zipBuf)));
      }
      return zipEntries;
    },
  });

  return item(torrentName, displayTitle, result.outcome, result.detail, {
    release: result.release,
    path: result.path,
    matchedCriteria: result.matchedCriteria,
    maxCriteria: result.maxCriteria,
  });
}

// ---------------------------------------------------------------------------
// Șterge de pe disk subtitrarea(ile) .srt sidecar asociate fișierelor media
// dintr-un torrent (nume-de-fișier-media + ".srt", indiferent de limbă —
// ".ro.srt", ".en.srt" etc.), ca utilizatorul să poată forța o re-căutare
// curată printr-un „Corectează subtitrare" ulterior. Nu atinge subtitrările
// încorporate în fișierul media (embedded) — doar fișiere .srt separate.
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
    qbitListFiles(qbitUrl, torrentHash, qbitUser, qbitPass),
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
// Pachet de episoade (season pack) — fiecare fișier media procesat separat
// prin processMediaFile (subtitle-pipeline.ts), asociat cu subtitrarea lui
// după cheia SxxExx. Rezultatele OpenSubtitles (căutare pe tot sezonul, un
// singur apel) și subs.ro (căutare + arhive, preluate lazy — doar dacă chiar
// e nevoie) sunt partajate între toate episoadele din același torrent, nu
// re-cerute per episod. Agregă totul într-un singur SubtitleRunItem, cu
// detaliu per episod în `detail`.
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

  // OpenSubtitles pentru tot sezonul — un singur apel, dar lazy: doar dacă
  // vreun episod chiar ajunge la pasul de căutare externă (nu are rost dacă
  // toate episoadele au deja embedded/tracked/sidecar rezolvate).
  let osSeasonResults: OpenSubtitlesResult[] | null = null;
  async function getOsSeasonResults(): Promise<OpenSubtitlesResult[]> {
    if (!osSeasonResults)
      osSeasonResults = await searchSeasonSubtitles(imdbId!, seasonNumber!, "ro");
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
      getOsCandidates: async () =>
        (await getOsSeasonResults()).filter((r) => {
          if (r.seasonNumber == null || r.episodeNumber == null)
            return extractEpisodeKey(r.release) === episodeKey;
          return episodeKeyFrom(r.seasonNumber, r.episodeNumber) === episodeKey;
        }),
      getSubsRoCandidates: async () =>
        (await getSubsRoEntries()).filter((e) => extractEpisodeKey(e.release) === episodeKey),
    });

    episodeResults.push({ episodeKey, outcome: result.outcome, detail: result.detail });
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
          matchedCriteria: it.matchedCriteria,
          maxCriteria: it.maxCriteria,
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
