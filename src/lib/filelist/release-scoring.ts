// ---------------------------------------------------------------------------
// Potrivire "cât de apropiat e numele unui release de fișierul media țintă" —
// rezoluție, mod de obținere (WEB-DL/BluRay/...), platformă (HULU/AMZN/...),
// codec și grup de release. Extras din subtitles.ts: complet independent
// funcțional (funcții pure, fără I/O), folosit acolo pentru alegerea celei
// mai bune subtitrări dintre mai mulți candidați (OpenSubtitles/subs.ro).
// ---------------------------------------------------------------------------

const RESOLUTION_TAGS = ["2160p", "1080p", "720p", "480p"];
// Modul de obținere a materialului (rip/encode), distinct de platforma de
// streaming — un torrent "HULU.WEB-DL" și unul "AMZN.WEB-DL" au același mod
// de obținere, dar sunt surse diferite; înainte erau amestecate într-o
// singură listă, ceea ce făcea ca platforma să fie complet ignorată.
const ACQUISITION_TAGS = [
  "WEB-DL",
  "WEBDL",
  "WEBRip",
  "BluRay",
  "BDRip",
  "BRRip",
  "HDTV",
  "DVDRip",
  "REMUX",
];
// Platforma/serviciul de streaming de unde provine fișierul — la fel de
// importantă ca modul de obținere pentru sincronizare (rip-uri diferite de
// pe platforme diferite au adesea tăieturi/intro diferite).
const PLATFORM_TAGS = [
  "AMZN",
  "NF",
  "DSNP",
  "HMAX",
  "MAX",
  "ATVP",
  "HULU",
  "PCOK",
  "STAN",
  "iT",
  "MA",
  "SHO",
  "CRAV",
];
const CODEC_TAGS = ["H264", "x264", "H265", "x265", "HEVC", "AV1", "XviD", "DivX"];

// Caută un tag dintr-o listă ca token delimitat (punct/underscore/cratimă/
// spațiu la ambele capete, sau începutul/sfârșitul numelui) — evită
// potriviri false pe substring (ex. "MA" în interiorul altui cuvânt).
// Cratima internă a unor tag-uri (ex. "WEB-DL") e opțională, ca să prindă și
// varianta fără cratimă ("WEBDL"), deja listată separat oricum.
export function findTag(name: string, tags: string[]): string | null {
  for (const tag of tags) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/-/g, "-?");
    const re = new RegExp(`(?:^|[.\\s_-])${escaped}(?:[.\\s_-]|$)`, "i");
    if (re.test(name)) return tag;
  }
  return null;
}

// Codec-urile pot apărea cu separator opțional între literă și cifre —
// "H264", "H.264" sau "H 264" (subs.ro normalizează descrierile cu spații în
// loc de puncte, ex. "The Invite 2026 1080p AMZN WEB-DL DDP5 1 H 264-BYNDR")
// — deci, spre deosebire de findTag, inserăm un separator opțional exact la
// granița literă/cifră, nu doar la capetele tag-ului.
function findCodecTag(name: string): string | null {
  for (const tag of CODEC_TAGS) {
    const parts = tag
      .split(/(?<=[A-Za-z])(?=[0-9])|(?<=[0-9])(?=[A-Za-z])/)
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const escaped = parts.join("[.\\s_-]?");
    const re = new RegExp(`(?:^|[.\\s_-])${escaped}(?:[.\\s_-]|$)`, "i");
    if (re.test(name)) return tag;
  }
  return null;
}

interface ReleaseTags {
  resolution: string | null;
  acquisition: string | null;
  platform: string | null;
  codec: string | null;
  group: string | null;
}

function extractTags(name: string): ReleaseTags {
  const resolution = findTag(name, RESOLUTION_TAGS);
  const acquisition = findTag(name, ACQUISITION_TAGS);
  const platform = findTag(name, PLATFORM_TAGS);
  const codec = findCodecTag(name);
  const groupMatch = name.match(/-([A-Za-z0-9]+)$/);
  const group = groupMatch ? groupMatch[1].toLowerCase() : null;
  return { resolution, acquisition, platform, codec, group };
}

export interface ScoredRelease<T> {
  candidate: T;
  score: number;
  confident: boolean;
  // Criterii (din rezoluție/mod obținere/platformă/codec/grup) aplicabile
  // pentru fișierul țintă (adică pentru care numele lui conține un tag
  // identificabil) și câte dintre ele s-au potrivit — folosit pentru afișarea
  // unui scor gen "5/5" în UI. `matchedCriteria` din `maxCriteria`, nu din 5
  // fix, ca să nu pară o potrivire imperfectă atunci când fișierul țintă pur
  // și simplu nu conține un anume tag (ex. fără platformă în nume).
  matchedCriteria: number;
  maxCriteria: number;
}

// Alege, dintr-o listă de candidați (rezultate OpenSubtitles, variante dintr-o
// arhivă subs.ro etc.), pe cel al cărui nume de release se potrivește cel mai
// bine cu numele fișierului media — rezoluție, mod de obținere (WEB-DL/
// BluRay/...), platformă (HULU/AMZN/...), codec și grup de release — ca
// subtitrarea aleasă să fie identică sau cât mai apropiată de fișier, nu doar
// "compatibilă" (o subtitrare pentru altă sursă/calitate desincronizează
// timpii de afișare). Generic — folosit atât pentru OpenSubtitles cât și
// pentru subs.ro, ca scorul unui candidat de la o sursă să poată fi comparat
// direct cu scorul unui candidat de la cealaltă sursă.
//
// "confident" rămâne definit strict pe rezoluție+mod de obținere (cele mai
// relevante pentru sincronizare); platformă/codec/grup contează doar pentru
// alegerea între mai mulți candidați deja compatibili, ca să câștige cel mai
// apropiat de numele exact al fișierului.
export function pickBestByRelease<T>(
  candidates: T[],
  releaseOf: (c: T) => string,
  popularityOf: (c: T) => number,
  targetName: string,
): ScoredRelease<T> | null {
  if (!candidates.length) return null;

  const target = extractTags(targetName);
  const maxCriteria = [target.resolution, target.acquisition, target.platform, target.codec, target.group].filter(
    (t) => t !== null,
  ).length;

  let best: T | null = null;
  let bestScore = -1;
  let bestConfident = false;
  let bestMatchedCriteria = 0;
  let bestPopularity = -Infinity;

  for (const c of candidates) {
    const tags = extractTags(releaseOf(c) || "");
    let score = 0;
    let matchedCriteria = 0;
    const resMatch = !!target.resolution && tags.resolution === target.resolution;
    const acqMatch = !!target.acquisition && tags.acquisition === target.acquisition;
    const platformMatch = !!target.platform && tags.platform === target.platform;
    const codecMatch = !!target.codec && tags.codec === target.codec;
    const groupMatch = !!target.group && tags.group === target.group;
    if (resMatch) {
      score += 3;
      matchedCriteria++;
    }
    if (acqMatch) {
      score += 2;
      matchedCriteria++;
    }
    if (platformMatch) {
      score += 2;
      matchedCriteria++;
    }
    if (codecMatch) {
      score += 1;
      matchedCriteria++;
    }
    if (groupMatch) {
      score += 2;
      matchedCriteria++;
    }

    const popularity = popularityOf(c);
    if (score > bestScore || (score === bestScore && popularity > bestPopularity)) {
      best = c;
      bestScore = score;
      bestConfident = resMatch && acqMatch;
      bestMatchedCriteria = matchedCriteria;
      bestPopularity = popularity;
    }
  }

  if (!best) return null;
  return {
    candidate: best,
    score: bestScore,
    confident: bestConfident,
    matchedCriteria: bestMatchedCriteria,
    maxCriteria,
  };
}
