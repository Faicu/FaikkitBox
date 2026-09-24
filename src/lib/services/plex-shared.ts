import { fetchJson, fetchText, errMsg, stripSlash } from "./shared";

// ---------------------------------------------------------------------------
// Tipuri și helpere partajate între modulele Plex (status/istoric, bibliotecă,
// discovery). Extras din fostul plex.ts monolitic.
// ---------------------------------------------------------------------------

export interface PlexConnectionCandidate {
  uri: string;
  source: string;
  priority: number;
}

export interface PlexStream {
  streamType?: number;
  decision?: string;
  language?: string;
  languageCode?: string;
  codec?: string;
  channels?: number;
  height?: number;
  displayTitle?: string;
  // Semnale HDR date direct de Plex, mai de încredere decât numele fișierului:
  // `colorTrc` e funcția de transfer ("smpte2084" = PQ/HDR10, "arib-std-b67" =
  // HLG), iar `DOVIPresent` marchează Dolby Vision. O lansare numită doar
  // „DV" — fără „HDR" în nume — nu se vede în filename, dar se vede aici.
  colorTrc?: string;
  DOVIPresent?: boolean;
}

export interface PlexMediaPart {
  file?: string;
  duration?: number;
  container?: string;
  decision?: string;
  Stream?: PlexStream[];
}

export interface PlexMedia {
  videoResolution?: string;
  bitrate?: number;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  container?: string;
  height?: number;
  Part?: PlexMediaPart[];
}

// Prezent doar când Plex chiar transcodează/remuxează sesiunea.
export interface PlexTranscodeSession {
  videoDecision?: string;
  audioDecision?: string;
  subtitleDecision?: string;
  sourceVideoCodec?: string;
  sourceAudioCodec?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  container?: string;
  throttled?: boolean;
  transcodeHwRequested?: boolean;
  transcodeHwFullPipeline?: boolean;
}

export interface PlexMetadataItem {
  ratingKey?: string;
  key?: string;
  title?: string;
  // Titlul original, când Plex afișează altul (biblioteca e în română).
  originalTitle?: string;
  type?: string;
  index?: number;
  parentIndex?: number;
  grandparentTitle?: string;
  year?: number;
  originallyAvailableAt?: string;
  addedAt?: number;
  viewCount?: number;
  lastViewedAt?: number;
  duration?: number;
  viewOffset?: number;
  thumb?: string;
  accountID?: number;
  viewedAt?: number;
  summary?: string;
  Media?: PlexMedia[];
  // Identificatori externi (imdb/tmdb/tvdb) — fiabili pentru filme
  // ("imdb://tt..." mereu prezent la agentul nou), dar NU pentru
  // seriale/episoade (de regulă doar tmdb/tvdb, fără imdb).
  Guid?: Array<{ id?: string }>;
  User?: { title?: string };
  Player?: { title?: string; device?: string; product?: string; state?: string };
  TranscodeSession?: PlexTranscodeSession;
  Session?: { bandwidth?: number; location?: string };
}

export interface PlexDirectory {
  key?: string;
  title?: string;
  type?: string;
}

export interface PlexAccount {
  id?: number;
  name?: string;
  title?: string;
}

export interface PlexApiResponse {
  MediaContainer?: {
    Metadata?: PlexMetadataItem[];
    Directory?: PlexDirectory[];
    Account?: PlexAccount[];
    totalSize?: number;
    friendlyName?: string;
    version?: string;
    platform?: string;
  };
}

export function normalizeShowTitle(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

// Toate calitățile pe care Plex le are pentru un item, nu doar prima.
//
// Un film poate exista în mai multe versiuni sub același item Plex (4K HDR +
// 1080p). Citind doar `Media[0]`, wizard-ul credea că ai o singură calitate —
// și-ți oferea „upgrade" la una pe care deja o aveai, adică o a treia
// descărcare. Ordinea e cea dată de Plex; duplicatele se elimină.
export function plexQualitiesFromItem(item: { Media?: PlexMedia[] } | undefined): string[] {
  const all = (item?.Media ?? []).map((m) => plexQualityFromMedia(m)).filter((q) => q !== null);
  return [...new Set(all)];
}

// Care dintre versiunile Plex ale unui item e fișierul nostru.
//
// `contentPath` vine din qBittorrent (`qbitContentPath`) și e calea reală de pe
// disk — se potrivește caracter cu caracter cu `Part.file` din Plex, fiindcă
// ambele descriu același fișier. Prima încercare de potrivire folosea
// `torrent_name` din `media`, și a eșuat exact pe cazul pentru care a fost
// scrisă: torrentul se numea pe Filelist
// „Avatar.Fire.and.Ash.2025.Hybrid.1080p...DoVi.HDR.x265-HiDt", iar pe disk
// „Avatar Fire and Ash 2025 Hybrid 1080p ... DV HDR10P x265-HiDt.mkv".
// Numele de pe tracker nu e o sursă de adevăr pentru disk.
//
// `torrentName` rămâne doar ca rezervă, pentru cazul în care torrentul nu mai
// e în qBittorrent (șters manual după descărcare).
//
// Întoarce `undefined` când nu se potrivește nimic — apelantul NU trebuie să
// cadă atunci pe `Media[0]`: ar afișa calitatea celeilalte versiuni ca fapt.
// Mai bine fără calitate decât cu una greșită (aceeași regulă ca la
// qualityRank din wizard).
export function plexMediaForPath(
  item: { Media?: PlexMedia[] } | undefined,
  contentPath: string | null,
  torrentName: string | null,
): PlexMedia | undefined {
  const media = item?.Media ?? [];
  if (media.length === 0) return undefined;
  // Un singur fișier pe item — nu e nimic de distins, e al nostru.
  if (media.length === 1) return media[0];

  const files = (m: PlexMedia): string[] => (m.Part ?? []).map((part) => part.file ?? "");

  if (contentPath) {
    const needle = contentPath.replace(/\/$/, "");
    // Fișier unic: egalitate. Torrent cu folder: `Part.file` e înăuntru.
    const hit = media.find((m) => files(m).some((f) => f === needle || f.startsWith(`${needle}/`)));
    if (hit) return hit;
  }

  if (torrentName) {
    const hit = media.find((m) => files(m).some((f) => f.includes(torrentName)));
    if (hit) return hit;
  }
  return undefined;
}

export function plexQualityFromMedia(media: PlexMedia | undefined): string | null {
  const res: string | undefined = media?.videoResolution;
  if (!res) return null;
  // Plex trimite când "1080", când "1080p", în funcție de endpoint.
  const r = String(res).toLowerCase().replace(/p$/, "");
  const is4k = r === "4k" || r === "2160";
  const isHdr = mediaIsHdr(media);
  if (is4k) return isHdr ? "4K HDR" : "4K";
  if (r === "1080") return isHdr ? "1080p HDR" : "1080p";
  if (r === "720") return "720p";
  return `${r}p`;
}

// HDR-ul unei versiuni, din tot ce spune Plex despre ea.
//
// Numele fișierului singur nu ajunge: „...DV HDR10P..." se prinde, dar o
// lansare marcată doar „DV" nu. Stream-ul video poartă însă datele reale —
// `colorTrc`, `DOVIPresent` și `displayTitle` ("1080p DoVi/HDR10+").
function mediaIsHdr(media: PlexMedia | undefined): boolean {
  const video = (media?.Part?.[0]?.Stream ?? []).find((st) => st.streamType === 1);
  if (video?.DOVIPresent) return true;
  // smpte2084 = PQ (HDR10/HDR10+/DoVi), arib-std-b67 = HLG.
  if (/smpte2084|arib-std-b67/i.test(video?.colorTrc ?? "")) return true;
  if (isHdrLabel(video?.displayTitle)) return true;
  return isHdrLabel(media?.Part?.[0]?.file ?? "");
}

// DoVi/HDR10/HLG apar fie în numele fișierului, fie în `displayTitle`-ul
// stream-ului video ("4K DoVi/HDR10 (HEVC Main 10)").
export function isHdrLabel(value: string | undefined): boolean {
  return /dovi|dolby\s*vision|hdr10|hdr|hlg|pq/i.test(value ?? "");
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attrs[match[1]] = match[2].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  }
  return attrs;
}

function uniqueCandidates(candidates: PlexConnectionCandidate[]): PlexConnectionCandidate[] {
  const seen = new Set<string>();
  return candidates
    .filter((c) => {
      const uri = stripSlash(c.uri);
      if (!uri || seen.has(uri)) return false;
      seen.add(uri);
      c.uri = uri;
      return true;
    })
    .sort((a, b) => a.priority - b.priority);
}

function parsePlexResources(payload: string): PlexConnectionCandidate[] {
  const candidates: PlexConnectionCandidate[] = [];

  try {
    const data = JSON.parse(payload);
    const devices = data?.MediaContainer?.Device ?? data?.devices ?? [];
    const deviceList = Array.isArray(devices) ? devices : [devices];
    for (const device of deviceList) {
      const provides = String(device?.provides ?? "");
      if (!provides.includes("server")) continue;
      const connections = Array.isArray(device?.Connection)
        ? device.Connection
        : Array.isArray(device?.connections)
          ? device.connections
          : [];
      for (const conn of connections) {
        const uri = String(conn?.uri ?? "");
        if (!uri) continue;
        const protocol = String(conn?.protocol ?? (uri.startsWith("https:") ? "https" : "http"));
        const isPlexDirect = uri.includes("plex.direct");
        const isRelay = String(conn?.relay ?? "0") === "1";
        candidates.push({
          uri,
          source: isRelay ? "Plex Relay" : isPlexDirect ? "Plex Direct" : "Plex resource",
          priority:
            protocol === "https" && isPlexDirect && !isRelay
              ? 0
              : protocol === "https" && !isRelay
                ? 1
                : protocol === "http" && !isRelay
                  ? 2
                  : 3,
        });
      }
    }
    return uniqueCandidates(candidates);
  } catch {
    // Plex's resources endpoint often returns XML, so fall through to XML parsing.
  }

  const deviceMatches = payload.matchAll(/<Device\b([^>]*)>([\s\S]*?)<\/Device>/g);
  for (const deviceMatch of deviceMatches) {
    const deviceAttrs = parseAttributes(deviceMatch[1]);
    if (!String(deviceAttrs.provides ?? "").includes("server")) continue;

    const connectionMatches = deviceMatch[2].matchAll(
      /<Connection\b([^>]*)(?:\/>|>[\s\S]*?<\/Connection>)/g,
    );
    for (const connectionMatch of connectionMatches) {
      const conn = parseAttributes(connectionMatch[1]);
      const uri = conn.uri;
      if (!uri) continue;
      const protocol = conn.protocol ?? (uri.startsWith("https:") ? "https" : "http");
      const isPlexDirect = uri.includes("plex.direct");
      const isRelay = conn.relay === "1";
      candidates.push({
        uri,
        source: isRelay ? "Plex Relay" : isPlexDirect ? "Plex Direct" : "Plex resource",
        priority:
          protocol === "https" && isPlexDirect && !isRelay
            ? 0
            : protocol === "https" && !isRelay
              ? 1
              : protocol === "http" && !isRelay
                ? 2
                : 3,
      });
    }
  }

  return uniqueCandidates(candidates);
}

let plexDiscoveryCache: { url: string; source: string; expiresAt: number } | null = null;

export async function discoverPlexUrl(
  token: string,
  fallbackBase?: string,
): Promise<{ url: string; source: string; attempts: string[] }> {
  if (plexDiscoveryCache && plexDiscoveryCache.expiresAt > Date.now()) {
    return { url: plexDiscoveryCache.url, source: plexDiscoveryCache.source, attempts: [] };
  }

  const headers = {
    Accept: "application/json, application/xml;q=0.9, text/xml;q=0.8",
    "X-Plex-Token": token,
  };
  const attempts: string[] = [];
  const resourcesText = await fetchText(
    "https://plex.tv/api/resources?includeHttps=1&includeRelay=1",
    { headers },
    10000,
  );
  const candidates = parsePlexResources(resourcesText);

  if (fallbackBase) {
    // Prioritate -1: se încearcă PRIMA, înaintea adreselor de la plex.tv.
    //
    // Era 10 (ultima), iar adresele https plex.direct aveau 0 — deci serverul
    // vorbea cu Plex-ul din aceeași rețea printr-un hostname plex.direct,
    // rezolvat prin DNS și cu handshake TLS la fiecare cerere. Măsurat pe
    // /status/sessions: ~539ms prin plex.direct vs ~0.4ms direct pe LAN.
    // De peste 1000× mai lent, pentru o cutie care stă lângă Plex.
    //
    // Rămâne doar o preferință, nu o obligație: bucla de mai jos validează
    // fiecare candidat înainte să-l accepte, deci dacă PLEX_URL e greșit sau
    // serverul s-a mutat, se cade automat pe descoperirea de la plex.tv, ca
    // înainte.
    candidates.push({
      uri: stripSlash(fallbackBase),
      source: "PLEX_URL configurat (local)",
      priority: -1,
    });
  }

  if (candidates.length === 0) {
    throw new Error("No Plex server connections found for this token");
  }

  for (const candidate of uniqueCandidates(candidates)) {
    try {
      await fetchJson<PlexApiResponse>(`${candidate.uri}/`, { headers }, 5000);
      plexDiscoveryCache = {
        url: candidate.uri,
        source: candidate.source,
        expiresAt: Date.now() + 5 * 60 * 1000,
      };
      return { url: candidate.uri, source: candidate.source, attempts };
    } catch (e) {
      attempts.push(`${candidate.source} ${candidate.uri}: ${errMsg(e)}`);
    }
  }

  throw new Error(`No reachable Plex connection. Tried: ${attempts.join(" | ")}`);
}
