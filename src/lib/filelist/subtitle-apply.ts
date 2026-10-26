// Pasul 4 — aplicarea deciziei: redenumiri prin API-ul qBittorrent (direct pe
// disc, qBittorrent pierde evidența fișierului), scrierea subtitrării alese,
// conversia codării. Deciziile se iau în subtitle-pipeline.ts.

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
import { fileExists } from "./subtitle-checks";
import type { SubtitleCandidate } from "./subtitle-sources";
import { describeSync, isConfidentSync, type SyncMeasure } from "./subtitle-verify";

// O variantă ca text UTF-8 (null la eșec), fără scriere — pipeline-ul compară
// întâi mai multe.
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

// Scrie varianta aleasă. Sincronizarea măsurată decide dacă e sigură sau
// „aproximativă”; numele release-ului contează doar fără măsurătoare.
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
  const confident = sync ? isConfidentSync(sync, chosen) : chosen.confident;
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
  console.log(`[subtitles] subtitrare aproximativă salvată (verifică sincronizarea) → ${destPath}`);
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

// Un .srt urmărit de qBittorrent: redenumit prin API și convertit la UTF-8
// dacă e nevoie (exclus atunci de la seed).
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

// Un .srt scris anterior de aplicație (neurmărit de qBittorrent): doar codarea.
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

// Redenumire prin API, cu așteptare până pleacă fișierul de la vechea cale —
// qBittorrent mută asincron. Fără așteptare, pasul următor îl redenumea direct
// pe disc (qBittorrent îi pierdea urma) sau scria peste el. false = eșec sau
// fișierul n-a plecat la timp.
export async function moveTrackedSrt(
  relPath: string,
  newRelPath: string,
  ctx: TrackedSrtContext,
  attempts = 8,
  delayMs = 750,
): Promise<boolean> {
  if (relPath === newRelPath) return true;
  try {
    await qbitRenameFile(
      ctx.qbitUrl,
      ctx.torrentHash,
      relPath,
      newRelPath,
      ctx.qbitUser,
      ctx.qbitPass,
    );
  } catch (e) {
    console.warn(`[subtitles] redenumirea ${relPath} → ${newRelPath} eșuată:`, e);
    return false;
  }
  const absPath = join(ctx.savePath, relPath);
  for (let i = 0; i < attempts; i++) {
    if (!(await fileExists(absPath))) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  console.warn(`[subtitles] ${relPath} încă pe disc după redenumirea prin qBittorrent`);
  return false;
}

// Un .srt străin, nici român, nici englez: pus deoparte (`.respins`, ignorat de
// Plex), șters odată cu titlul.
export function moveAsideTrackedSrt(
  relPath: string,
  ctx: TrackedSrtContext,
  attempts?: number,
  delayMs?: number,
): Promise<boolean> {
  return moveTrackedSrt(relPath, `${relPath}.respins`, ctx, attempts, delayMs);
}

// Un .srt englez primește „.en”, ca Plex să nu-l ia drept implicit.
export function tagTrackedSrtEnglish(
  relPath: string,
  mediaBaseName: string,
  mediaDir: string,
  ctx: TrackedSrtContext,
): Promise<boolean> {
  const target =
    mediaDir === "." ? `${mediaBaseName}.en.srt` : `${mediaDir}/${mediaBaseName}.en.srt`;
  return moveTrackedSrt(relPath, target, ctx);
}
