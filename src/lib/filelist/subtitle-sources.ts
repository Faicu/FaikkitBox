// ---------------------------------------------------------------------------
// Pas 2 — alegerea celei mai bune subtitrări dintre cele două surse externe.
// Clienții propriu-ziși (căutare + descărcare HTTP) rămân separați, în
// opensubtitles-client.ts și subsro-client.ts — aici doar comparăm
// candidații deja obținuți de la ei și alegem câștigătorul, folosind
// scoring-ul comun din release-scoring.ts.
// ---------------------------------------------------------------------------

import { downloadSubtitle, type OpenSubtitlesResult } from "./opensubtitles-client";
import { pickBestByRelease } from "./release-scoring";
import { osResultMatchesEpisode } from "./subtitle-checks";
import { subsRoEntryEpisodeKey, type SubsRoSrtEntry } from "./subsro-client";

export interface SubtitleWinner {
  source: "opensubtitles" | "subsro";
  release: string;
  getContent: () => Promise<Buffer | null>;
  matchedCriteria: number;
  maxCriteria: number;
}

// Pentru un episod (`episodeKey` nenul) rămân doar candidații care sunt
// sigur ai lui — filtrul stă aici, nu la apelanți, ca să nu existe cale prin
// care o subtitrare a altui episod să ajungă la scorare (MobLand S02E02/E03
// primiseră subtitrarea lui E01, vezi subtitle-verify.ts). Filmele
// (`episodeKey` null) rămân nefiltrate.
//
// Alege cea mai bună subtitrare disponibilă pentru un fișier țintă, din
// ambele surse. La scor egal câștigă subs.ro (decizia userului, 9 oct. 2026):
// acolo traduc traducători români, iar pe OpenSubtitles apar și traduceri
// automate nemarcate ca AI — MobLand S02E03 de la ss_valis avea exact
// replicile și timpii englezei din fișier și notele muzicale netraduse, deși
// subs.ro avea traducerea SubRip pentru același release. Înainte, subs.ro
// era întrebat doar dacă OpenSubtitles n-avea o potrivire „confident", deci
// nici nu ajungea în comparație. OpenSubtitles câștigă doar cu un release
// strict mai apropiat de fișier.
export async function resolveBestSubtitle(
  targetName: string,
  episodeKey: string | null,
  allOsCandidates: OpenSubtitlesResult[],
  getSubsRoCandidates: () => Promise<SubsRoSrtEntry[]>,
): Promise<{ winner: SubtitleWinner; confident: boolean } | null> {
  const osCandidates = episodeKey
    ? allOsCandidates.filter((r) => osResultMatchesEpisode(r, episodeKey))
    : allOsCandidates;
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

  const subsRoCandidates = (await getSubsRoCandidates()).filter(
    (e) => !episodeKey || subsRoEntryEpisodeKey(e) === episodeKey,
  );
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
  if (subsRoBest && subsRoBest.score >= winnerScore) {
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

  if (!winner) return null;
  return { winner, confident: winnerConfident };
}
