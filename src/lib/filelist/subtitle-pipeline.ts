// ---------------------------------------------------------------------------
// Pipeline unificat per fișier media — leagă pașii 1→4 (verificare existență
// → surse externe → pregătire → aplicare) într-un singur loc, apelat o
// singură dată pentru film și în buclă (per episod) pentru pachet de sezon.
//
// Scop explicit: elimină duplicarea dintre fluxul de film și cel de pachet —
// înainte de refactor, aceeași secvență de decizii era scrisă de două ori
// separat în subtitles.ts, ceea ce a permis un bug real (2026-09-02):
// verificarea de limbă a unui .srt bundle-uit exista doar pe fluxul de film,
// lipsea complet la pachete. Cu un singur loc care implementează pașii,
// ambele fluxuri se comportă identic prin construcție, nu prin disciplină.
// ---------------------------------------------------------------------------

import { basename, dirname, extname, join } from "node:path";
import { readFile } from "node:fs/promises";
import type { QbitFileInfo } from "../qbit-client";
import type { OpenSubtitlesResult } from "./opensubtitles-client";
import type { SubtitleOutcome } from "./subtitle-outcomes";
import {
  fileExists,
  hasEmbeddedRomanianSubtitle,
  detectAlreadyRomanianContent,
  looksRomanian,
} from "./subtitle-checks";
import { decodeToUtf8Text } from "./subtitle-encoding";
import { resolveBestSubtitle } from "./subtitle-sources";
import {
  handleTrackedSrt,
  handleSidecarSrt,
  downloadAndWriteSubtitle,
  renameToNonRomanian,
} from "./subtitle-apply";

export interface ProcessMediaFileParams {
  mediaFile: QbitFileInfo;
  // .srt-urile deja urmărite de qBittorrent, asociate ACESTUI fișier media —
  // apelantul decide asocierea (toate .srt-urile torrentului, la film; doar
  // cele cu aceeași cheie SxxExx, la pachet).
  matchingSrtFiles: QbitFileInfo[];
  savePath: string;
  qbitUrl: string;
  torrentHash: string;
  qbitUser: string;
  qbitPass: string;
  // Numele folosit la scorarea candidaților externi (torrentName la film —
  // un singur fișier, deci numele torrentului e destul de precis; numele
  // fișierului episodului la pachet, ca scoring-ul să vadă exact taguri de
  // rezoluție/sursă/grup ale ACELUI episod, nu ale pachetului întreg).
  searchTargetName: string;
  // Candidați deja preluați/filtrați de apelant (torrent unic → căutare
  // directă; pachet → rezultatele pe tot sezonul, filtrate la acest episod).
  // Lazy — apelate doar dacă chiar se ajunge la căutare externă.
  getOsCandidates: () => Promise<OpenSubtitlesResult[]>;
  getSubsRoCandidates: () => Promise<Array<{ release: string; content: Buffer }>>;
}

export interface ProcessMediaFileResult {
  outcome: SubtitleOutcome;
  detail: string;
  release?: string;
  path?: string;
  matchedCriteria?: number;
  maxCriteria?: number;
}

export async function processMediaFile(
  params: ProcessMediaFileParams,
): Promise<ProcessMediaFileResult> {
  const {
    mediaFile,
    matchingSrtFiles,
    savePath,
    qbitUrl,
    torrentHash,
    qbitUser,
    qbitPass,
    searchTargetName,
    getOsCandidates,
    getSubsRoCandidates,
  } = params;

  const mediaAbsPath = join(savePath, mediaFile.name);
  const mediaBaseName = basename(mediaFile.name, extname(mediaFile.name));
  const mediaDir = dirname(mediaFile.name);
  const targetSrtRelPath =
    mediaDir === "." ? `${mediaBaseName}.ro.srt` : `${mediaDir}/${mediaBaseName}.ro.srt`;

  // Pas 1a — are deja subtitrare/audio română?
  if (await hasEmbeddedRomanianSubtitle(mediaAbsPath)) {
    return {
      outcome: "already_embedded",
      detail: "are deja subtitrare română încorporată în fișierul media — nimic de făcut",
    };
  }
  const alreadyRomanianDetail = await detectAlreadyRomanianContent(mediaAbsPath, mediaFile.name);
  if (alreadyRomanianDetail) {
    return { outcome: "audio_already_romanian", detail: alreadyRomanianDetail };
  }

  // Pas 1b — exact un .srt deja urmărit de qBittorrent pentru acest fișier?
  // Verificăm ÎNTÂI conținutul, nu presupunem că fiindcă e singurul, e
  // automat română (lansările pot avea subtitrare engleză bundle-uită).
  if (matchingSrtFiles.length === 1) {
    const existingAbsPath = join(savePath, matchingSrtFiles[0].name);
    const existingBuf = await readFile(existingAbsPath).catch(() => null);
    const existingText = existingBuf ? decodeToUtf8Text(existingBuf).text : "";

    if (existingBuf && looksRomanian(existingText)) {
      const { outcome, detail } = await handleTrackedSrt(
        matchingSrtFiles[0],
        targetSrtRelPath,
        mediaFile.piece_range,
        { qbitUrl, torrentHash, qbitUser, qbitPass, savePath },
      );
      return { outcome, detail, path: targetSrtRelPath };
    }

    // Nu pare română — redenumim ca .en și continuăm mai jos să căutăm o
    // subtitrare română reală, fără să atingem targetSrtRelPath.
    if (existingBuf) {
      await renameToNonRomanian(matchingSrtFiles[0], mediaBaseName, mediaDir, {
        qbitUrl,
        torrentHash,
        qbitUser,
        qbitPass,
      });
    }
  }

  // Mai multe .srt-uri — probabil deja există unul cu limba corectă marcată;
  // nu ne amestecăm.
  if (matchingSrtFiles.length > 1) {
    return {
      outcome: "multiple_srt_skipped",
      detail: `${matchingSrtFiles.length} fișiere .srt găsite — sar peste, posibil deja etichetate corect pe limbi`,
    };
  }

  // Pas 1c — .srt sidecar descărcat anterior de sistem, netrackuit de
  // qBittorrent (deci invizibil la pasul 1b, chiar și la rulări ulterioare).
  const sidecarAbsPath = join(savePath, targetSrtRelPath);
  if (await fileExists(sidecarAbsPath)) {
    const { outcome, detail } = await handleSidecarSrt(sidecarAbsPath);
    return { outcome, detail };
  }

  // Pas 2 — nicio subtitrare deloc: caută pe cele două surse externe și
  // alege cea mai apropiată de numele fișierului țintă.
  const osCandidates = await getOsCandidates();
  const resolved = await resolveBestSubtitle(searchTargetName, osCandidates, getSubsRoCandidates);
  if (!resolved) {
    return { outcome: "no_subtitle_found", detail: "niciun rezultat pe OpenSubtitles sau subs.ro" };
  }

  // Pas 4 — descarcă și scrie subtitrarea aleasă.
  const destPath = join(savePath, mediaDir === "." ? "" : mediaDir, `${mediaBaseName}.ro.srt`);
  const { outcome, detail, matchedCriteria, maxCriteria } = await downloadAndWriteSubtitle(
    resolved.winner,
    resolved.confident,
    destPath,
  );
  return {
    outcome,
    detail,
    release: resolved.winner.release,
    path: destPath,
    matchedCriteria,
    maxCriteria,
  };
}
