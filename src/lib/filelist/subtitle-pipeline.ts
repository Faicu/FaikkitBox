// ---------------------------------------------------------------------------
// Pașii per fișier media (verificare → surse externe → pregătire → aplicare),
// într-un singur loc pentru film și pentru fiecare episod dintr-un pachet.
// Scriși de două ori, fluxurile s-au despărțit: verificarea de limbă a unui
// .srt inclus exista doar la filme (bug, 2 sept. 2026).
// ---------------------------------------------------------------------------

import { basename, dirname, extname, join } from "node:path";
import { readFile, rename } from "node:fs/promises";
import type { QbitFileInfo } from "../qbit-client";
import type { OpenSubtitlesResult } from "./opensubtitles-client";
import type { SubsRoSrtEntry } from "./subsro-client";
import type {
  RejectedVariant,
  SubtitleOutcome,
  SubtitleSource,
  SubtitleSync,
} from "./subtitle-outcomes";
import {
  fileExists,
  hasEmbeddedRomanianSubtitle,
  detectAlreadyRomanianContent,
  extractEpisodeKey,
  srtContentLanguage,
  pickRomanianSrt,
} from "./subtitle-checks";
import {
  createSubtitleVerifier,
  isBetterSync,
  isConfidentSync,
  isWellSynced,
  type SyncMeasure,
} from "./subtitle-verify";
import { SUBTITLE_SOURCE_LABELS } from "./subtitle-outcomes";
import { decodeToUtf8Text } from "./subtitle-encoding";
import { rankSubtitleCandidates } from "./subtitle-sources";
import {
  handleTrackedSrt,
  handleSidecarSrt,
  fetchCandidateText,
  writeChosenSubtitle,
  moveAsideTrackedSrt,
  tagTrackedSrtEnglish,
} from "./subtitle-apply";

export interface ProcessMediaFileParams {
  mediaFile: QbitFileInfo;
  // .srt-urile urmărite de qBittorrent asociate fișierului — asocierea o face
  // apelantul (toate la film; doar cele cu același SxxEyy la pachet).
  matchingSrtFiles: QbitFileInfo[];
  savePath: string;
  qbitUrl: string;
  torrentHash: string;
  qbitUser: string;
  qbitPass: string;
  // Numele pentru scorarea candidaților: al torrentului la film, al fișierului
  // la pachet (taguri exacte ale episodului, nu ale pachetului).
  searchTargetName: string;
  // Episodul așteptat în fișier; null la filme.
  expectedEpisodeKey: string | null;
  // Candidații externi, nefiltrați pe episod (filtrul e în
  // rankSubtitleCandidates), ceruți doar dacă e nevoie.
  getOsCandidates: () => Promise<OpenSubtitlesResult[]>;
  getSubsRoCandidates: () => Promise<SubsRoSrtEntry[]>;
  // Subtitrarea existentă e „aproximativă”: căutăm una mai bună și o
  // înlocuim doar cu una sigur mai bună (reîncercarea zilnică).
  upgradeApproximate?: boolean;
}

export interface ProcessMediaFileResult {
  outcome: SubtitleOutcome;
  detail: string;
  release?: string;
  path?: string;
  matchedCriteria?: number;
  maxCriteria?: number;
  // Sursa externă a subtitrării descărcate.
  source?: SubtitleSource;
  sync?: SubtitleSync;
  // Pentru jurnalul structurat (SubtitleFileReport).
  rejected?: RejectedVariant[];
  movedAside?: string;
  compared?: number;
  replacedApproximate?: boolean;
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
    upgradeApproximate = false,
  } = params;

  // Episodul țintă e cel din numele fișierului; dacă torrentul anunță altul,
  // nu ghicim.
  const mediaEpisodeKey = extractEpisodeKey(mediaFile.name);
  if (mediaEpisodeKey && expectedEpisodeKey && mediaEpisodeKey !== expectedEpisodeKey) {
    return {
      outcome: "no_subtitle_found",
      detail: `fișierul media e ${mediaEpisodeKey}, dar torrentul e ${expectedEpisodeKey} — nu pun nicio subtitrare până nu se lămurește`,
    };
  }
  const episodeKey = mediaEpisodeKey ?? expectedEpisodeKey;
  // .srt-urile care numesc alt episod nu sunt ale fișierului ăstuia.
  const ownSrtFiles = episodeKey
    ? matchingSrtFiles.filter((f) => {
        const k = extractEpisodeKey(f.name);
        return k == null || k === episodeKey;
      })
    : matchingSrtFiles;

  const mediaAbsPath = join(savePath, mediaFile.name);
  const verify = createSubtitleVerifier(mediaAbsPath);
  // Fără fișierul video pe calea raportată (mutat), .srt-ul ar ajunge într-un
  // director fără video — nu scriem nimic.
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

  // Pas 1b — .srt-urile urmărite de qBittorrent, verificate după CONȚINUT, nu
  // după nume. Cel român devine „.ro.srt”, ca Plex să-l recunoască. Cele
  // străine care ar încurca Plex (singurul .srt, cel nemarcat de lângă video,
  // un „.ro.srt” greșit) primesc „.en” dacă sunt în engleză, altfel `.respins`.
  // Cele marcate deja cu altă limbă rămân. Totul prin qBittorrent.
  if (ownSrtFiles.length > 0) {
    const read = await Promise.all(
      ownSrtFiles.map(async (file) => {
        const buf = await readFile(join(savePath, file.name)).catch(() => null);
        const language = buf ? srtContentLanguage(decodeToUtf8Text(buf).text) : null;
        return { file, buf, language, romanian: language === "ro" };
      }),
    );
    const trackedCtx = { qbitUrl, torrentHash, qbitUser, qbitPass, savePath };
    const plainRelPath =
      mediaDir === "." ? `${mediaBaseName}.srt` : `${mediaDir}/${mediaBaseName}.srt`;
    const clearNonRomanian = async (entry: (typeof read)[number]) => {
      if (!entry.buf) return;
      if (entry.language === "en") {
        await tagTrackedSrtEnglish(entry.file.name, mediaBaseName, mediaDir, trackedCtx);
      } else {
        await moveAsideTrackedSrt(entry.file.name, trackedCtx);
      }
    };

    const romanian = pickRomanianSrt(read);
    if (romanian) {
      // Ținta „.ro.srt” ocupată de un .srt străin al torrentului: mutat întâi,
      // altfel qBittorrent refuză redenumirea.
      if (romanian.name !== targetSrtRelPath) {
        const occupant = read.find((r) => r.file.name === targetSrtRelPath);
        if (occupant) await clearNonRomanian(occupant);
      }
      const { outcome, detail } = await handleTrackedSrt(
        romanian,
        targetSrtRelPath,
        mediaFile.piece_range,
        trackedCtx,
      );
      const others = ownSrtFiles.length - 1;
      return {
        outcome,
        detail:
          others > 0
            ? `${detail} (ales după conținut dintre ${ownSrtFiles.length} fișiere .srt)`
            : detail,
        path: targetSrtRelPath,
      };
    }

    // Niciunul nu e român: „.ro.srt”-ul greșit primul, ca „Film.srt” să nu-i
    // ia numele .en.
    const ordered = [...read].sort(
      (a, b) => Number(b.file.name === targetSrtRelPath) - Number(a.file.name === targetSrtRelPath),
    );
    for (const entry of ordered) {
      const name = entry.file.name;
      if (ownSrtFiles.length === 1 || name === plainRelPath || name === targetSrtRelPath) {
        await clearNonRomanian(entry);
      }
    }
  }

  // Pas 1c — un .srt lăsat de o rulare anterioară (neurmărit de qBittorrent):
  // verificat după conținut — cu alt episod înăuntru, e pus deoparte
  // (`.ro.srt.respins`) și căutăm din nou.
  const sidecarAbsPath = join(savePath, targetSrtRelPath);
  // Un „.ro.srt” străin al torrentului, rămas pe cale: nu scriem peste el pe
  // la spatele lui qBittorrent.
  if (ownSrtFiles.some((f) => f.name === targetSrtRelPath) && (await fileExists(sidecarAbsPath))) {
    return {
      outcome: "no_subtitle_found",
      detail: `„${basename(targetSrtRelPath)}" din torrent nu e în română și n-a putut fi pus deoparte prin qBittorrent — nu scriu peste el`,
    };
  }
  let rejectedSidecar: string | null = null;
  let movedAside: string | undefined;
  // Setat când păstrăm .srt-ul existent doar până găsim unul mai bun.
  let upgrading: { sync: SyncMeasure | null } | null = null;
  if (await fileExists(sidecarAbsPath)) {
    const sidecarBuf = await readFile(sidecarAbsPath).catch(() => null);
    const check = sidecarBuf ? await verify(decodeToUtf8Text(sidecarBuf).text) : null;
    const reason = check?.reason ?? null;
    if (!reason) {
      // Deja bine sincronizată — nimic de îmbunătățit.
      if (!upgradeApproximate || (check?.sync && isWellSynced(check.sync))) {
        const { outcome, detail } = await handleSidecarSrt(sidecarAbsPath);
        return { outcome, detail };
      }
      upgrading = { sync: check?.sync ?? null };
    } else {
      await rename(sidecarAbsPath, `${sidecarAbsPath}.respins`);
      console.log(`[subtitles] .srt existent respins (${reason}) → ${sidecarAbsPath}.respins`);
      rejectedSidecar = `.srt-ul existent a fost respins (${reason}) și mutat deoparte`;
      movedAside = check?.short ?? reason;
    }
  }
  // Fără variantă mai bună: .srt-ul rămâne, starea nu se schimbă.
  const keepExisting = (why: string): ProcessMediaFileResult => ({
    outcome: "srt_already_ok",
    detail: `subtitrarea aproximativă existentă rămâne — ${why}`,
  });
  const withRejected = (detail: string) =>
    rejectedSidecar ? `${rejectedSidecar}; ${detail}` : detail;
  const rejected: RejectedVariant[] = [];

  // Pas 2 — nicio subtitrare: căutăm pe ambele surse și ordonăm variantele
  // după apropierea de fișier.
  const osCandidates = await getOsCandidates();
  const ranked = await rankSubtitleCandidates(
    searchTargetName,
    episodeKey,
    osCandidates,
    getSubsRoCandidates,
  );
  // La înlocuirea uneia aproximative: subs.ro toate (gratuite), OpenSubtitles
  // doar cele cu release identic — altfel fiecare titlu ar consuma zilnic din
  // limita contului.
  const candidates = upgrading
    ? ranked.filter(
        (c) => c.source === "subsro" || (c.maxCriteria > 0 && c.matchedCriteria === c.maxCriteria),
      )
    : ranked;
  if (upgrading && candidates.length === 0) return keepExisting("nicio variantă nouă");
  if (candidates.length === 0) {
    return {
      outcome: "no_subtitle_found",
      detail: withRejected(
        `niciun rezultat pe OpenSubtitles sau subs.ro${episodeKey ? ` pentru ${episodeKey}` : ""}`,
      ),
      movedAside,
    };
  }

  // Pas 4 — alege și scrie. O variantă respinsă sau nedescărcabilă trece la
  // următoarea. Cu o subtitrare încorporată de comparat, câștigă cea mai bine
  // sincronizată (oprire la prima practic perfectă — fiecare variantă
  // OpenSubtitles costă o descărcare), nu cea cu numele cel mai apropiat (The
  // Invite primise o variantă decalată cu ~3 s). Fără ea, prima care trece.
  const destPath = join(savePath, mediaDir === "." ? "" : mediaDir, `${mediaBaseName}.ro.srt`);
  const failures: string[] = [];
  let allDownloadsFailed = true;
  let best: {
    candidate: (typeof candidates)[number];
    fetched: { text: string; wasConverted: boolean };
    sync: SyncMeasure | null;
  } | null = null;
  let compared = 0;
  for (const candidate of candidates) {
    const label = `${SUBTITLE_SOURCE_LABELS[candidate.source]}, release „${candidate.release}"`;
    const fetched = await fetchCandidateText(candidate);
    if (!fetched) {
      failures.push(`${label}: descărcarea a eșuat`);
      rejected.push({
        source: candidate.source,
        release: candidate.release,
        reason: "descărcarea a eșuat",
      });
      continue;
    }
    allDownloadsFailed = false;
    const check = await verify(fetched.text);
    if (check.reason) {
      // log, nu warn: o variantă respinsă e un rezultat obișnuit, nu o eroare.
      console.log(`[subtitles] ${label} respinsă: ${check.reason}`);
      failures.push(`${label}: respinsă — ${check.reason}`);
      rejected.push({
        source: candidate.source,
        release: candidate.release,
        reason: check.short ?? check.reason,
      });
      continue;
    }
    if (!check.sync) {
      best = { candidate, fetched, sync: null };
      break;
    }
    compared++;
    if (isBetterSync(check.sync, best?.sync ?? null))
      best = { candidate, fetched, sync: check.sync };
    if (isWellSynced(check.sync)) break;
  }

  if (upgrading) {
    // Mai bună = sigură după sincronizare, sau, fără măsurătoare, cu release
    // identic.
    const better =
      best &&
      (best.sync
        ? isConfidentSync(best.sync, best.candidate)
        : best.candidate.maxCriteria > 0 &&
          best.candidate.matchedCriteria === best.candidate.maxCriteria);
    if (!best || !better) return keepExisting("nicio variantă mai bună");
  }
  if (!best) {
    return {
      outcome: allDownloadsFailed ? "download_failed" : "no_subtitle_found",
      detail: withRejected(
        `nicio variantă potrivită din ${candidates.length} încercate: ${failures.join("; ")}`,
      ),
      rejected,
      movedAside,
    };
  }
  const result = await writeChosenSubtitle(best.candidate, destPath, best.fetched, best.sync);
  const notes = [
    upgrading ? "a înlocuit subtitrarea aproximativă de dinainte" : null,
    compared > 1 ? `aleasă după sincronizare dintre ${compared} variante` : null,
    failures.length > 0 ? `sărite: ${failures.join("; ")}` : null,
  ].filter(Boolean);
  return {
    outcome: result.outcome,
    detail: withRejected(result.detail + (notes.length ? `; ${notes.join("; ")}` : "")),
    release: best.candidate.release,
    path: destPath,
    matchedCriteria: result.matchedCriteria,
    maxCriteria: result.maxCriteria,
    source: result.source,
    sync: best.sync
      ? { ...best.sync, good: isConfidentSync(best.sync, best.candidate) }
      : undefined,
    rejected,
    movedAside,
    compared,
    replacedApproximate: upgrading != null,
  };
}
