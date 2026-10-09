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
import { readFile, rename } from "node:fs/promises";
import type { QbitFileInfo } from "../qbit-client";
import type { OpenSubtitlesResult } from "./opensubtitles-client";
import type { SubsRoSrtEntry } from "./subsro-client";
import type { SubtitleOutcome, SubtitleSource } from "./subtitle-outcomes";
import {
  fileExists,
  hasEmbeddedRomanianSubtitle,
  detectAlreadyRomanianContent,
  extractEpisodeKey,
  looksRomanian,
} from "./subtitle-checks";
import { createSubtitleVerifier } from "./subtitle-verify";
import { decodeToUtf8Text } from "./subtitle-encoding";
import { rankSubtitleCandidates } from "./subtitle-sources";
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
  // Episodul pe care apelantul îl așteaptă în fișier (din numele torrentului
  // la un episod descărcat singur, din numele fișierului la pachet). null la
  // filme.
  expectedEpisodeKey: string | null;
  // Candidații externi, nefiltrați pe episod — filtrul e în
  // rankSubtitleCandidates. Lazy — apelate doar dacă chiar se ajunge la
  // căutare externă.
  getOsCandidates: () => Promise<OpenSubtitlesResult[]>;
  getSubsRoCandidates: () => Promise<SubsRoSrtEntry[]>;
}

export interface ProcessMediaFileResult {
  outcome: SubtitleOutcome;
  detail: string;
  release?: string;
  path?: string;
  matchedCriteria?: number;
  maxCriteria?: number;
  // Sursa externă reală a subtitrării descărcate (outcome-ul nu o mai spune).
  source?: SubtitleSource;
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
    expectedEpisodeKey,
    getOsCandidates,
    getSubsRoCandidates,
  } = params;

  // Episodul țintă: cel din numele fișierului media. Dacă torrentul anunță
  // alt episod decât fișierul din el, nu ghicim care e adevărat.
  const mediaEpisodeKey = extractEpisodeKey(mediaFile.name);
  if (mediaEpisodeKey && expectedEpisodeKey && mediaEpisodeKey !== expectedEpisodeKey) {
    return {
      outcome: "no_subtitle_found",
      detail: `fișierul media e ${mediaEpisodeKey}, dar torrentul e ${expectedEpisodeKey} — nu pun nicio subtitrare până nu se lămurește`,
    };
  }
  const episodeKey = mediaEpisodeKey ?? expectedEpisodeKey;
  // .srt-urile din torrent care numesc explicit alt episod nu sunt ale
  // fișierului ăstuia, oricum le-ar fi asociat apelantul.
  const ownSrtFiles = episodeKey
    ? matchingSrtFiles.filter((f) => {
        const k = extractEpisodeKey(f.name);
        return k == null || k === episodeKey;
      })
    : matchingSrtFiles;

  const mediaAbsPath = join(savePath, mediaFile.name);
  const verify = createSubtitleVerifier(mediaAbsPath);
  // Subtitrarea se scrie lângă fișierul media, pe calea raportată de
  // qBittorrent. Dacă fișierul nu e acolo (mutat, save_path schimbat), .srt-ul
  // ar ajunge într-un director fără video — nu scriem nimic.
  if (!(await fileExists(mediaAbsPath))) {
    return {
      outcome: "no_media_file",
      detail: `fișierul media nu e pe disc la „${mediaAbsPath}" — nu scriu subtitrarea în alt loc`,
    };
  }
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
  if (ownSrtFiles.length === 1) {
    const existingAbsPath = join(savePath, ownSrtFiles[0].name);
    const existingBuf = await readFile(existingAbsPath).catch(() => null);
    const existingText = existingBuf ? decodeToUtf8Text(existingBuf).text : "";

    if (existingBuf && looksRomanian(existingText)) {
      const { outcome, detail } = await handleTrackedSrt(
        ownSrtFiles[0],
        targetSrtRelPath,
        mediaFile.piece_range,
        { qbitUrl, torrentHash, qbitUser, qbitPass, savePath },
      );
      return { outcome, detail, path: targetSrtRelPath };
    }

    // Nu pare română — redenumim ca .en și continuăm mai jos să căutăm o
    // subtitrare română reală, fără să atingem targetSrtRelPath.
    if (existingBuf) {
      await renameToNonRomanian(ownSrtFiles[0], mediaBaseName, mediaDir, {
        qbitUrl,
        torrentHash,
        qbitUser,
        qbitPass,
      });
    }
  }

  // Mai multe .srt-uri — probabil deja există unul cu limba corectă marcată;
  // nu ne amestecăm.
  if (ownSrtFiles.length > 1) {
    return {
      outcome: "multiple_srt_skipped",
      detail: `${ownSrtFiles.length} fișiere .srt găsite — sar peste, posibil deja etichetate corect pe limbi`,
    };
  }

  // Pas 1c — .srt sidecar descărcat anterior de sistem, netrackuit de
  // qBittorrent (deci invizibil la pasul 1b, chiar și la rulări ulterioare).
  //
  // Conținutul lui se verifică întâi: un .srt rămas de la o rulare veche, cu
  // alt episod înăuntru, nu mai e acceptat doar fiindcă are numele bun —
  // se pune deoparte (`.ro.srt.respins`, ignorat de Plex) și căutăm din nou.
  const sidecarAbsPath = join(savePath, targetSrtRelPath);
  let rejectedSidecar: string | null = null;
  if (await fileExists(sidecarAbsPath)) {
    const sidecarBuf = await readFile(sidecarAbsPath).catch(() => null);
    const reason = sidecarBuf ? await verify(decodeToUtf8Text(sidecarBuf).text) : null;
    if (!reason) {
      const { outcome, detail } = await handleSidecarSrt(sidecarAbsPath);
      return { outcome, detail };
    }
    await rename(sidecarAbsPath, `${sidecarAbsPath}.respins`);
    console.warn(`[subtitles] .srt existent respins (${reason}) → ${sidecarAbsPath}.respins`);
    rejectedSidecar = `.srt-ul existent a fost respins (${reason}) și mutat deoparte`;
  }
  const withRejected = (detail: string) =>
    rejectedSidecar ? `${rejectedSidecar}; ${detail}` : detail;

  // Pas 2 — nicio subtitrare deloc: caută pe cele două surse externe și
  // ordonează variantele după cât de apropiate sunt de fișierul țintă.
  const osCandidates = await getOsCandidates();
  const candidates = await rankSubtitleCandidates(
    searchTargetName,
    episodeKey,
    osCandidates,
    getSubsRoCandidates,
  );
  if (candidates.length === 0) {
    return {
      outcome: "no_subtitle_found",
      detail: withRejected(
        `niciun rezultat pe OpenSubtitles sau subs.ro${episodeKey ? ` pentru ${episodeKey}` : ""}`,
      ),
    };
  }

  // Pas 4 — descarcă și scrie prima variantă care trece verificarea
  // conținutului. Una respinsă (altă limbă, alt episod) sau nedescărcabilă
  // nu mai oprește căutarea: se trece la următoarea.
  const destPath = join(savePath, mediaDir === "." ? "" : mediaDir, `${mediaBaseName}.ro.srt`);
  const failures: string[] = [];
  let allDownloadsFailed = true;
  for (const candidate of candidates) {
    const result = await downloadAndWriteSubtitle(candidate, candidate.confident, destPath, verify);
    if (result.outcome === "downloaded" || result.outcome === "downloaded_approximate") {
      const skipped =
        failures.length > 0 ? `; variante sărite înainte: ${failures.join("; ")}` : "";
      return {
        outcome: result.outcome,
        detail: withRejected(result.detail + skipped),
        release: candidate.release,
        path: destPath,
        matchedCriteria: result.matchedCriteria,
        maxCriteria: result.maxCriteria,
        source: result.source,
      };
    }
    if (result.outcome !== "download_failed") allDownloadsFailed = false;
    failures.push(result.detail);
  }
  return {
    outcome: allDownloadsFailed ? "download_failed" : "no_subtitle_found",
    detail: withRejected(
      `nicio variantă potrivită din ${candidates.length} încercate: ${failures.join("; ")}`,
    ),
  };
}
