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
import type { SubtitleOutcome } from "./subtitle-outcomes";
import type { SubtitleWinner } from "./subtitle-sources";

// Descarcă și scrie pe disc subtitrarea aleasă de resolveBestSubtitle,
// convertind la UTF-8 dacă e cazul.
export async function downloadAndWriteSubtitle(
  winner: SubtitleWinner,
  confident: boolean,
  destPath: string,
): Promise<{
  outcome: SubtitleOutcome;
  detail: string;
  matchedCriteria: number;
  maxCriteria: number;
}> {
  const sourceLabel = winner.source === "opensubtitles" ? "OpenSubtitles" : "subs.ro";
  const { matchedCriteria, maxCriteria } = winner;
  const isPerfect = maxCriteria > 0 && matchedCriteria === maxCriteria;
  const content = await winner.getContent();
  if (!content) {
    console.warn(`[subtitles] descărcare ${sourceLabel} eșuată pentru release „${winner.release}"`);
    return {
      outcome: "download_failed",
      detail: `descărcarea subtitrării de pe ${sourceLabel} (release „${winner.release}") a eșuat`,
      matchedCriteria,
      maxCriteria,
    };
  }

  try {
    const { text, wasConverted } = decodeToUtf8Text(content);
    await writeFileWithRetry(destPath, text);
    const encodingNote = wasConverted ? " (encoding convertit la UTF-8)" : "";
    if (confident) {
      console.log(`[subtitles] subtitrare ${sourceLabel} salvată → ${destPath}`);
      const matchNote = isPerfect
        ? "potrivire perfectă"
        : `potrivire sursă+rezoluție confirmată, ${matchedCriteria}/${maxCriteria} criterii`;
      return {
        outcome: "downloaded_opensubtitles",
        detail: `${isPerfect ? "subtitrare perfectă" : "subtitrare"} descărcată de pe ${sourceLabel}, release „${winner.release}" (${matchNote})${encodingNote}`,
        matchedCriteria,
        maxCriteria,
      };
    }
    console.warn(
      `[subtitles] subtitrare aproximativă salvată (verifică sincronizarea) → ${destPath}`,
    );
    return {
      outcome: "downloaded_opensubtitles_approximate",
      detail: `subtitrare aproximativă descărcată de pe ${sourceLabel}, release „${winner.release}" (${matchedCriteria}/${maxCriteria} criterii — fără potrivire clară de sursă/rezoluție, verifică sincronizarea)${encodingNote}`,
      matchedCriteria,
      maxCriteria,
    };
  } catch (e) {
    console.warn(`[subtitles] scriere .srt eșuată (${destPath}):`, e);
    return {
      outcome: "download_failed",
      detail: `scrierea subtitrării descărcate pe disk a eșuat: ${e instanceof Error ? e.message : e}`,
      matchedCriteria,
      maxCriteria,
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
