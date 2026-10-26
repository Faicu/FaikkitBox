// Pasul 2 — ordonarea candidaților de pe cele două surse (clienții HTTP sunt
// separați), cu scorul din release-scoring.ts. Pipeline-ul îi încearcă în
// ordine până trece unul verificarea conținutului.

import { createHash } from "node:crypto";
import { downloadSubtitle, type OpenSubtitlesResult } from "./opensubtitles-client";
import { rankByRelease } from "./release-scoring";
import { looksRomanian, osResultMatchesEpisode } from "./subtitle-checks";
import { decodeToUtf8Text } from "./subtitle-encoding";
import { subsRoEntryEpisodeKey, type SubsRoSrtEntry } from "./subsro-client";

export interface SubtitleCandidate {
  source: "opensubtitles" | "subsro";
  release: string;
  getContent: () => Promise<Buffer | null>;
  matchedCriteria: number;
  maxCriteria: number;
  score: number;
  confident: boolean;
}

// Variante OpenSubtitles încercate cel mult: fiecare consumă o descărcare din
// cele 20 pe zi. Cele subs.ro sunt deja descărcate, deci se încearcă toate.
const MAX_OS_ATTEMPTS = 3;

// La un episod rămân doar candidații sigur ai lui — filtrul e aici, ca nicio
// cale să nu ducă subtitrarea altui episod la scorare. Filmele, nefiltrate.
// La scor egal, subs.ro înaintea OpenSubtitles (decizia userului, 9 oct.
// 2026): traducători români, pe când OpenSubtitles are și traduceri automate
// nemarcate (MobLand S02E03).
export async function rankSubtitleCandidates(
  targetName: string,
  episodeKey: string | null,
  allOsCandidates: OpenSubtitlesResult[],
  getSubsRoCandidates: () => Promise<SubsRoSrtEntry[]>,
): Promise<SubtitleCandidate[]> {
  const osCandidates = episodeKey
    ? allOsCandidates.filter((r) => osResultMatchesEpisode(r, episodeKey))
    : allOsCandidates;
  const osRanked = rankByRelease(
    osCandidates,
    (r) => r.release,
    (r) => r.downloadCount,
    targetName,
  ).slice(0, MAX_OS_ATTEMPTS);

  // Doar fișierele chiar în română, după conținut: pe subs.ro unii pun
  // originalul în engleză cu numele exact al release-ului, care câștiga
  // scorarea (patru titluri cu `.ro.srt` în engleză, audit 9 oct. 2026).
  const subsRoCandidates = (await getSubsRoCandidates()).filter(
    (e) =>
      (!episodeKey || subsRoEntryEpisodeKey(e) === episodeKey) &&
      looksRomanian(decodeToUtf8Text(e.content).text),
  );
  // Fișierele identice (aceeași traducere sub mai multe release-uri) contează o
  // dată, sub numele cel mai apropiat.
  const seen = new Set<string>();
  const subsRoRanked = rankByRelease(
    subsRoCandidates,
    (e) => e.release,
    () => 0,
    targetName,
  ).filter((r) => {
    const hash = createHash("sha1").update(r.candidate.content).digest("hex");
    if (seen.has(hash)) return false;
    seen.add(hash);
    return true;
  });

  const describe = (r: { score: number; confident: boolean }, release: string) =>
    `scor ${r.score} (release „${release}", confident=${r.confident})`;
  console.log(
    `[subtitles] „${targetName}" — OpenSubtitles: ${
      osRanked.length ? describe(osRanked[0], osRanked[0].candidate.release) : "fără candidați"
    }; subs.ro: ${
      subsRoRanked.length
        ? `${describe(subsRoRanked[0], subsRoRanked[0].candidate.release)}, ${subsRoRanked.length} variante distincte`
        : "0 candidați"
    }`,
  );

  const all: SubtitleCandidate[] = [
    ...subsRoRanked.map((r) => ({
      source: "subsro" as const,
      release: r.candidate.release,
      getContent: async () => r.candidate.content,
      matchedCriteria: r.matchedCriteria,
      maxCriteria: r.maxCriteria,
      score: r.score,
      confident: r.confident,
    })),
    ...osRanked.map((r) => ({
      source: "opensubtitles" as const,
      release: r.candidate.release,
      getContent: () => downloadSubtitle(r.candidate.fileId),
      matchedCriteria: r.matchedCriteria,
      maxCriteria: r.maxCriteria,
      score: r.score,
      confident: r.confident,
    })),
  ];
  // Sortare stabilă: la scor egal, subs.ro înainte.
  return all.sort((a, b) => b.score - a.score);
}
