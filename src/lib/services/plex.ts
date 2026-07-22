import { createServerFn } from "@tanstack/react-start";
import { fetchJson, fetchText, errMsg, stripSlash, type ServiceStatus } from "./shared";

// ---------- Types ----------

export interface PlexSession {
  title: string;
  grandparentTitle?: string;
  type: string;
  user: string;
  device: string;
  player: string;
  playerState: "playing" | "paused" | "buffering" | string;
  progress: number; // 0-1
  viewOffsetMs: number;
  durationMs: number;
  videoDecision?: string;
  audioDecision?: string;
  bitrateKbps?: number;
  thumbPath?: string;
}

export interface PlexLibrary {
  key: string;
  title: string;
  type: string;
  count: number | null;
}

export interface PlexData {
  status: ServiceStatus;
  error?: string;
  serverName?: string;
  version?: string;
  platform?: string;
  sessions: PlexSession[];
  libraries: PlexLibrary[];
  recentlyAdded: Array<{ title: string; type: string; addedAt: number }>;
  topShows?: Array<{ title: string; plays: number; lastViewedAt: number }>;
  topMovies?: Array<{ title: string; plays: number; lastViewedAt: number }>;
  topWatchers?: Array<{ user: string; plays: number; lastViewedAt: number }>;
  episodesToday?: number;
  activeUsersToday?: number;
  moviesAddedLast24h?: number;
  episodesAddedLast24h?: number;
  userHistory?: Record<string, PlexHistoryEntry[]>;
  todayViews?: PlexHistoryEntry[];
  activeUsersTodayList?: Array<{ user: string; count: number }>;
  recentHistory?: PlexHistoryEntry[];
}

export interface PlexHistoryEntry {
  title: string;
  show?: string;
  season?: number;
  episode?: number;
  type: string;
  viewedAt: number;
  player?: string;
  user?: string;
}

export interface ShowEpisodeInfo {
  season: number;
  episode: number;
  title: string;
  airDateIso: string;
}

export interface ShowStatusData {
  status: ServiceStatus;
  error?: string;
  show: string;
  lastAired: (ShowEpisodeInfo & { inLibrary: boolean | null }) | null;
  next: ShowEpisodeInfo | null;
}

// ---------- Helpers ----------

function normalizeShowTitle(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function plexQualityFromMedia(media: PlexMedia | undefined): string | null {
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

interface PlexConnectionCandidate {
  uri: string;
  source: string;
  priority: number;
}

interface PlexStream {
  streamType?: number;
  decision?: string;
}

interface PlexMediaPart {
  file?: string;
  Stream?: PlexStream[];
}

interface PlexMedia {
  videoResolution?: string;
  bitrate?: number;
  Part?: PlexMediaPart[];
}

interface PlexMetadataItem {
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

interface PlexDirectory {
  key?: string;
  title?: string;
  type?: string;
}

interface PlexAccount {
  id?: number;
  name?: string;
  title?: string;
}

interface PlexApiResponse {
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

let plexDiscoveryCache: { url: string; source: string; expiresAt: number } | null = null;
let plexHistoryCache: {
  url: string;
  topShows: PlexData["topShows"];
  topMovies: PlexData["topMovies"];
  topWatchers: PlexData["topWatchers"];
  episodesToday: number;
  activeUsersToday: number;
  userHistory: Record<string, PlexHistoryEntry[]>;
  todayViews: PlexHistoryEntry[];
  activeUsersTodayList: Array<{ user: string; count: number }>;
  recentHistory: PlexHistoryEntry[];
  expiresAt: number;
} | null = null;

async function fetchPlexHistory(
  url: string,
  headers: Record<string, string>,
): Promise<{
  topShows: PlexData["topShows"];
  topMovies: PlexData["topMovies"];
  topWatchers: PlexData["topWatchers"];
  episodesToday: number;
  activeUsersToday: number;
  userHistory: Record<string, PlexHistoryEntry[]>;
  todayViews: PlexHistoryEntry[];
  activeUsersTodayList: Array<{ user: string; count: number }>;
  recentHistory: PlexHistoryEntry[];
}> {
  if (plexHistoryCache && plexHistoryCache.url === url && plexHistoryCache.expiresAt > Date.now()) {
    return {
      topShows: plexHistoryCache.topShows,
      topMovies: plexHistoryCache.topMovies,
      topWatchers: plexHistoryCache.topWatchers,
      episodesToday: plexHistoryCache.episodesToday,
      activeUsersToday: plexHistoryCache.activeUsersToday,
      userHistory: plexHistoryCache.userHistory,
      todayViews: plexHistoryCache.todayViews,
      activeUsersTodayList: plexHistoryCache.activeUsersTodayList,
      recentHistory: plexHistoryCache.recentHistory,
    };
  }
  const historyJson = await fetchJson<PlexApiResponse>(
    `${url}/status/sessions/history/all?sort=viewedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=1000`,
    { headers },
    12000,
  );
  const entries: PlexMetadataItem[] = historyJson?.MediaContainer?.Metadata ?? [];

  const accountMap = new Map<number, string>();
  try {
    const accountsJson = await fetchJson<PlexApiResponse>(`${url}/accounts`, { headers }, 8000);
    const accounts: PlexAccount[] = accountsJson?.MediaContainer?.Account ?? [];
    for (const a of accounts) {
      const id = Number(a?.id);
      const name = String(a?.name ?? a?.title ?? "").trim();
      if (Number.isFinite(id) && name) accountMap.set(id, name);
    }
  } catch {
    // ignore, fallback below
  }

  const showMap = new Map<string, { plays: number; lastViewedAt: number }>();
  const movieMap = new Map<string, { plays: number; lastViewedAt: number }>();
  const watcherMap = new Map<string, { plays: number; lastViewedAt: number }>();
  const historyByUser = new Map<string, PlexHistoryEntry[]>();
  // Compute "today" in Europe/Bucharest, not UTC (worker runtime).
  const startOfTodaySec = (() => {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Bucharest",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(now)
      .reduce<Record<string, string>>((acc, p) => {
        if (p.type !== "literal") acc[p.type] = p.value;
        return acc;
      }, {});
    const localMs = Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour,
      +parts.minute,
      +parts.second,
    );
    const offsetMs = localMs - now.getTime();
    const utcMidnight = Date.UTC(+parts.year, +parts.month - 1, +parts.day);
    return Math.floor((utcMidnight - offsetMs) / 1000);
  })();
  let episodesToday = 0;
  const todayUsers = new Set<string>();
  const todayViews: PlexHistoryEntry[] = [];
  const todayUserCounts = new Map<string, number>();
  const recentHistory: PlexHistoryEntry[] = [];

  for (const e of entries) {
    const viewedAt = Number(e.viewedAt ?? 0);
    if (e.type === "episode" || e.grandparentTitle) {
      const key = String(e.grandparentTitle ?? e.title ?? "Unknown");
      const prev = showMap.get(key) ?? { plays: 0, lastViewedAt: 0 };
      showMap.set(key, {
        plays: prev.plays + 1,
        lastViewedAt: Math.max(prev.lastViewedAt, viewedAt),
      });
    } else if (e.type === "movie") {
      const key = String(e.title ?? "Unknown");
      const prev = movieMap.get(key) ?? { plays: 0, lastViewedAt: 0 };
      movieMap.set(key, {
        plays: prev.plays + 1,
        lastViewedAt: Math.max(prev.lastViewedAt, viewedAt),
      });
    }
    const accountId = e?.accountID != null ? Number(e.accountID) : null;
    const fromMap = accountId != null ? accountMap.get(accountId) : undefined;
    const fromInline = typeof e?.User?.title === "string" ? e.User.title : undefined;
    const user =
      fromMap ?? fromInline ?? (accountId != null ? `Utilizator #${accountId}` : "Necunoscut");
    const wkey = user;
    const wprev = watcherMap.get(wkey) ?? { plays: 0, lastViewedAt: 0 };
    watcherMap.set(wkey, {
      plays: wprev.plays + 1,
      lastViewedAt: Math.max(wprev.lastViewedAt, viewedAt),
    });
    const list = historyByUser.get(wkey) ?? [];
    if (list.length < 100) {
      list.push({
        title: String(e.title ?? "—"),
        show: e.grandparentTitle ? String(e.grandparentTitle) : undefined,
        season: e.parentIndex != null ? Number(e.parentIndex) : undefined,
        episode: e.index != null ? Number(e.index) : undefined,
        type: String(e.type ?? "unknown"),
        viewedAt,
        player: typeof e?.Player?.title === "string" ? e.Player.title : undefined,
      });
      historyByUser.set(wkey, list);
    }
    const entry: PlexHistoryEntry = {
      title: String(e.title ?? "—"),
      show: e.grandparentTitle ? String(e.grandparentTitle) : undefined,
      season: e.parentIndex != null ? Number(e.parentIndex) : undefined,
      episode: e.index != null ? Number(e.index) : undefined,
      type: String(e.type ?? "unknown"),
      viewedAt,
      player: typeof e?.Player?.title === "string" ? e.Player.title : undefined,
      user,
    };
    if (recentHistory.length < 10) recentHistory.push(entry);
    if (viewedAt >= startOfTodaySec) {
      episodesToday++;
      todayUsers.add(wkey);
      todayViews.push(entry);
      todayUserCounts.set(wkey, (todayUserCounts.get(wkey) ?? 0) + 1);
    }
  }

  const toRanked = <K extends string, T extends { plays: number; lastViewedAt: number }>(
    m: Map<string, T>,
    keyField: K,
  ): Array<Record<K, string> & T> =>
    Array.from(m.entries())
      .map(([k, v]) => ({ [keyField]: k, ...v }) as Record<K, string> & T)
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 5);

  const userHistory: Record<string, PlexHistoryEntry[]> = {};
  for (const [k, list] of historyByUser.entries()) {
    userHistory[k] = list.sort((a, b) => b.viewedAt - a.viewedAt).slice(0, 50);
  }

  const result = {
    topShows: toRanked(showMap, "title"),
    topMovies: toRanked(movieMap, "title"),
    topWatchers: toRanked(watcherMap, "user"),
    episodesToday,
    activeUsersToday: todayUsers.size,
    userHistory,
    todayViews: todayViews.sort((a, b) => b.viewedAt - a.viewedAt),
    activeUsersTodayList: Array.from(todayUserCounts.entries())
      .map(([user, count]) => ({ user, count }))
      .sort((a, b) => b.count - a.count),
    recentHistory,
  };
  plexHistoryCache = { url, ...result, expiresAt: Date.now() + 60_000 };
  return result;
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

async function discoverPlexUrl(
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

export const getPlex = createServerFn({ method: "GET" }).handler(async (): Promise<PlexData> => {
  const base = process.env.PLEX_URL;
  const token = process.env.PLEX_TOKEN;
  if (!token) {
    return {
      status: "error",
      error: "PLEX_TOKEN not configured",
      sessions: [],
      libraries: [],
      recentlyAdded: [],
    };
  }
  const headers = { Accept: "application/json", "X-Plex-Token": token };

  try {
    const discovered = await discoverPlexUrl(token, base);
    const url = discovered.url;
    const [rootJson, sessionsJson, libsJson, history] = await Promise.all([
      fetchJson<PlexApiResponse>(`${url}/`, { headers }),
      fetchJson<PlexApiResponse>(`${url}/status/sessions`, { headers }),
      fetchJson<PlexApiResponse>(`${url}/library/sections`, { headers }),
      fetchPlexHistory(url, headers).catch(() => ({
        topShows: [],
        topMovies: [],
        topWatchers: [],
        episodesToday: 0,
        activeUsersToday: 0,
        userHistory: {},
        todayViews: [],
        activeUsersTodayList: [],
        recentHistory: [],
      })),
    ]);

    const mc = rootJson?.MediaContainer ?? {};
    const sessionsMd = sessionsJson?.MediaContainer?.Metadata ?? [];
    const libsMd = libsJson?.MediaContainer?.Directory ?? [];
    // Combină filme și episoade, sortate după addedAt descrescător, primele 8
    const movieLibKeys = libsMd
      .filter((l: PlexDirectory) => l.type === "movie")
      .map((l: PlexDirectory) => l.key);
    const showLibKeys = libsMd
      .filter((l: PlexDirectory) => l.type === "show")
      .map((l: PlexDirectory) => l.key);

    const [recentMoviesJson, recentEpisodesJson] = await Promise.all([
      movieLibKeys.length > 0
        ? fetchJson<PlexApiResponse>(
            `${url}/library/sections/${movieLibKeys[0]}/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=100&type=1`,
            { headers },
          ).catch(() => ({ MediaContainer: { Metadata: [] } }))
        : Promise.resolve({ MediaContainer: { Metadata: [] } }),
      showLibKeys.length > 0
        ? fetchJson<PlexApiResponse>(
            `${url}/library/sections/${showLibKeys[0]}/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=100&type=4`,
            { headers },
          ).catch(() => ({ MediaContainer: { Metadata: [] } }))
        : Promise.resolve({ MediaContainer: { Metadata: [] } }),
    ]);

    const last24hCutoff = Math.floor(Date.now() / 1000) - 24 * 3600;
    const moviesAddedLast24h = (recentMoviesJson?.MediaContainer?.Metadata ?? []).filter(
      (m: PlexMetadataItem) => Number(m.addedAt ?? 0) >= last24hCutoff,
    ).length;
    const episodesAddedLast24h = (recentEpisodesJson?.MediaContainer?.Metadata ?? []).filter(
      (m: PlexMetadataItem) => Number(m.addedAt ?? 0) >= last24hCutoff,
    ).length;

    const recentMd = [
      ...(recentMoviesJson?.MediaContainer?.Metadata ?? []),
      ...(recentEpisodesJson?.MediaContainer?.Metadata ?? []),
    ]
      .sort(
        (a: PlexMetadataItem, b: PlexMetadataItem) =>
          Number(b.addedAt ?? 0) - Number(a.addedAt ?? 0),
      )
      .slice(0, 8);

    const libraries: PlexLibrary[] = await Promise.all(
      libsMd.map(async (l: PlexDirectory) => {
        let count: number | null = null;
        try {
          const r = await fetchJson<PlexApiResponse>(
            `${url}/library/sections/${l.key}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=0`,
            { headers },
          );
          count = r?.MediaContainer?.totalSize ?? null;
        } catch {
          count = null;
        }
        return { key: String(l.key), title: String(l.title), type: String(l.type), count };
      }),
    );

    const sessions: PlexSession[] = sessionsMd.map((s: PlexMetadataItem) => {
      const media = s?.Media?.[0] ?? {};
      const part = media?.Part?.[0] ?? {};
      const stream = part?.Stream ?? [];
      const video = stream.find((x: PlexStream) => x.streamType === 1);
      const audio = stream.find((x: PlexStream) => x.streamType === 2);
      const dur = Number(s.duration ?? 0);
      const rawOff = Number(s.viewOffset ?? 0);
      // Plex returnează viewOffset în ms, dar dur e tot în ms
      // Dacă dur > 1000 și off < 1000 și off > 0, probabil off e în secunde
      const off = dur > 1000 && rawOff > 0 && rawOff < 1000 ? rawOff * 1000 : rawOff;
      return {
        title: s.title ?? "Unknown",
        grandparentTitle: s.grandparentTitle,
        type: s.type ?? "",
        user: s?.User?.title ?? "?",
        device: s?.Player?.device ?? s?.Player?.product ?? "?",
        player: s?.Player?.title ?? "?",
        playerState: s?.Player?.state ?? "playing",
        progress: dur > 0 ? off / dur : 0,
        viewOffsetMs: off,
        durationMs: dur,
        videoDecision: video?.decision,
        audioDecision: audio?.decision,
        bitrateKbps: Number(media?.bitrate ?? 0) || undefined,
        thumbPath: s.thumb,
      };
    });

    // Tracking activitate Plex
    const { trackPlexSessions } = await import("../activity-log");
    trackPlexSessions(
      sessions.map((s) => ({
        user: s.user,
        title: s.title,
        grandparentTitle: s.grandparentTitle,
        player: s.player,
        viewOffsetMs: s.viewOffsetMs,
        durationMs: s.durationMs,
      })),
    ).catch(() => {});

    return {
      status: "ok" as const,
      serverName: mc.friendlyName,
      version: mc.version ? `${mc.version} · ${discovered.source}` : discovered.source,
      platform: mc.platform,
      sessions,
      libraries,
      recentlyAdded: recentMd.slice(0, 8).map((m: PlexMetadataItem) => {
        let title = m.title;
        if (m.grandparentTitle) {
          const season = m.parentIndex ? `S${String(m.parentIndex).padStart(2, "0")}` : null;
          const episode = m.index ? `E${String(m.index).padStart(2, "0")}` : null;
          const epCode = [season, episode].filter(Boolean).join("");
          title = epCode
            ? `${m.grandparentTitle} ${epCode} — ${m.title}`
            : `${m.grandparentTitle} — ${m.title}`;
        }
        return { title: title ?? "", type: m.type ?? "", addedAt: Number(m.addedAt ?? 0) };
      }),
      topShows: history.topShows,
      topMovies: history.topMovies,
      topWatchers: history.topWatchers,
      episodesToday: history.episodesToday,
      activeUsersToday: history.activeUsersToday,
      moviesAddedLast24h,
      episodesAddedLast24h,
      userHistory: history.userHistory,
      todayViews: history.todayViews,
      activeUsersTodayList: history.activeUsersTodayList,
      recentHistory: history.recentHistory,
    };
  } catch (e) {
    return { status: "error", error: errMsg(e), sessions: [], libraries: [], recentlyAdded: [] };
  }
});

// ---------- House of the Dragon - Sezonul 3 ----------
//
// HBO nu are un API public pentru orarul de difuzare, deci calendarul e
// codat manual, pe baza orarului oficial confirmat (Duminica 9pm ET / 21:00,
// UTC-4 in perioada iunie-august, ora de vara SUA). Titlurile episoadelor
// necunoscute la data scrierii sunt generice ("Episodul N") - actualizeaza-le
// aici pe masura ce HBO le confirma.
const HOTD_S3_EPISODES: Array<{ episode: number; title: string; airDateIso: string }> = [
  { episode: 1, title: "Salt and Sea, Fire and Blood", airDateIso: "2026-06-22T01:00:00Z" },
  { episode: 2, title: "Queen's Landing", airDateIso: "2026-06-29T01:00:00Z" },
  { episode: 3, title: "Episodul 3", airDateIso: "2026-07-06T01:00:00Z" },
  { episode: 4, title: "Episodul 4", airDateIso: "2026-07-13T01:00:00Z" },
  { episode: 5, title: "Episodul 5", airDateIso: "2026-07-20T01:00:00Z" },
  { episode: 6, title: "Episodul 6", airDateIso: "2026-07-27T01:00:00Z" },
  { episode: 7, title: "Episodul 7", airDateIso: "2026-08-03T01:00:00Z" },
  { episode: 8, title: "Episodul 8 (finalul sezonului)", airDateIso: "2026-08-10T01:00:00Z" },
];
const HOTD_SEASON = 3;
const HOTD_SHOW_TITLE = "House of the Dragon";
// ---------- Cămătarii - Sezonul 1 ----------
//
// Difuzat pe PRO TV luni de la 23:30 EEST (= 20:30 UTC), incepand cu 25 mai 2026.
// Premiera (25 mai) a avut Ep1 pe TV + Ep1 SI Ep2 pe VOYO in aceeasi zi (VOYO a
// lansat 2 episoade deodata la lansare). De la Ep3 incolo, VOYO ramane cu o
// saptamana inaintea difuzarii TV, cadenta saptamanala, luni.
// TV:   Ep1=25 mai, Ep2=1 iun, Ep3=8 iun, Ep4=15 iun, Ep5=22 iun, Ep6=29 iun, Ep7=6 iul, Ep8=13 iul
// VOYO: Ep1=25 mai, Ep2=25 mai, Ep3=1 iun, Ep4=8 iun, Ep5=15 iun, Ep6=22 iun, Ep7=29 iun, Ep8=6 iul
//
// ATENTIE: numarul total de episoade (8) si data finalului nu au putut fi
// confirmate dintr-o sursa oficiala la data scrierii - verificat manual pe
// VOYO/Plex daca sezonul chiar se termina la Ep8, altfel ajusteaza mai jos.
export async function checkPlexHasEpisode(
  showTitle: string,
  season: number,
  episode: number,
): Promise<boolean | null> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return null;
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const discovered = await discoverPlexUrl(token, base);
    const url = discovered.url;

    const normalizedTargetTitle = normalizeShowTitle(showTitle);
    const search = await fetchJson<PlexApiResponse>(
      `${url}/search?query=${encodeURIComponent(showTitle)}&type=2`,
      { headers },
      8000,
    );
    const searchShows = (search?.MediaContainer?.Metadata ?? []).filter(
      (r: PlexMetadataItem) => r.type === "show",
    );
    let show: PlexMetadataItem | undefined =
      searchShows.find(
        (r: PlexMetadataItem) =>
          normalizeShowTitle(String(r.title ?? "")) === normalizedTargetTitle,
      ) ??
      searchShows.find((r: PlexMetadataItem) =>
        normalizeShowTitle(String(r.title ?? "")).includes(normalizedTargetTitle),
      ) ??
      searchShows.find((r: PlexMetadataItem) =>
        normalizedTargetTitle.includes(normalizeShowTitle(String(r.title ?? ""))),
      ) ??
      searchShows[0];
    if (!show) {
      const all = await fetchJson<PlexApiResponse>(
        `${url}/library/sections/2/all?type=2`,
        { headers },
        10000,
      );
      const libShows = (all?.MediaContainer?.Metadata ?? []).filter(
        (r: PlexMetadataItem) => r.type === "show",
      );
      show =
        libShows.find(
          (r: PlexMetadataItem) =>
            normalizeShowTitle(String(r.title ?? "")) === normalizedTargetTitle,
        ) ??
        libShows.find((r: PlexMetadataItem) =>
          normalizeShowTitle(String(r.title ?? "")).includes(normalizedTargetTitle),
        ) ??
        libShows.find((r: PlexMetadataItem) =>
          normalizedTargetTitle.includes(normalizeShowTitle(String(r.title ?? ""))),
        );
    }
    if (!show) return false;

    const seasons = await fetchJson<PlexApiResponse>(
      `${url}/library/metadata/${show.ratingKey}/children`,
      { headers },
      8000,
    );
    const seasonsMd = seasons?.MediaContainer?.Metadata ?? [];
    const seasonMatch = seasonsMd.find((s: PlexMetadataItem) => Number(s.index) === season);
    if (!seasonMatch) return false;

    const episodes = await fetchJson<PlexApiResponse>(
      `${url}/library/metadata/${seasonMatch.ratingKey}/children`,
      { headers },
      8000,
    );
    const episodesMd = episodes?.MediaContainer?.Metadata ?? [];
    return episodesMd.some((e: PlexMetadataItem) => Number(e.index) === episode);
  } catch {
    return null;
  }
}

export const getPlexEpisodesInSeason = createServerFn({ method: "GET" })
  .validator((data: { showTitle: string; season: number }) => data)
  .handler(
    async ({ data }): Promise<{ num: number; quality: string | null; watched: boolean }[]> => {
      const token = process.env.PLEX_TOKEN;
      const base = process.env.PLEX_URL;
      if (!token) return [];
      try {
        const headers = { Accept: "application/json", "X-Plex-Token": token };
        const discovered = await discoverPlexUrl(token, base);
        const url = discovered.url;

        const normalizedTarget = normalizeShowTitle(data.showTitle);

        // Caută mai întâi prin search endpoint (rapid)
        const search = await fetchJson<PlexApiResponse>(
          `${url}/search?query=${encodeURIComponent(data.showTitle)}&type=2`,
          { headers },
          8000,
        );
        const searchShows = (search?.MediaContainer?.Metadata ?? []).filter(
          (r: PlexMetadataItem) => r.type === "show",
        );

        // Încearcă mai întâi potrivire normalizată din rezultatele search-ului
        let show: PlexMetadataItem | undefined =
          searchShows.find(
            (r: PlexMetadataItem) => normalizeShowTitle(String(r.title ?? "")) === normalizedTarget,
          ) ??
          searchShows.find((r: PlexMetadataItem) =>
            normalizeShowTitle(String(r.title ?? "")).includes(normalizedTarget),
          ) ??
          searchShows.find((r: PlexMetadataItem) =>
            normalizedTarget.includes(normalizeShowTitle(String(r.title ?? ""))),
          ) ??
          searchShows[0]; // search-ul Plex e deja relevant (ex: "Casa Dragonului" pentru "House of the Dragon")

        // Dacă search n-a returnat nimic, parcurge biblioteca și potrivește normalizat
        if (!show) {
          const allShows = await fetchJson<PlexApiResponse>(
            `${url}/library/sections/2/all?type=2`,
            { headers },
            10000,
          );
          const libShows = (allShows?.MediaContainer?.Metadata ?? []).filter(
            (r: PlexMetadataItem) => r.type === "show",
          );
          show =
            libShows.find(
              (r: PlexMetadataItem) =>
                normalizeShowTitle(String(r.title ?? "")) === normalizedTarget,
            ) ??
            libShows.find((r: PlexMetadataItem) =>
              normalizeShowTitle(String(r.title ?? "")).includes(normalizedTarget),
            ) ??
            libShows.find((r: PlexMetadataItem) =>
              normalizedTarget.includes(normalizeShowTitle(String(r.title ?? ""))),
            );
        }

        if (!show) return [];

        const seasons = await fetchJson<PlexApiResponse>(
          `${url}/library/metadata/${show.ratingKey}/children`,
          { headers },
          8000,
        );
        const seasonsMd = seasons?.MediaContainer?.Metadata ?? [];
        const seasonMatch = seasonsMd.find(
          (s: PlexMetadataItem) => Number(s.index) === data.season,
        );
        if (!seasonMatch) return [];

        const episodes = await fetchJson<PlexApiResponse>(
          `${url}/library/metadata/${seasonMatch.ratingKey}/children`,
          { headers },
          8000,
        );
        const episodesMd = episodes?.MediaContainer?.Metadata ?? [];
        return episodesMd
          .filter((e: PlexMetadataItem) => Number(e.index) > 0)
          .map((e: PlexMetadataItem) => {
            const quality = plexQualityFromMedia(e.Media?.[0]);
            return { num: Number(e.index), quality, watched: Number(e.viewCount ?? 0) > 0 };
          });
      } catch {
        return [];
      }
    },
  );

export const checkPlexHasTitle = createServerFn({ method: "GET" })
  .validator((data: { title: string; originalTitle: string; mediaType: "movie" | "tv" }) => data)
  .handler(async ({ data }): Promise<{ found: boolean; quality: string | null } | null> => {
    const token = process.env.PLEX_TOKEN;
    const base = process.env.PLEX_URL;
    if (!token) return null;
    try {
      const headers = { Accept: "application/json", "X-Plex-Token": token };
      const discovered = await discoverPlexUrl(token, base);
      const url = discovered.url;
      const plexType = data.mediaType === "movie" ? 1 : 2;

      for (const queryTitle of [
        data.title,
        data.originalTitle,
        normalizeShowTitle(data.title),
      ].filter(Boolean)) {
        const search = await fetchJson<PlexApiResponse>(
          `${url}/search?query=${encodeURIComponent(queryTitle)}&type=${plexType}`,
          { headers },
          8000,
        );
        const results = search?.MediaContainer?.Metadata ?? [];
        if (results.length > 0) {
          const quality = plexQualityFromMedia(results[0]?.Media?.[0]);
          return { found: true, quality };
        }
      }
      return { found: false, quality: null };
    } catch {
      return null;
    }
  });

// ---------------------------------------------------------------------------
// Funcții interne exportate (fără createServerFn, pentru plugin-uri background)
// ---------------------------------------------------------------------------

export async function getPlexEpisodesInSeasonInternal(
  showTitle: string,
  season: number,
): Promise<{ num: number; quality: string | null; watched: boolean }[]> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return [];
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const discovered = await discoverPlexUrl(token, base);
    const url = discovered.url;
    const normalizedTarget = normalizeShowTitle(showTitle);

    const search = await fetchJson<PlexApiResponse>(
      `${url}/search?query=${encodeURIComponent(showTitle)}&type=2`,
      { headers },
      8000,
    );
    const searchShows = (search?.MediaContainer?.Metadata ?? []).filter(
      (r: PlexMetadataItem) => r.type === "show",
    );
    let show: PlexMetadataItem | undefined =
      searchShows.find(
        (r: PlexMetadataItem) => normalizeShowTitle(String(r.title ?? "")) === normalizedTarget,
      ) ??
      searchShows.find((r: PlexMetadataItem) =>
        normalizeShowTitle(String(r.title ?? "")).includes(normalizedTarget),
      ) ??
      searchShows.find((r: PlexMetadataItem) =>
        normalizedTarget.includes(normalizeShowTitle(String(r.title ?? ""))),
      ) ??
      searchShows[0];

    if (!show) {
      const allShows = await fetchJson<PlexApiResponse>(
        `${url}/library/sections/2/all?type=2`,
        { headers },
        10000,
      );
      const libShows = (allShows?.MediaContainer?.Metadata ?? []).filter(
        (r: PlexMetadataItem) => r.type === "show",
      );
      show =
        libShows.find(
          (r: PlexMetadataItem) => normalizeShowTitle(String(r.title ?? "")) === normalizedTarget,
        ) ??
        libShows.find((r: PlexMetadataItem) =>
          normalizeShowTitle(String(r.title ?? "")).includes(normalizedTarget),
        ) ??
        libShows.find((r: PlexMetadataItem) =>
          normalizedTarget.includes(normalizeShowTitle(String(r.title ?? ""))),
        );
    }
    if (!show) return [];

    const seasons = await fetchJson<PlexApiResponse>(
      `${url}/library/metadata/${show.ratingKey}/children`,
      { headers },
      8000,
    );
    const seasonsMd = seasons?.MediaContainer?.Metadata ?? [];
    const seasonMatch = seasonsMd.find((s: PlexMetadataItem) => Number(s.index) === season);
    if (!seasonMatch) return [];

    const episodes = await fetchJson<PlexApiResponse>(
      `${url}/library/metadata/${seasonMatch.ratingKey}/children`,
      { headers },
      8000,
    );
    const episodesMd = episodes?.MediaContainer?.Metadata ?? [];
    return episodesMd
      .filter((e: PlexMetadataItem) => Number(e.index) > 0)
      .map((e: PlexMetadataItem) => ({
        num: Number(e.index),
        quality: plexQualityFromMedia(e.Media?.[0]),
        watched: Number(e.viewCount ?? 0) > 0,
      }));
  } catch {
    return [];
  }
}

export async function checkPlexHasTitleInternal(
  title: string,
  originalTitle: string,
  mediaType: "movie" | "tv",
): Promise<{ found: boolean; quality: string | null } | null> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return null;
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const discovered = await discoverPlexUrl(token, base);
    const url = discovered.url;
    const plexType = mediaType === "movie" ? 1 : 2;
    for (const q of [title, originalTitle, normalizeShowTitle(title)].filter(Boolean)) {
      const search = await fetchJson<PlexApiResponse>(
        `${url}/search?query=${encodeURIComponent(q)}&type=${plexType}`,
        { headers },
        8000,
      );
      const results = search?.MediaContainer?.Metadata ?? [];
      if (results.length > 0) {
        const quality = plexQualityFromMedia(results[0]?.Media?.[0]);
        return { found: true, quality };
      }
    }
    return { found: false, quality: null };
  } catch {
    return null;
  }
}

export const getShowStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<ShowStatusData> => {
    return await buildShowStatus(HOTD_SHOW_TITLE, HOTD_SEASON, HOTD_S3_EPISODES);
  },
);

async function buildShowStatus(
  showTitle: string,
  season: number,
  episodes: Array<{ episode: number; title: string; airDateIso: string }>,
): Promise<ShowStatusData> {
  try {
    const now = Date.now();
    const aired = episodes.filter((e) => new Date(e.airDateIso).getTime() <= now);
    const lastAiredEp = aired.length > 0 ? aired[aired.length - 1] : null;
    const nextEp = episodes.find((e) => new Date(e.airDateIso).getTime() > now) ?? null;

    let inLibrary: boolean | null = null;
    if (lastAiredEp) {
      inLibrary = await checkPlexHasEpisode(showTitle, season, lastAiredEp.episode);
    }

    return {
      status: "ok",
      show: `${showTitle} — Sezonul ${season}`,
      lastAired: lastAiredEp
        ? {
            season,
            episode: lastAiredEp.episode,
            title: lastAiredEp.title,
            airDateIso: lastAiredEp.airDateIso,
            inLibrary,
          }
        : null,
      next: nextEp
        ? { season, episode: nextEp.episode, title: nextEp.title, airDateIso: nextEp.airDateIso }
        : null,
    };
  } catch (e) {
    return {
      status: "error",
      error: errMsg(e),
      show: `${showTitle} — Sezonul ${season}`,
      lastAired: null,
      next: null,
    };
  }
}
