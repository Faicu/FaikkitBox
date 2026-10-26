import { fetchJson, fetchText, errMsg, stripSlash } from "./shared";

// Tipuri și helpere comune modulelor Plex.

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
  // Semnalele HDR date de Plex, mai sigure decât numele fișierului: `colorTrc`
  // ("smpte2084" = PQ/HDR10, "arib-std-b67" = HLG) și `DOVIPresent` (Dolby
  // Vision) — un „DV” fără „HDR” în nume se vede aici.
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
  // Posterul serialului la episoade (`thumb` e cadrul episodului) și fundalurile
  // — pentru cardul „în redare” de pe Acasă.
  grandparentThumb?: string;
  art?: string;
  grandparentArt?: string;
  accountID?: number;
  // Doar în istoric: ID-ul local al dispozitivului (cheia din /devices).
  deviceID?: number;
  viewedAt?: number;
  summary?: string;
  Media?: PlexMedia[];
  // Identificatori externi — siguri la filme („imdb://…”), nu și la
  // seriale/episoade (de regulă fără imdb).
  Guid?: Array<{ id?: string }>;
  User?: { title?: string };
  Player?: {
    title?: string;
    device?: string;
    product?: string;
    state?: string;
    platform?: string;
    // = `clientIdentifier` din /devices; `model` e codul raportat de aplicație,
    // adesea mai precis decât numele.
    machineIdentifier?: string;
    model?: string;
  };
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

// Toate calitățile unui item, nu doar prima: cu `Media[0]`, wizard-ul oferea
// „upgrade” la o calitate deja deținută (a treia descărcare).
export function plexQualitiesFromItem(item: { Media?: PlexMedia[] } | undefined): string[] {
  const all = (item?.Media ?? []).map((m) => plexQualityFromMedia(m)).filter((q) => q !== null);
  return [...new Set(all)];
}

// Care versiune Plex e fișierul nostru: `contentPath` din qBittorrent e calea
// reală, identică cu `Part.file`. `torrent_name` nu e: Filelist zicea
// „Avatar.Fire.and.Ash…DoVi.HDR.x265-HiDt”, pe disc „Avatar Fire and Ash … DV
// HDR10P x265-HiDt.mkv”. `torrentName` rămâne doar rezervă (torrent șters din
// qBittorrent).
//
// `undefined` fără potrivire — apelantul NU cade pe `Media[0]`: mai bine fără
// calitate decât cu a altei versiuni.
export function plexMediaForPath(
  item: { Media?: PlexMedia[] } | undefined,
  contentPath: string | null,
  torrentName: string | null,
): PlexMedia | undefined {
  const media = item?.Media ?? [];
  if (media.length === 0) return undefined;
  // Un singur fișier — al nostru.
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
  // Plex trimite „1080” sau „1080p”, după endpoint.
  const r = String(res).toLowerCase().replace(/p$/, "");
  const is4k = r === "4k" || r === "2160";
  const isHdr = mediaIsHdr(media);
  if (is4k) return isHdr ? "4K HDR" : "4K";
  if (r === "1080") return isHdr ? "1080p HDR" : "1080p";
  if (r === "720") return "720p";
  return `${r}p`;
}

// HDR-ul unei versiuni, din tot ce spune Plex: numele fișierului nu ajunge (un
// „DV” simplu nu se prinde), stream-ul video are datele reale.
export function mediaIsHdr(media: PlexMedia | undefined): boolean {
  const video = (media?.Part?.[0]?.Stream ?? []).find((st) => st.streamType === 1);
  if (video?.DOVIPresent) return true;
  // smpte2084 = PQ (HDR10/HDR10+/DoVi), arib-std-b67 = HLG.
  if (/smpte2084|arib-std-b67/i.test(video?.colorTrc ?? "")) return true;
  if (isHdrLabel(video?.displayTitle)) return true;
  return isHdrLabel(media?.Part?.[0]?.file ?? "");
}

// DoVi/HDR10/HLG din numele fișierului sau din `displayTitle`-ul stream-ului.
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
    // Endpoint-ul de resurse dă des XML — continuăm cu parsarea XML.
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
    // Prioritate -1: PLEX_URL (LAN) se încearcă primul. Prin plex.direct
    // (DNS + TLS la fiecare cerere) /status/sessions dura ~539ms, față de
    // ~0,4ms direct. Doar preferință: fiecare candidat e validat, deci un
    // PLEX_URL greșit cade pe descoperirea de la plex.tv.
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
