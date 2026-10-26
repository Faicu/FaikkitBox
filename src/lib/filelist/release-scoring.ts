// Cât de apropiat e numele unui release de fișierul țintă (rezoluție, sursă,
// platformă, codec, grup) — funcții pure, pentru alegerea subtitrării.

const RESOLUTION_TAGS = ["2160p", "1080p", "720p", "480p"];
// Sursa materialului, separată de platformă: „HULU.WEB-DL” și „AMZN.WEB-DL”
// au aceeași sursă, dar platforme diferite (amestecate, platforma era ignorată).
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
// Platforma de streaming — rip-uri de pe platforme diferite au adesea
// tăieturi și intro diferite.
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

// Tag ca token delimitat (nu substring — „MA” în alt cuvânt). Cratima internă
// („WEB-DL”) e opțională.
export function findTag(name: string, tags: string[]): string | null {
  for (const tag of tags) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/-/g, "-?");
    const re = new RegExp(`(?:^|[.\\s_-])${escaped}(?:[.\\s_-]|$)`, "i");
    if (re.test(name)) return tag;
  }
  return null;
}

// Codec cu separator opțional între literă și cifre („H264”, „H.264”, „H 264”
// — subs.ro pune spații în loc de puncte).
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

// Doar numele lansării: fără folderul din cale (pachete) și fără sufixul de
// subtitrare („-GRUP.ro.srt”) — grupul se ia din coadă. Iese și indiciul
// „ {imdb-tt…}” (plex-id-hint.ts). SUB_LANG_RE e sensibil la majuscule:
// codul de limbă e mereu mic, iar „Film.2026.WEB.srt” ar fi pierdut „.WEB”.
const MEDIA_EXT_RE = /\.(?:mkv|mp4|avi|m2ts|ts|wmv|mov)$/i;
const SUB_EXT_RE = /\.(?:srt|sub|ass|ssa)$/i;
const SUB_LANG_RE = /\.(?:[a-z]{2,3}|forced|sdh)$/;
const PLEX_ID_HINT_RE = /\s*\{(?:imdb|tmdb|tvdb)-[^}]*\}/gi;

export function releaseNameOf(name: string): string {
  let file = name;
  if (SUB_EXT_RE.test(file)) file = file.replace(SUB_EXT_RE, "").replace(SUB_LANG_RE, "");
  else if (MEDIA_EXT_RE.test(file)) file = file.replace(MEDIA_EXT_RE, "");
  // Folderul se taie doar din căi — un nume OpenSubtitles poate conține „/”.
  if (file !== name) file = file.split(/[\\/]/).pop() ?? file;
  return file.replace(PLEX_ID_HINT_RE, "").trim();
}

// Grup lipit de codec la coadă („…H.265FLUX”, subs.ro, 26 oct. 2026): fără
// despărțire nu se recunoșteau nici codecul, nici grupul. Doar după un codec.
const GLUED_CODEC_GROUP_RE =
  /((?:^|[.\s_-])(?:H[.\s_]?26[45]|x26[45]|HEVC|AV1|XviD|DivX))([A-Za-z][A-Za-z0-9]*)$/i;

// „MA” din „DTS-HD.MA” e Master Audio, nu platforma Movies Anywhere.
const DTS_MASTER_AUDIO_RE = /(DTS(?:[.\s_-]?HD)?)[.\s_-]MA(?=[.\s_-]|$)/gi;

function extractTags(rawName: string): ReleaseTags {
  const name = releaseNameOf(rawName).replace(GLUED_CODEC_GROUP_RE, "$1-$2");
  const resolution = findTag(name, RESOLUTION_TAGS);
  const acquisition = findTag(name, ACQUISITION_TAGS);
  const platform = findTag(name.replace(DTS_MASTER_AUDIO_RE, "$1"), PLATFORM_TAGS);
  const codec = findCodecTag(name);
  const groupMatch = name.match(/-([A-Za-z0-9]+)$/);
  const group = groupMatch ? groupMatch[1].toLowerCase() : null;
  return { resolution, acquisition, platform, codec, group };
}

export interface ScoredRelease<T> {
  candidate: T;
  score: number;
  confident: boolean;
  // Criteriile identificabile în numele țintei și câte s-au potrivit — scorul
  // „5/5” din UI, raportat la cele identificabile, nu la 5 fix.
  matchedCriteria: number;
  maxCriteria: number;
}

// Candidatul cu release-ul cel mai apropiat de fișier — o subtitrare pentru
// altă sursă desincronizează timpii. Același scor pentru OpenSubtitles și
// subs.ro, deci comparabil între surse. „confident” = rezoluție + sursă;
// platforma, codecul și grupul decid doar între candidați deja compatibili.
export function pickBestByRelease<T>(
  candidates: T[],
  releaseOf: (c: T) => string,
  popularityOf: (c: T) => number,
  targetName: string,
): ScoredRelease<T> | null {
  return rankByRelease(candidates, releaseOf, popularityOf, targetName)[0] ?? null;
}

// Toți candidații, de la cel mai apropiat (scor, apoi popularitate) — pentru
// când primul e respins la verificarea conținutului.
export function rankByRelease<T>(
  candidates: T[],
  releaseOf: (c: T) => string,
  popularityOf: (c: T) => number,
  targetName: string,
): ScoredRelease<T>[] {
  const target = extractTags(targetName);
  const maxCriteria = [
    target.resolution,
    target.acquisition,
    target.platform,
    target.codec,
    target.group,
  ].filter((t) => t !== null).length;

  const scored = candidates.map((c, index) => {
    const tags = extractTags(releaseOf(c) || "");
    const resMatch = !!target.resolution && tags.resolution === target.resolution;
    const acqMatch = !!target.acquisition && tags.acquisition === target.acquisition;
    const platformMatch = !!target.platform && tags.platform === target.platform;
    const codecMatch = !!target.codec && tags.codec === target.codec;
    const groupMatch = !!target.group && tags.group === target.group;
    // Ponderile urmăresc ce schimbă timpii: sursa (alt montaj) și grupul cel
    // mai mult, platforma mult, rezoluția și codecul aproape deloc (același
    // stream). Până pe 9 oct. 2026 rezoluția conta cel mai mult, iar The Invite
    // primea o variantă BluRay decalată cu ~3 s.
    const score =
      (acqMatch ? 3 : 0) +
      (groupMatch ? 3 : 0) +
      (platformMatch ? 2 : 0) +
      (resMatch ? 1 : 0) +
      (codecMatch ? 1 : 0);
    const matchedCriteria = [resMatch, acqMatch, platformMatch, codecMatch, groupMatch].filter(
      Boolean,
    ).length;
    return {
      candidate: c,
      score,
      confident: resMatch && acqMatch,
      matchedCriteria,
      maxCriteria,
      popularity: popularityOf(c),
      index,
    };
  });
  scored.sort((a, b) => b.score - a.score || b.popularity - a.popularity || a.index - b.index);
  return scored.map(({ candidate, score, confident, matchedCriteria, maxCriteria }) => ({
    candidate,
    score,
    confident,
    matchedCriteria,
    maxCriteria,
  }));
}
