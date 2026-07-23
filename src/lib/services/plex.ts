import { createServerFn } from "@tanstack/react-start";
import { fetchJson, errMsg, type ServiceStatus } from "./shared";
import { discoverPlexUrl, type PlexApiResponse, type PlexMetadataItem, type PlexStream } from "./plex-shared";

export type { ShowEpisodeInfo, ShowStatusData } from "./plex-library";
export {
  checkPlexHasEpisode,
  getPlexEpisodesInSeason,
  checkPlexHasTitle,
  getPlexEpisodesInSeasonInternal,
  checkPlexHasTitleInternal,
  getShowStatus,
} from "./plex-library";

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

// ---------- Istoric vizionare (agregare + cache) ----------

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
    const accounts = accountsJson?.MediaContainer?.Account ?? [];
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

// ---------- Status live (sesiuni, biblioteci, recent added) ----------

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
      .filter((l: PlexDirectoryLike) => l.type === "movie")
      .map((l: PlexDirectoryLike) => l.key);
    const showLibKeys = libsMd
      .filter((l: PlexDirectoryLike) => l.type === "show")
      .map((l: PlexDirectoryLike) => l.key);

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
      libsMd.map(async (l: PlexDirectoryLike) => {
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

interface PlexDirectoryLike {
  key?: string;
  title?: string;
  type?: string;
}
