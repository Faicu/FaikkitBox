// ---------------------------------------------------------------------------
// Pas 2 — ordonarea subtitrărilor găsite pe cele două surse externe.
// Clienții propriu-ziși (căutare + descărcare HTTP) rămân separați, în
// opensubtitles-client.ts și subsro-client.ts — aici doar filtrăm și ordonăm
// candidații deja obținuți de la ei, folosind scoring-ul comun din
// release-scoring.ts. Pipeline-ul (subtitle-pipeline.ts) îi încearcă în
// ordine, până când unul trece verificarea conținutului.
// ---------------------------------------------------------------------------

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

// Câte variante de pe OpenSubtitles încercăm cel mult pentru un fișier:
// fiecare consumă o descărcare din limita zilnică a contului (20), iar una
// respinsă la verificare e o descărcare pierdută. Variantele subs.ro nu
// costă nimic în plus — arhivele sunt deja descărcate când ajungem aici —
// deci se încearcă toate.
const MAX_OS_ATTEMPTS = 3;

// Pentru un episod (`episodeKey` nenul) rămân doar candidații care sunt
// sigur ai lui — filtrul stă aici, nu la apelanți, ca să nu existe cale prin
// care o subtitrare a altui episod să ajungă la scorare (MobLand S02E02/E03
// primiseră subtitrarea lui E01, vezi subtitle-verify.ts). Filmele
// (`episodeKey` null) rămân nefiltrate.
//
// Ordinea: scorul release-ului față de fișier, iar la scor egal subs.ro
// înaintea OpenSubtitles (decizia userului, 9 oct. 2026): acolo traduc
// traducători români, iar pe OpenSubtitles apar și traduceri automate
// nemarcate ca AI — MobLand S02E03 de la ss_valis avea exact replicile și
// timpii englezei din fișier și notele muzicale netraduse, deși subs.ro avea
// traducerea SubRip pentru același release.
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

  // Doar fișierele chiar în română: pe subs.ro unii uploaderi (în special
  // „R.") pun subtitrarea originală în engleză, marcată „en", cu numele exact
  // al release-ului — deci câștiga scorarea. Așa au primit Fall 2, The
  // Invite, Teenage Sex… și Mutiny un `.ro.srt` în engleză (audit 9 oct.
  // 2026). Decidem după conținut, nu după eticheta de limbă: o arhivă poate
  // avea un fișier în fiecare limbă.
  const subsRoCandidates = (await getSubsRoCandidates()).filter(
    (e) =>
      (!episodeKey || subsRoEntryEpisodeKey(e) === episodeKey) &&
      looksRomanian(decodeToUtf8Text(e.content).text),
  );
  // Fișierele identice (aceeași traducere copiată în arhivă pentru fiecare
  // release) contează o singură dată, sub numele cel mai apropiat de fișier —
  // una respinsă ar fi respinsă la fel și sub alt nume.
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
  // Sortare stabilă: la scor egal rămâne subs.ro înainte, apoi ordinea din
  // fiecare sursă.
  return all.sort((a, b) => b.score - a.score);
}
