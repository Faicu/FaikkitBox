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
}

export interface PlexMediaPart {
  file?: string;
  Stream?: PlexStream[];
}

export interface PlexMedia {
  videoResolution?: string;
  bitrate?: number;
  Part?: PlexMediaPart[];
}

export interface PlexMetadataItem {
  ratingKey?: string;
  key?: string;
  title?: string;
  type?: string;
  index?: number;
  parentIndex?: number;
  grandparentTitle?: string;
  addedAt?: number;
  viewCount?: number;
  duration?: number;
  viewOffset?: number;
  thumb?: string;
  accountID?: number;
  viewedAt?: number;
  Media?: PlexMedia[];
  User?: { title?: string };
  Player?: { title?: string; device?: string; product?: string; state?: string };
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

export function plexQualityFromMedia(media: PlexMedia | undefined): string | null {
  const res: string | undefined = media?.videoResolution;
  if (!res) return null;
  const r = String(res).toLowerCase();
  const is4k = r === "4k" || r === "2160";
  const filename: string = media?.Part?.[0]?.file ?? "";
  const isHdr = /dovi|hdr10|hdr|hlg/i.test(filename);
  if (is4k) return isHdr ? "4K HDR" : "4K";
  if (r === "1080") return "1080p";
  if (r === "720") return "720p";
  return res.toUpperCase();
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
    candidates.push({
      uri: stripSlash(fallbackBase),
      source: "Manual PLEX_URL fallback",
      priority: 10,
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
