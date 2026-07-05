import { createServerFn } from "@tanstack/react-start";

// ---------- Types ----------

export type ServiceStatus = "ok" | "error";

export interface PlexSession {
  title: string;
  grandparentTitle?: string;
  type: string;
  user: string;
  device: string;
  player: string;
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

export interface ImmichData {
  status: ServiceStatus;
  error?: string;
  version?: string;
  totalAssets?: number;
  photos?: number;
  videos?: number;
  usageBytes?: number;
  usageByUser?: Array<{ userName: string; usage: number; photos: number; videos: number }>;
  activeJobs?: Array<{ name: string; active: number; waiting: number }>;
  topUploaders?: Array<{ userName: string; total: number; photos: number; videos: number; usage: number }>;
  jobQueueDepth?: number;
  uploadsToday?: number;
  uploadsThisWeek?: number;
}

export interface QbitTorrent {
  hash: string;
  name: string;
  progress: number;
  dlspeed: number;
  upspeed: number;
  eta: number;
  state: string;
  size: number;
  numSeeds: number;
  numLeechs: number;
  ratio: number;
}

export interface QbitData {
  status: ServiceStatus;
  error?: string;
  version?: string;
  dlSpeed: number;
  upSpeed: number;
  dlSpeedLimit: number;
  upSpeedLimit: number;
  totalDl: number;
  totalUp: number;
  freeSpaceOnDisk: number;
  globalRatio: number;
  torrents: QbitTorrent[];
  counts: { downloading: number; seeding: number; paused: number; total: number };
  sessionDl: number;
  sessionUp: number;
  alltimeDl?: number;
  alltimeUp?: number;
  largestEta?: { name: string; eta: number; remaining: number } | null;
  perCategory?: Array<{ category: string; count: number; dlspeed: number; upspeed: number }>;
}

export interface HostData {
  status: ServiceStatus;
  error?: string;
  configured: boolean;
  hostname?: string;
  os?: string;
  uptimeSec?: number;
  cpuPercent?: number;
  cpuCores?: number;
  loadAvg?: [number, number, number];
  memPercent?: number;
  memUsedBytes?: number;
  memTotalBytes?: number;
  swapPercent?: number;
  disks?: Array<{ mount: string; percent: number; usedBytes: number; totalBytes: number }>;
  net?: Array<{ name: string; rxSec: number; txSec: number }>;
  sensors?: Array<{ label: string; value: number; unit: string }>;
  topProcesses?: Array<{ name: string; cpu: number; mem: number }>;
  apps?: Array<{ name: string; cpu: number; mem: number; netRx?: number; netTx?: number; source: "process" | "container" }>;
  diskIO?: Array<{ name: string; ioRead: number; ioWrite: number }>;
}

// ---------- Helpers ----------

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

async function fetchText(url: string, init?: RequestInit, timeoutMs = 8000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 160)}` : ""}`);
    }
    return await res.text();
  } catch (e) {
    throw new Error(`${url} → ${errMsg(e)}`);
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 160)}` : ""}`);
    }
    return (await res.json()) as T;
  } catch (e) {
    // Undici hides the real reason under `cause`; surface it.
    throw new Error(`${url} → ${errMsg(e)}`);
  } finally {
    clearTimeout(t);
  }
}

function errMsg(e: unknown): string {
  if (!e) return "unknown error";
  if (e instanceof Error) {
    const parts = [e.message];
    const cause = (e as { cause?: unknown }).cause;
    if (cause) {
      if (cause instanceof Error) {
        parts.push(`(${cause.message}${(cause as any).code ? ` [${(cause as any).code}]` : ""})`);
      } else {
        parts.push(`(${String(cause)})`);
      }
    }
    return parts.join(" ");
  }
  return String(e);
}

// ---------- Plex ----------

interface PlexConnectionCandidate {
  uri: string;
  source: string;
  priority: number;
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

async function fetchPlexHistory(url: string, headers: Record<string, string>): Promise<{
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
  const historyJson = await fetchJson<any>(
    `${url}/status/sessions/history/all?sort=viewedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=1000`,
    { headers },
    12000,
  );
  const entries: any[] = historyJson?.MediaContainer?.Metadata ?? [];

  const accountMap = new Map<number, string>();
  try {
    const accountsJson = await fetchJson<any>(`${url}/accounts`, { headers }, 8000);
    const accounts: any[] = accountsJson?.MediaContainer?.Account ?? [];
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
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(now).reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
    const localMs = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
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
      showMap.set(key, { plays: prev.plays + 1, lastViewedAt: Math.max(prev.lastViewedAt, viewedAt) });
    } else if (e.type === "movie") {
      const key = String(e.title ?? "Unknown");
      const prev = movieMap.get(key) ?? { plays: 0, lastViewedAt: 0 };
      movieMap.set(key, { plays: prev.plays + 1, lastViewedAt: Math.max(prev.lastViewedAt, viewedAt) });
    }
    const accountId = e?.accountID != null ? Number(e.accountID) : null;
    const fromMap = accountId != null ? accountMap.get(accountId) : undefined;
    const fromInline = typeof e?.User?.title === "string" ? e.User.title : undefined;
    const user =
      fromMap ??
      fromInline ??
      (accountId != null ? `Utilizator #${accountId}` : "Necunoscut");
    const wkey = user;
    const wprev = watcherMap.get(wkey) ?? { plays: 0, lastViewedAt: 0 };
    watcherMap.set(wkey, { plays: wprev.plays + 1, lastViewedAt: Math.max(wprev.lastViewedAt, viewedAt) });
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

  const toRanked = <T extends { plays: number; lastViewedAt: number }>(m: Map<string, T>, keyField: string) =>
    Array.from(m.entries())
      .map(([k, v]) => ({ [keyField]: k, ...v }))
      .sort((a: any, b: any) => b.plays - a.plays)
      .slice(0, 5) as any;

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
      const connections = Array.isArray(device?.Connection) ? device.Connection : Array.isArray(device?.connections) ? device.connections : [];
      for (const conn of connections) {
        const uri = String(conn?.uri ?? "");
        if (!uri) continue;
        const protocol = String(conn?.protocol ?? (uri.startsWith("https:") ? "https" : "http"));
        const isPlexDirect = uri.includes("plex.direct");
        const isRelay = String(conn?.relay ?? "0") === "1";
        candidates.push({
          uri,
          source: isRelay ? "Plex Relay" : isPlexDirect ? "Plex Direct" : "Plex resource",
          priority: protocol === "https" && isPlexDirect && !isRelay ? 0 : protocol === "https" && !isRelay ? 1 : protocol === "http" && !isRelay ? 2 : 3,
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

    const connectionMatches = deviceMatch[2].matchAll(/<Connection\b([^/>]*)(?:\/>|>[\s\S]*?<\/Connection>)/g);
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
        priority: protocol === "https" && isPlexDirect && !isRelay ? 0 : protocol === "https" && !isRelay ? 1 : protocol === "http" && !isRelay ? 2 : 3,
      });
    }
  }

  return uniqueCandidates(candidates);
}

async function discoverPlexUrl(token: string, fallbackBase?: string): Promise<{ url: string; source: string; attempts: string[] }> {
  if (plexDiscoveryCache && plexDiscoveryCache.expiresAt > Date.now()) {
    return { url: plexDiscoveryCache.url, source: plexDiscoveryCache.source, attempts: [] };
  }

  const headers = { Accept: "application/json, application/xml;q=0.9, text/xml;q=0.8", "X-Plex-Token": token };
  const attempts: string[] = [];
  const resourcesText = await fetchText("https://plex.tv/api/resources?includeHttps=1&includeRelay=1", { headers }, 10000);
  const candidates = parsePlexResources(resourcesText);

  if (fallbackBase) {
    candidates.push({ uri: stripSlash(fallbackBase), source: "Manual PLEX_URL fallback", priority: 10 });
  }

  if (candidates.length === 0) {
    throw new Error("No Plex server connections found for this token");
  }

  for (const candidate of uniqueCandidates(candidates)) {
    try {
      await fetchJson<any>(`${candidate.uri}/`, { headers }, 5000);
      plexDiscoveryCache = { url: candidate.uri, source: candidate.source, expiresAt: Date.now() + 5 * 60 * 1000 };
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
    return { status: "error", error: "PLEX_TOKEN not configured", sessions: [], libraries: [], recentlyAdded: [] };
  }
  const headers = { Accept: "application/json", "X-Plex-Token": token };

  try {
    const discovered = await discoverPlexUrl(token, base);
    const url = discovered.url;
    const [rootJson, sessionsJson, libsJson, recentJson, history] = await Promise.all([
      fetchJson<any>(`${url}/`, { headers }),
      fetchJson<any>(`${url}/status/sessions`, { headers }),
      fetchJson<any>(`${url}/library/sections`, { headers }),
      fetchJson<any>(`${url}/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=8`, { headers }).catch(() => ({ MediaContainer: { Metadata: [] } })),
      fetchPlexHistory(url, headers).catch(() => ({ topShows: [], topMovies: [], topWatchers: [], episodesToday: 0, activeUsersToday: 0, userHistory: {}, todayViews: [], activeUsersTodayList: [], recentHistory: [] })),
    ]);

    const mc = rootJson?.MediaContainer ?? {};
    const sessionsMd = sessionsJson?.MediaContainer?.Metadata ?? [];
    const libsMd = libsJson?.MediaContainer?.Directory ?? [];
    const recentMd = recentJson?.MediaContainer?.Metadata ?? [];

    const libraries: PlexLibrary[] = await Promise.all(
      libsMd.map(async (l: any) => {
        let count: number | null = null;
        try {
          const r = await fetchJson<any>(`${url}/library/sections/${l.key}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=0`, { headers });
          count = r?.MediaContainer?.totalSize ?? null;
        } catch {
          count = null;
        }
        return { key: String(l.key), title: String(l.title), type: String(l.type), count };
      }),
    );

    const sessions: PlexSession[] = sessionsMd.map((s: any) => {
      const media = s?.Media?.[0] ?? {};
      const part = media?.Part?.[0] ?? {};
      const stream = part?.Stream ?? [];
      const video = stream.find((x: any) => x.streamType === 1);
      const audio = stream.find((x: any) => x.streamType === 2);
      const dur = Number(s.duration ?? 0);
      const off = Number(s.viewOffset ?? 0);
      return {
        title: s.title ?? "Unknown",
        grandparentTitle: s.grandparentTitle,
        type: s.type ?? "",
        user: s?.User?.title ?? "?",
        device: s?.Player?.device ?? s?.Player?.product ?? "?",
        player: s?.Player?.title ?? "?",
        progress: dur > 0 ? off / dur : 0,
        viewOffsetMs: off,
        durationMs: dur,
        videoDecision: video?.decision,
        audioDecision: audio?.decision,
        bitrateKbps: Number(media?.bitrate ?? 0) || undefined,
        thumbPath: s.thumb,
      };
    });

    return {
      status: "ok",
      serverName: mc.friendlyName,
      version: mc.version ? `${mc.version} · ${discovered.source}` : discovered.source,
      platform: mc.platform,
      sessions,
      libraries,
      recentlyAdded: recentMd.slice(0, 8).map((m: any) => ({
        title: m.grandparentTitle ? `${m.grandparentTitle} — ${m.title}` : m.title,
        type: m.type,
        addedAt: Number(m.addedAt ?? 0),
      })),
      topShows: history.topShows,
      topMovies: history.topMovies,
      topWatchers: history.topWatchers,
      episodesToday: history.episodesToday,
      activeUsersToday: history.activeUsersToday,
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

async function checkPlexHasEpisode(showTitle: string, season: number, episode: number): Promise<boolean | null> {
  const token = process.env.PLEX_TOKEN;
  const base = process.env.PLEX_URL;
  if (!token) return null;
  try {
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const discovered = await discoverPlexUrl(token, base);
    const url = discovered.url;

    const search = await fetchJson<any>(
      `${url}/search?query=${encodeURIComponent(showTitle)}&type=2`,
      { headers },
      8000,
    );
    const results = search?.MediaContainer?.Metadata ?? [];
    const show = results.find(
      (r: any) => r.type === "show" && String(r.title ?? "").toLowerCase().includes(showTitle.toLowerCase()),
    );
    if (!show) return false;

    const seasons = await fetchJson<any>(`${url}/library/metadata/${show.ratingKey}/children`, { headers }, 8000);
    const seasonsMd = seasons?.MediaContainer?.Metadata ?? [];
    const seasonMatch = seasonsMd.find((s: any) => Number(s.index) === season);
    if (!seasonMatch) return false;

    const episodes = await fetchJson<any>(`${url}/library/metadata/${seasonMatch.ratingKey}/children`, { headers }, 8000);
    const episodesMd = episodes?.MediaContainer?.Metadata ?? [];
    return episodesMd.some((e: any) => Number(e.index) === episode);
  } catch {
    return null;
  }
}

export const getShowStatus = createServerFn({ method: "GET" }).handler(async (): Promise<ShowStatusData> => {
  try {
    const now = Date.now();
    const aired = HOTD_S3_EPISODES.filter((e) => new Date(e.airDateIso).getTime() <= now);
    const lastAiredEp = aired.length > 0 ? aired[aired.length - 1] : null;
    const nextEp = HOTD_S3_EPISODES.find((e) => new Date(e.airDateIso).getTime() > now) ?? null;

    let inLibrary: boolean | null = null;
    if (lastAiredEp) {
      inLibrary = await checkPlexHasEpisode(HOTD_SHOW_TITLE, HOTD_SEASON, lastAiredEp.episode);
    }

    return {
      status: "ok",
      show: `${HOTD_SHOW_TITLE} — Sezonul ${HOTD_SEASON}`,
      lastAired: lastAiredEp
        ? { season: HOTD_SEASON, episode: lastAiredEp.episode, title: lastAiredEp.title, airDateIso: lastAiredEp.airDateIso, inLibrary }
        : null,
      next: nextEp
        ? { season: HOTD_SEASON, episode: nextEp.episode, title: nextEp.title, airDateIso: nextEp.airDateIso }
        : null,
    };
  } catch (e) {
    return { status: "error", error: errMsg(e), show: `${HOTD_SHOW_TITLE} — Sezonul ${HOTD_SEASON}`, lastAired: null, next: null };
  }
});

// ---------- Immich ----------

export const getImmich = createServerFn({ method: "GET" }).handler(async (): Promise<ImmichData> => {
  const base = process.env.IMMICH_URL;
  const key = process.env.IMMICH_API_KEY;
  if (!base || !key) return { status: "error", error: "IMMICH_URL / IMMICH_API_KEY not configured" };
  const url = stripSlash(base);
  const headers = { "x-api-key": key, Accept: "application/json" };

  try {
    const nowIso = new Date().toISOString();
    const startOfDayIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const weekAgoIso = new Date(Date.now() - 7 * 86400_000).toISOString();

    async function countSince(iso: string): Promise<number | undefined> {
      try {
        // createdAfter/createdBefore = data la care a fost creata inregistrarea in Immich
        // (adica momentul incarcarii). takenAfter/takenBefore ar filtra dupa data EXIF
        // (cand a fost facuta poza), ceea ce da rezultate gresite la import de biblioteci
        // vechi - fotografii incarcate azi, dar facute cu ani in urma, nu ar aparea deloc.
        //
        // NU ne bazam pe campul 'total' din raspuns - pe unele versiuni Immich acesta
        // reflecta doar numarul de elemente din pagina curenta (limitat de 'size'), nu
        // adevaratul total de potriviri (bug cunoscut). Numaram efectiv itemii primiti,
        // parcurgand paginile daca e nevoie.
        let items: any[] = [];
        let page: number | null = 1;
        let guard = 0;
        while (page != null && guard < 20) {
          guard++;
          const res = await fetchJson<any>(`${url}/api/search/metadata`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ createdAfter: iso, createdBefore: nowIso, size: 1000, page }),
          }, 10000);
          const pageItems = res?.assets?.items ?? res?.items ?? [];
          items = items.concat(pageItems);
          page = res?.assets?.nextPage ?? res?.nextPage ?? null;
        }

        // Live Photos (ex. MVIMG_*.jpg de pe telefoane Android/iPhone) sunt stocate
        // in Immich ca 2 elemente separate: o poza (IMAGE) si un videoclip-pereche
        // (VIDEO), legate prin campul 'livePhotoVideoId' de pe poza. In aplicatia
        // Immich, cele doua se vad ca UN singur element in galerie. Excludem
        // video-ul-pereche din numaratoare, ca sa reflectam ce vede userul, nu
        // numarul brut de asset-uri din baza de date.
        const pairedVideoIds = new Set(
          items.filter((it) => it?.livePhotoVideoId).map((it) => it.livePhotoVideoId),
        );
        const visibleItems = items.filter((it) => !(it?.type === "VIDEO" && pairedVideoIds.has(it?.id)));

        return visibleItems.length;
      } catch {
        return undefined;
      }
    }

    const [version, stats, jobs, uploadsToday, uploadsThisWeek] = await Promise.all([
      fetchJson<any>(`${url}/api/server/version`, { headers }).catch(() => null),
      fetchJson<any>(`${url}/api/server/statistics`, { headers }),
      fetchJson<any>(`${url}/api/jobs`, { headers }).catch(() => null),
      countSince(startOfDayIso),
      countSince(weekAgoIso),
    ]);

    type UsageRow = { userName: string; usage: number; photos: number; videos: number };
    const usageByUser: UsageRow[] = Array.isArray(stats?.usageByUser)
      ? stats.usageByUser.map((u: any) => ({
          userName: u.userName ?? u.userId ?? "user",
          usage: Number(u.usage ?? 0),
          photos: Number(u.photos ?? 0),
          videos: Number(u.videos ?? 0),
        }))
      : [];

    const activeJobs = jobs
      ? Object.entries(jobs)
          .map(([name, v]: [string, any]) => ({
            name,
            active: Number(v?.jobCounts?.active ?? 0),
            waiting: Number(v?.jobCounts?.waiting ?? 0),
          }))
          .filter((j) => j.active > 0 || j.waiting > 0)
      : [];

    const topUploaders = usageByUser
      .map((u) => ({ userName: u.userName, total: u.photos + u.videos, photos: u.photos, videos: u.videos, usage: u.usage }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    const jobQueueDepth = activeJobs.reduce((sum, j) => sum + j.active + j.waiting, 0);

    return {
      status: "ok",
      version: version ? `${version.major}.${version.minor}.${version.patch}` : undefined,
      totalAssets: Number(stats?.photos ?? 0) + Number(stats?.videos ?? 0),
      photos: Number(stats?.photos ?? 0),
      videos: Number(stats?.videos ?? 0),
      usageBytes: Number(stats?.usage ?? 0),
      usageByUser,
      activeJobs,
      topUploaders,
      jobQueueDepth,
      uploadsToday,
      uploadsThisWeek,
    };
  } catch (e) {
    return { status: "error", error: errMsg(e) };
  }
});

// ---------- qBittorrent ----------

// Cookie cache (per server instance)
let qbitCookie: string | null = null;

async function qbitLogin(url: string, user: string, pass: string): Promise<string> {
  const body = new URLSearchParams({ username: user, password: pass });
  const res = await fetch(`${url}/api/v2/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: url },
    body,
  });
  const text = await res.text();
  if (!res.ok || text.trim() !== "Ok.") {
    throw new Error(`qBittorrent login failed: ${res.status} ${text.slice(0, 120)}`);
  }
  const setCookie = res.headers.get("set-cookie") ?? "";
  const sid = /SID=([^;]+)/.exec(setCookie)?.[1];
  if (!sid) throw new Error("qBittorrent login: no SID cookie");
  return `SID=${sid}`;
}

async function qbitFetch(url: string, path: string, user: string, pass: string): Promise<Response> {
  if (!qbitCookie) qbitCookie = await qbitLogin(url, user, pass);
  let res = await fetch(`${url}${path}`, { headers: { Cookie: qbitCookie, Referer: url } });
  if (res.status === 403 || res.status === 401) {
    qbitCookie = await qbitLogin(url, user, pass);
    res = await fetch(`${url}${path}`, { headers: { Cookie: qbitCookie, Referer: url } });
  }
  return res;
}

async function qbitPost(url: string, path: string, user: string, pass: string, form: Record<string, string>): Promise<Response> {
  if (!qbitCookie) qbitCookie = await qbitLogin(url, user, pass);
  const body = new URLSearchParams(form);
  const doFetch = () =>
    fetch(`${url}${path}`, {
      method: "POST",
      headers: {
        Cookie: qbitCookie!,
        Referer: url,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  let res = await doFetch();
  if (res.status === 403 || res.status === 401) {
    qbitCookie = await qbitLogin(url, user, pass);
    res = await doFetch();
  }
  return res;
}

export const qbitAction = createServerFn({ method: "POST" })
  .inputValidator((data: { hashes: string[] | "all"; action: "pause" | "resume" }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const { requireAdmin } = await import("./admin.server");
    try { await requireAdmin(); } catch (e) { return { ok: false, error: (e as Error).message }; }
    const base = process.env.QBIT_URL;
    const user = process.env.QBIT_USERNAME;
    const pass = process.env.QBIT_PASSWORD;
    if (!base || !user || !pass) return { ok: false, error: "qBittorrent not configured" };
    const url = stripSlash(base);
    const hashesStr = data.hashes === "all" ? "all" : data.hashes.join("|");
    // qBit 4.x: pause/resume. 5.x also accepts stop/start. Try primary then fallback.
    const primary = data.action === "pause" ? "/api/v2/torrents/pause" : "/api/v2/torrents/resume";
    const fallback = data.action === "pause" ? "/api/v2/torrents/stop" : "/api/v2/torrents/start";
    try {
      let res = await qbitPost(url, primary, user, pass, { hashes: hashesStr });
      if (!res.ok) {
        res = await qbitPost(url, fallback, user, pass, { hashes: hashesStr });
      }
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return { ok: false, error: `HTTP ${res.status} ${t.slice(0, 120)}` };
      }
      return { ok: true };
    } catch (e) {
      qbitCookie = null;
      return { ok: false, error: errMsg(e) };
    }
  });

export const getQbit = createServerFn({ method: "GET" }).handler(async (): Promise<QbitData> => {
  const base = process.env.QBIT_URL;
  const user = process.env.QBIT_USERNAME;
  const pass = process.env.QBIT_PASSWORD;
  if (!base || !user || !pass) {
    return {
      status: "error",
      error: "QBIT_URL / QBIT_USERNAME / QBIT_PASSWORD not configured",
      dlSpeed: 0, upSpeed: 0, dlSpeedLimit: 0, upSpeedLimit: 0,
      totalDl: 0, totalUp: 0, freeSpaceOnDisk: 0, globalRatio: 0,
      torrents: [], counts: { downloading: 0, seeding: 0, paused: 0, total: 0 },
      sessionDl: 0, sessionUp: 0,
    };
  }
  const url = stripSlash(base);
  try {
    const [versionRes, xferRes, torrentsRes] = await Promise.all([
      qbitFetch(url, "/api/v2/app/version", user, pass),
      qbitFetch(url, "/api/v2/transfer/info", user, pass),
      qbitFetch(url, "/api/v2/torrents/info?sort=dlspeed&reverse=true", user, pass),
    ]);
    const version = (await versionRes.text()).trim();
    const xfer = await xferRes.json();
    const torrentsRaw: any[] = await torrentsRes.json();

    // Preferences for free disk space
    let freeSpace = 0;
    let alltimeDl = 0;
    let alltimeUp = 0;
    try {
      const mainRes = await qbitFetch(url, "/api/v2/sync/maindata", user, pass);
      const main = await mainRes.json();
      freeSpace = Number(main?.server_state?.free_space_on_disk ?? 0);
      alltimeDl = Number(main?.server_state?.alltime_dl ?? 0);
      alltimeUp = Number(main?.server_state?.alltime_ul ?? 0);
    } catch {}

    const torrents: QbitTorrent[] = torrentsRaw.map((t: any) => ({
      hash: t.hash,
      name: t.name,
      progress: Number(t.progress ?? 0),
      dlspeed: Number(t.dlspeed ?? 0),
      upspeed: Number(t.upspeed ?? 0),
      eta: Number(t.eta ?? 0),
      state: t.state,
      size: Number(t.size ?? 0),
      numSeeds: Number(t.num_seeds ?? 0),
      numLeechs: Number(t.num_leechs ?? 0),
      ratio: Number(t.ratio ?? 0),
    }));

    let downloading = 0, seeding = 0, paused = 0;
    for (const t of torrentsRaw) {
      if (t.state?.includes("paused") || t.state === "pausedDL" || t.state === "pausedUP") paused++;
      else if (t.state?.includes("UP") || t.state === "uploading" || t.state === "stalledUP") seeding++;
      else downloading++;
    }

    // Largest remaining download
    let largestEta: { name: string; eta: number; remaining: number } | null = null;
    for (const t of torrentsRaw) {
      const p = Number(t.progress ?? 0);
      if (p >= 1) continue;
      const remaining = Number(t.size ?? 0) * (1 - p);
      if (!largestEta || remaining > largestEta.remaining) {
        largestEta = { name: t.name, eta: Number(t.eta ?? 0), remaining };
      }
    }

    // Per-category aggregation
    const catMap = new Map<string, { count: number; dlspeed: number; upspeed: number }>();
    for (const t of torrentsRaw) {
      const cat = (t.category && String(t.category)) || "uncategorized";
      const prev = catMap.get(cat) ?? { count: 0, dlspeed: 0, upspeed: 0 };
      catMap.set(cat, {
        count: prev.count + 1,
        dlspeed: prev.dlspeed + Number(t.dlspeed ?? 0),
        upspeed: prev.upspeed + Number(t.upspeed ?? 0),
      });
    }
    const perCategory = Array.from(catMap.entries())
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.count - a.count);

    return {
      status: "ok",
      version,
      dlSpeed: Number(xfer?.dl_info_speed ?? 0),
      upSpeed: Number(xfer?.up_info_speed ?? 0),
      dlSpeedLimit: Number(xfer?.dl_rate_limit ?? 0),
      upSpeedLimit: Number(xfer?.up_rate_limit ?? 0),
      totalDl: Number(xfer?.dl_info_data ?? 0),
      totalUp: Number(xfer?.up_info_data ?? 0),
      freeSpaceOnDisk: freeSpace,
      globalRatio: Number(xfer?.global_ratio ?? 0),
      torrents,
      counts: { downloading, seeding, paused, total: torrentsRaw.length },
      sessionDl: Number(xfer?.dl_info_data ?? 0),
      sessionUp: Number(xfer?.up_info_data ?? 0),
      alltimeDl,
      alltimeUp,
      largestEta,
      perCategory,
    };
  } catch (e) {
    qbitCookie = null;
    return {
      status: "error", error: errMsg(e),
      dlSpeed: 0, upSpeed: 0, dlSpeedLimit: 0, upSpeedLimit: 0,
      totalDl: 0, totalUp: 0, freeSpaceOnDisk: 0, globalRatio: 0,
      torrents: [], counts: { downloading: 0, seeding: 0, paused: 0, total: 0 },
      sessionDl: 0, sessionUp: 0,
    };
  }
});


// ---------- Host (systeminformation, local — nu mai trece prin Glances) ----------

export const getHost = createServerFn({ method: "GET" }).handler(async (): Promise<HostData> => {
  try {
    const si = await import("systeminformation");
    const os = await import("node:os");

    const [osInfo, currentLoad, mem, fsSize, netStats, cpuTemp, cpu, processes, dockerContainers] =
      await Promise.all([
        si.osInfo(),
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.networkStats(),
        si.cpuTemperature().catch(() => null),
        si.cpu(),
        si.processes(),
        si.dockerContainers().catch(() => [] as Awaited<ReturnType<typeof si.dockerContainers>>),
      ]);

    const loadAvg = os.loadavg() as [number, number, number];

    const disks = fsSize
      .filter((f) => f.size > 0)
      .map((f) => ({
        mount: f.mount,
        percent: Number(f.use ?? 0),
        usedBytes: Number(f.used ?? 0),
        totalBytes: Number(f.size ?? 0),
      }));

    const net = netStats
      .filter((n) => n.iface && !n.iface.startsWith("lo"))
      .map((n) => ({
        name: n.iface,
        rxSec: Number(n.rx_sec ?? 0),
        txSec: Number(n.tx_sec ?? 0),
      }));

    const sensors = cpuTemp && typeof cpuTemp.main === "number" && cpuTemp.main > 0
      ? [{ label: "CPU", value: cpuTemp.main, unit: "°C" }]
      : [];

    const topProcesses = (processes.list ?? [])
      .slice()
      .sort((a, b) => Number(b.cpu ?? 0) - Number(a.cpu ?? 0))
      .slice(0, 6)
      .map((p) => ({ name: p.name || "?", cpu: Number(p.cpu ?? 0), mem: Number(p.mem ?? 0) }));

    // Docker containers (Plex, Immich) — recunoscute dupa nume/imagine.
    // qBittorrent ruleaza ca proces systemd nativ, il gasim in lista de procese.
    const APP_MAP: Array<{ name: string; match: RegExp }> = [
      { name: "Plex", match: /plex/i },
      { name: "Immich", match: /immich/i },
      { name: "qBittorrent", match: /qbittorrent|qbit/i },
    ];

    const containerStats = await Promise.all(
      dockerContainers.map(async (c) => {
        try {
          const stats = await si.dockerContainerStats(c.id);
          return { container: c, stats: Array.isArray(stats) ? stats[0] : stats };
        } catch {
          return { container: c, stats: null };
        }
      }),
    );

    const apps: HostData["apps"] = APP_MAP.map(({ name, match }) => {
      const matchedContainers = containerStats.filter(
        ({ container }) => match.test(container.name ?? "") || match.test(container.image ?? ""),
      );
      if (matchedContainers.length > 0) {
        let cpuSum = 0;
        let memSum = 0;
        let rxSum = 0;
        let txSum = 0;
        for (const { stats } of matchedContainers) {
          if (!stats) continue;
          cpuSum += Number(stats.cpuPercent ?? 0);
          memSum += Number(stats.memPercent ?? 0);
          rxSum += Number(stats.netIO?.rx ?? 0);
          txSum += Number(stats.netIO?.wx ?? 0);
        }
        return { name, cpu: cpuSum, mem: memSum, netRx: rxSum, netTx: txSum, source: "container" as const };
      }
      const matchedProcs = (processes.list ?? []).filter((p) => match.test(p.name ?? p.command ?? ""));
      if (matchedProcs.length === 0) return null;
      const cpuSum = matchedProcs.reduce((s, p) => s + Number(p.cpu ?? 0), 0);
      const memSum = matchedProcs.reduce((s, p) => s + Number(p.mem ?? 0), 0);
      return { name, cpu: cpuSum, mem: memSum, source: "process" as const };
    }).filter((x): x is NonNullable<typeof x> => x !== null);

    return {
      status: "ok",
      configured: true,
      hostname: osInfo.hostname,
      os: `${osInfo.distro ?? ""} ${osInfo.release ?? ""}`.trim() || undefined,
      uptimeSec: os.uptime(),
      cpuPercent: Number(currentLoad.currentLoad ?? 0),
      cpuCores: cpu.cores,
      loadAvg,
      memPercent: mem.total ? (mem.active / mem.total) * 100 : 0,
      memUsedBytes: mem.active,
      memTotalBytes: mem.total,
      swapPercent: mem.swaptotal ? (mem.swapused / mem.swaptotal) * 100 : 0,
      disks,
      net,
      sensors,
      topProcesses,
      apps,
      // systeminformation nu expune usor I/O per-proces cross-platform ca Glances;
      // lasam lista goala mai degraba decat sa afisam date incorecte.
      diskIO: [],
    };
  } catch (e) {
    return { status: "error", configured: true, error: errMsg(e) };
  }
});
