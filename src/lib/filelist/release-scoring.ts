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

// Doar numele lansării, din ce primim efectiv: la pachete ținta e calea
// fișierului din torrent ("Folder/Serial.S01E01...-GRUP.mkv"), iar candidații
// subs.ro sunt nume de fișiere din arhivă ("...-GRUP.ro.srt"). Grupul se ia
// din coada numelui, deci fără curățarea asta nu se potrivea niciodată pe
// astfel de nume. Tot aici iese și indiciul de ID pentru Plex
// (" {imdb-tt…}", vezi plex-id-hint.ts), pus înaintea extensiei.
//
// Codul de limbă dinaintea extensiei de subtitrare e mereu cu litere mici
// („.ro.srt", „.eng.srt") — de aceea SUB_LANG_RE e sensibil la majuscule:
// altfel s-ar fi dus și tag-uri reale („Film.2026.WEB.srt" pierdea „.WEB").
const MEDIA_EXT_RE = /\.(?:mkv|mp4|avi|m2ts|ts|wmv|mov)$/i;
const SUB_EXT_RE = /\.(?:srt|sub|ass|ssa)$/i;
const SUB_LANG_RE = /\.(?:[a-z]{2,3}|forced|sdh)$/;
const PLEX_ID_HINT_RE = /\s*\{(?:imdb|tmdb|tvdb)-[^}]*\}/gi;

export function releaseNameOf(name: string): string {
  let file = name;
  if (SUB_EXT_RE.test(file)) file = file.replace(SUB_EXT_RE, "").replace(SUB_LANG_RE, "");
  else if (MEDIA_EXT_RE.test(file)) file = file.replace(MEDIA_EXT_RE, "");
  // Folderul se taie doar din căi de fișier — un nume de lansare de la
  // OpenSubtitles poate conține „/" fără să fie o cale.
  if (file !== name) file = file.split(/[\\/]/).pop() ?? file;
  return file.replace(PLEX_ID_HINT_RE, "").trim();
}

function extractTags(rawName: string): ReleaseTags {
  const name = releaseNameOf(rawName);
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
  return rankByRelease(candidates, releaseOf, popularityOf, targetName)[0] ?? null;
}

// Toți candidații, de la cel mai apropiat de fișier la cel mai îndepărtat
// (scor, apoi popularitate; la egalitate deplină rămâne ordinea primită) —
// pentru când primul e respins la verificarea conținutului și trebuie
// încercat următorul (subtitle-pipeline.ts).
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
    // Ponderile urmăresc ce schimbă timpii subtitrării: sursa (WEB-DL față
    // de BluRay — alt montaj, alte logouri la început) și grupul (aceeași
    // codare) contează cel mai mult, platforma (AMZN/HULU…) mult, rezoluția
    // și codecul aproape deloc — același stream la 1080p sau 2160p are
    // aceiași timpi. Până pe 9 oct. 2026 rezoluția valora cel mai mult, iar
    // The Invite (1080p AMZN WEB-DL) a primit o variantă BluRay 1080p
    // decalată cu ~3 s în locul uneia WEB-DL 2160p fără decalaj.
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
