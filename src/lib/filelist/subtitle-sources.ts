// ---------------------------------------------------------------------------
// Pas 2 — alegerea celei mai bune subtitrări dintre cele două surse externe.
// Clienții propriu-ziși (căutare + descărcare HTTP) rămân separați, în
// opensubtitles-client.ts și subsro-client.ts — aici doar comparăm
// candidații deja obținuți de la ei și alegem câștigătorul, folosind
// scoring-ul comun din release-scoring.ts.
// ---------------------------------------------------------------------------

import { downloadSubtitle, type OpenSubtitlesResult } from "./opensubtitles-client";
import { pickBestByRelease } from "./release-scoring";

export interface SubtitleWinner {
  source: "opensubtitles" | "subsro";
  release: string;
  getContent: () => Promise<Buffer | null>;
  matchedCriteria: number;
  maxCriteria: number;
}

// Alege cea mai bună subtitrare disponibilă pentru un fișier țintă: întâi
// OpenSubtitles, apoi (doar dacă OpenSubtitles n-a dat o potrivire
// "confident" de sursă+rezoluție) subs.ro. `getSubsRoCandidates` e lazy —
// apelat doar dacă chiar e nevoie, ca să nu facem căutări/descărcări subs.ro
// inutile când OpenSubtitles are deja o potrivire bună.
export async function resolveBestSubtitle(
  targetName: string,
  osCandidates: OpenSubtitlesResult[],
  getSubsRoCandidates: () => Promise<Array<{ release: string; content: Buffer }>>,
): Promise<{ winner: SubtitleWinner; confident: boolean } | null> {
  let winner: SubtitleWinner | null = null;
  let winnerScore = -1;
  let winnerConfident = false;

  const osBest = pickBestByRelease(
    osCandidates,
    (r) => r.release,
    (r) => r.downloadCount,
    targetName,
  );
  if (osBest) {
    winner = {
      source: "opensubtitles",
      release: osBest.candidate.release,
      getContent: () => downloadSubtitle(osBest.candidate.fileId),
      matchedCriteria: osBest.matchedCriteria,
      maxCriteria: osBest.maxCriteria,
    };
    winnerScore = osBest.score;
    winnerConfident = osBest.confident;
  }

  if (!winnerConfident) {
    const subsRoCandidates = await getSubsRoCandidates();
    const subsRoBest = pickBestByRelease(
      subsRoCandidates,
      (e) => e.release,
      () => 0,
      targetName,
    );
    console.log(
      `[subtitles] „${targetName}" — OpenSubtitles: ${
        osBest
          ? `scor ${osBest.score} (release „${osBest.candidate.release}", confident=${osBest.confident})`
          : "fără candidați"
      }; subs.ro: ${
        subsRoCandidates.length === 0
          ? "0 candidați"
          : subsRoBest
            ? `scor ${subsRoBest.score} (release „${subsRoBest.candidate.release}", confident=${subsRoBest.confident}) din ${subsRoCandidates.length} candidați`
            : `niciun candidat scorat din ${subsRoCandidates.length} primiți`
      }`,
    );
    if (subsRoBest && subsRoBest.score > winnerScore) {
      const chosenContent = subsRoBest.candidate.content;
      winner = {
        source: "subsro",
        release: subsRoBest.candidate.release,
        getContent: async () => chosenContent,
        matchedCriteria: subsRoBest.matchedCriteria,
        maxCriteria: subsRoBest.maxCriteria,
      };
      winnerConfident = subsRoBest.confident;
    }
  }

  if (!winner) return null;
  return { winner, confident: winnerConfident };
}
