// ---------------------------------------------------------------------------
// Pas 4 — aplicarea deciziei pe disc/torrent: redenumire prin API-ul
// qBittorrent (nu direct pe disc, altfel qBittorrent pierde evidența
// fișierului), scrierea unei subtitrări nou descărcate, conversie encoding
// la nevoie. Fiecare funcție de-aici mută/scrie ceva — deciziile ("ce fișier,
// ce sursă") se iau în subtitle-pipeline.ts.
// ---------------------------------------------------------------------------

import { basename, join } from "node:path";
import { qbitRenameFile, qbitSetFilePriority, type QbitFileInfo } from "../qbit-client";
import {
  decodeToUtf8Text,
  ensureUtf8SrtOnDisk,
  piecesOverlap,
  writeFileWithRetry,
} from "./subtitle-encoding";
import {
  SUBTITLE_SOURCE_LABELS,
  type SubtitleOutcome,
  type SubtitleSource,
} from "./subtitle-outcomes";
import type { SubtitleCandidate } from "./subtitle-sources";
import { describeSync, isWellSynced, type SyncMeasure } from "./subtitle-verify";

// Conținutul unei variante din rankSubtitleCandidates, ca text UTF-8 — null
// dacă descărcarea a eșuat. Nu scrie nimic: pipeline-ul compară întâi mai
// multe variante (subtitle-pipeline.ts), apoi o scrie pe cea aleasă.
export async function fetchCandidateText(
  candidate: SubtitleCandidate,
): Promise<{ text: string; wasConverted: boolean } | null> {
  const content = await candidate.getContent();
  if (!content) {
    console.warn(
      `[subtitles] descărcare ${SUBTITLE_SOURCE_LABELS[candidate.source]} eșuată pentru release „${candidate.release}"`,
    );
    return null;
  }
  return decodeToUtf8Text(content);
}

// Scrie pe disc varianta aleasă. Cu sincronizarea măsurată (fișierul are o
// subtitrare încorporată de comparat), ea decide dacă e o potrivire sigură
// sau „aproximativă" — numele release-ului contează doar fără măsurătoare.
export async function writeChosenSubtitle(
  chosen: SubtitleCandidate,
  destPath: string,
  fetched: { text: string; wasConverted: boolean },
  sync: SyncMeasure | null,
): Promise<{
  outcome: SubtitleOutcome;
  detail: string;
  matchedCriteria: number;
  maxCriteria: number;
  source: SubtitleSource;
}> {
  const sourceLabel = SUBTITLE_SOURCE_LABELS[chosen.source];
  const { matchedCriteria, maxCriteria } = chosen;
  const isPerfect = maxCriteria > 0 && matchedCriteria === maxCriteria;
  const confident = sync ? isWellSynced(sync) : chosen.confident;
  const syncNote = sync ? `; ${describeSync(sync)}` : "";
  const encodingNote = fetched.wasConverted ? " (encoding convertit la UTF-8)" : "";

  try {
    await writeFileWithRetry(destPath, fetched.text);
  } catch (e) {
    console.warn(`[subtitles] scriere .srt eșuată (${destPath}):`, e);
    return {
      outcome: "download_failed",
      detail: `scrierea subtitrării descărcate pe disk a eșuat: ${e instanceof Error ? e.message : e}`,
      matchedCriteria,
      maxCriteria,
      source: chosen.source,
    };
  }

  if (confident) {
    console.log(`[subtitles] subtitrare ${sourceLabel} salvată → ${destPath}`);
    const matchNote = isPerfect
      ? "potrivire perfectă"
      : sync
        ? `release ${matchedCriteria}/${maxCriteria} criterii`
        : `potrivire sursă+rezoluție confirmată, ${matchedCriteria}/${maxCriteria} criterii`;
    return {
      outcome: "downloaded",
      detail: `${isPerfect ? "subtitrare perfectă" : "subtitrare"} descărcată de pe ${sourceLabel}, release „${chosen.release}" (${matchNote}${syncNote})${encodingNote}`,
      matchedCriteria,
      maxCriteria,
      source: chosen.source,
    };
  }
  console.warn(
    `[subtitles] subtitrare aproximativă salvată (verifică sincronizarea) → ${destPath}`,
  );
  const why = sync ? describeSync(sync) : "fără potrivire clară de sursă/rezoluție";
  return {
    outcome: "downloaded_approximate",
    detail: `subtitrare aproximativă descărcată de pe ${sourceLabel}, release „${chosen.release}" (${matchedCriteria}/${maxCriteria} criterii — ${why}, verifică sincronizarea)${encodingNote}`,
    matchedCriteria,
    maxCriteria,
    source: chosen.source,
  };
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
export async function handleTrackedSrt(
  current: QbitFileInfo,
  targetSrtRelPath: string,
  mediaFilePieceRange: [number, number] | undefined,
  ctx: TrackedSrtContext,
): Promise<{ outcome: SubtitleOutcome; detail: string }> {
  const { qbitUrl, torrentHash, qbitUser, qbitPass, savePath } = ctx;
  const needsRename = current.name !== targetSrtRelPath;
  if (needsRename) {
    try {
      await qbitRenameFile(
        qbitUrl,
        torrentHash,
        current.name,
        targetSrtRelPath,
        qbitUser,
        qbitPass,
      );
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
    parts.push(
      `.srt redenumit → "${basename(targetSrtRelPath)}" (Plex îl recunoaște acum ca română)`,
    );
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
export async function handleSidecarSrt(
  sidecarAbsPath: string,
): Promise<{ outcome: SubtitleOutcome; detail: string }> {
  const wasReencoded = await ensureUtf8SrtOnDisk(sidecarAbsPath, async () => {});
  return {
    outcome: "srt_already_ok",
    detail: wasReencoded
      ? "are deja un .srt extern (descărcat anterior), acum convertit la UTF-8 — netrackuit de qBittorrent, nu mai caut din nou"
      : "are deja un .srt extern (descărcat anterior sau plasat manual), denumit și codat corect — netrackuit de qBittorrent, nu mai caut din nou",
  };
}

// Un .srt bundle-uit care nu pare română (vezi looksRomanian, subtitle-checks.ts)
// e redenumit .en, ca să nu fie preluat greșit de Plex ca subtitrare implicită
// — nu-l ștergem, doar îl scoatem din calea unde am scrie noi unul nou.
export async function renameToNonRomanian(
  srtFile: QbitFileInfo,
  mediaBaseName: string,
  mediaDir: string,
  ctx: { qbitUrl: string; torrentHash: string; qbitUser: string; qbitPass: string },
): Promise<void> {
  const nonRoTarget =
    mediaDir === "." ? `${mediaBaseName}.en.srt` : `${mediaDir}/${mediaBaseName}.en.srt`;
  if (srtFile.name === nonRoTarget) return;
  await qbitRenameFile(
    ctx.qbitUrl,
    ctx.torrentHash,
    srtFile.name,
    nonRoTarget,
    ctx.qbitUser,
    ctx.qbitPass,
  ).catch((e) => console.warn(`[subtitles] redenumire .srt non-RO eșuată:`, e));
}
