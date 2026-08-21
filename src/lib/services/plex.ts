import { createServerFn } from "@tanstack/react-start";
import { fetchJson, errMsg, type ServiceStatus } from "./shared";
import {
  discoverPlexUrl,
  type PlexApiResponse,
  type PlexMetadataItem,
  type PlexStream,
} from "./plex-shared";

export type { ShowEpisodeInfo, ShowStatusData } from "./plex-library";
export { checkPlexHasEpisode, getPlexEpisodesInSeason, checkPlexHasTitle } from "./plex-library";

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
  episodesToday?: number;
  activeUsersToday?: number;
  userHistory?: Record<string, PlexHistoryEntry[]>;
  todayViews?: PlexHistoryEntry[];
  activeUsersTodayList?: Array<{ user: string; count: number }>;
}

export interface PlexHistoryEntry {
  title: string;
  show?: string;
  season?: number;
  episode?: number;
  ratingKey?: string;
  type: string;
  viewedAt: number;
  player?: string;
  user?: string;
}

// ---------- Istoric vizionare (agregare + cache) ----------

// Numărul de iteme dintr-o bibliotecă se schimbă rar — cache 5 minute per secțiune,
// ca să nu refacem cereri "Size=0" la fiecare poll de 10s.
const libraryCountCache = new Map<string, { count: number | null; expiresAt: number }>();
const LIBRARY_COUNT_TTL_MS = 5 * 60 * 1000;

// Index "văzut de X" — sursă unică de adevăr pentru orice ecran care
// afișează starea de vizionare (listă Bibliotecă + drawer de detalii).
// Spre deosebire de `userHistory` (plafonat la 50/user, gândit doar pentru
// afișarea istoricului recent), acest index acoperă TOATE intrările primite
// de la Plex (până la 1000), ca un utilizator activ să nu "piardă" din
// matching titluri vizionate mai demult doar pentru că a mai văzut multe
// altele între timp.
export interface PlexWatchedIndex {
  ratingKeys: Set<string>;
  titleKeys: Set<string>;
}

function episodeKeyFor(show: string, season?: number | null, episode?: number | null): string {
  return `${show}|${season}|${episode}`;
}

export function isItemWatched(
  index: PlexWatchedIndex,
  item: {
    ratingKey?: string | null;
    title: string;
    show?: string | null;
    season?: number | null;
    episode?: number | null;
  },
): boolean {
  if (item.ratingKey && index.ratingKeys.has(item.ratingKey)) return true;
  const key = item.show ? episodeKeyFor(item.show, item.season, item.episode) : `movie|${item.title}`;
  return index.titleKeys.has(key);
}

// Contul "owner" al serverului (cel căruia îi aparține PLEX_TOKEN) — folosit
// ca fallback pentru "Marchează ca vizionat" din Plex, care setează
// viewCount direct pe item FĂRĂ să scrie o intrare de istoric/scrobble
// (deci invizibil pentru `getPlexWatchedIndex`, oricât de bine ar potrivi
// ratingKey-ul). viewCount raportat prin PLEX_TOKEN e scopat la contul
// acelui token, deci fallback-ul e sigur doar pentru owner, nu pentru
// utilizatorii gestionați (Plex Home) — aceia au propria stare, invizibilă
// prin tokenul owner-ului.
let plexOwnerUsernameCache: { url: string; username: string | null; expiresAt: number } | null = null;

export async function getPlexOwnerUsername(): Promise<string | null> {
  const token = process.env.PLEX_TOKEN;
  if (!token) return null;
  try {
    const { url } = await discoverPlexUrl(token, process.env.PLEX_URL);
    if (plexOwnerUsernameCache && plexOwnerUsernameCache.url === url && plexOwnerUsernameCache.expiresAt > Date.now()) {
      return plexOwnerUsernameCache.username;
    }
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const accountsJson = await fetchJson<PlexApiResponse>(`${url}/accounts`, { headers }, 8000);
    const accounts = accountsJson?.MediaContainer?.Account ?? [];
    const owner = accounts.find((a) => Number(a?.id) === 1);
    const username = (owner ? String(owner?.name ?? owner?.title ?? "").trim() : "") || null;
    plexOwnerUsernameCache = { url, username, expiresAt: Date.now() + 5 * 60 * 1000 };
    return username;
  } catch {
    return null;
  }
}

// Verifică viewCount direct pe item-ele date (un singur request batch către
// Plex) — folosit doar ca fallback pentru owner, când istoricul n-are nimic.
export async function getPlexViewedRatingKeys(ratingKeys: string[]): Promise<Set<string>> {
  if (ratingKeys.length === 0) return new Set();
  const token = process.env.PLEX_TOKEN;
  if (!token) return new Set();
  try {
    const { url } = await discoverPlexUrl(token, process.env.PLEX_URL);
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const json = await fetchJson<PlexApiResponse>(
      `${url}/library/metadata/${ratingKeys.join(",")}`,
      { headers },
      12000,
    );
    const items = json?.MediaContainer?.Metadata ?? [];
    const viewed = new Set<string>();
    for (const it of items) {
      if (it.ratingKey != null && Number(it.viewCount ?? 0) > 0) viewed.add(String(it.ratingKey));
    }
    return viewed;
  } catch {
    return new Set();
  }
}

let plexHistoryCache: {
  url: string;
  episodesToday: number;
  activeUsersToday: number;
  userHistory: Record<string, PlexHistoryEntry[]>;
  watchedIndexByUser: Record<string, PlexWatchedIndex>;
  todayViews: PlexHistoryEntry[];
  activeUsersTodayList: Array<{ user: string; count: number }>;
  expiresAt: number;
} | null = null;

// Istoricul de vizionare al unui user Plex — folosește cache-ul intern al
// fetchPlexHistory (rapid dacă e deja cald, de la pollingul dashboard-ului),
// dar se auto-populează cu o cerere reală dacă e rece (ex. server proaspăt
// repornit, nimeni nu s-a uitat încă pe Acasă) — altfel pagina de detalii ar
// rămâne mereu goală fără motiv vizibil.
export async function getPlexUserHistory(username: string): Promise<PlexHistoryEntry[]> {
  const token = process.env.PLEX_TOKEN;
  if (!token) return [];
  try {
    const { url } = await discoverPlexUrl(token, process.env.PLEX_URL);
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const history = await fetchPlexHistory(url, headers);
    return history.userHistory[username] ?? [];
  } catch {
    return [];
  }
}

// Istoricul TUTUROR utilizatorilor Plex — folosit pentru "cine a mai văzut
// acest titlu" în pagina de bibliotecă de pe Acasă. Aceeași sursă/cache ca
// getPlexUserHistory, doar că întoarce toată harta, nu doar un user.
export async function getAllPlexUserHistory(): Promise<Record<string, PlexHistoryEntry[]>> {
  const token = process.env.PLEX_TOKEN;
  if (!token) return {};
  try {
    const { url } = await discoverPlexUrl(token, process.env.PLEX_URL);
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const history = await fetchPlexHistory(url, headers);
    return history.userHistory;
  } catch {
    return {};
  }
}

// Index "văzut" neplafonat, pentru un singur user — folosit de listă/drawer
// prin `isItemWatched`. Vezi comentariul de pe `PlexWatchedIndex`.
export async function getPlexWatchedIndex(username: string): Promise<PlexWatchedIndex> {
  const token = process.env.PLEX_TOKEN;
  if (!token) return { ratingKeys: new Set(), titleKeys: new Set() };
  try {
    const { url } = await discoverPlexUrl(token, process.env.PLEX_URL);
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const history = await fetchPlexHistory(url, headers);
    return (
      history.watchedIndexByUser[username] ?? { ratingKeys: new Set(), titleKeys: new Set() }
    );
  } catch {
    return { ratingKeys: new Set(), titleKeys: new Set() };
  }
}

// La fel ca `getPlexWatchedIndex`, dar pentru toți userii deodată — folosit
// de drawer pentru "alți utilizatori care au văzut".
export async function getAllPlexWatchedIndexes(): Promise<Record<string, PlexWatchedIndex>> {
  const token = process.env.PLEX_TOKEN;
  if (!token) return {};
  try {
    const { url } = await discoverPlexUrl(token, process.env.PLEX_URL);
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const history = await fetchPlexHistory(url, headers);
    return history.watchedIndexByUser;
  } catch {
    return {};
  }
}

async function fetchPlexHistory(
  url: string,
  headers: Record<string, string>,
): Promise<{
  episodesToday: number;
  activeUsersToday: number;
  userHistory: Record<string, PlexHistoryEntry[]>;
  watchedIndexByUser: Record<string, PlexWatchedIndex>;
  todayViews: PlexHistoryEntry[];
  activeUsersTodayList: Array<{ user: string; count: number }>;
}> {
  if (plexHistoryCache && plexHistoryCache.url === url && plexHistoryCache.expiresAt > Date.now()) {
    return {
      episodesToday: plexHistoryCache.episodesToday,
      activeUsersToday: plexHistoryCache.activeUsersToday,
      userHistory: plexHistoryCache.userHistory,
      watchedIndexByUser: plexHistoryCache.watchedIndexByUser,
      todayViews: plexHistoryCache.todayViews,
      activeUsersTodayList: plexHistoryCache.activeUsersTodayList,
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

  const historyByUser = new Map<string, PlexHistoryEntry[]>();
  const watchedIndexByUser = new Map<string, PlexWatchedIndex>();
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

  for (const e of entries) {
    const viewedAt = Number(e.viewedAt ?? 0);
    const accountId = e?.accountID != null ? Number(e.accountID) : null;
    const fromMap = accountId != null ? accountMap.get(accountId) : undefined;
    const fromInline = typeof e?.User?.title === "string" ? e.User.title : undefined;
    const user =
      fromMap ?? fromInline ?? (accountId != null ? `Utilizator #${accountId}` : "Necunoscut");
    const wkey = user;
    const title = String(e.title ?? "—");
    const show = e.grandparentTitle ? String(e.grandparentTitle) : undefined;
    const season = e.parentIndex != null ? Number(e.parentIndex) : undefined;
    const episode = e.index != null ? Number(e.index) : undefined;
    const ratingKey = e.ratingKey != null ? String(e.ratingKey) : undefined;

    const list = historyByUser.get(wkey) ?? [];
    if (list.length < 100) {
      list.push({
        title,
        show,
        season,
        episode,
        ratingKey,
        type: String(e.type ?? "unknown"),
        viewedAt,
        player: typeof e?.Player?.title === "string" ? e.Player.title : undefined,
      });
      historyByUser.set(wkey, list);
    }

    // Neplafonat, spre deosebire de `historyByUser` — vezi comentariul de
    // pe `PlexWatchedIndex`.
    const watchedIndex = watchedIndexByUser.get(wkey) ?? {
      ratingKeys: new Set<string>(),
      titleKeys: new Set<string>(),
    };
    if (ratingKey) watchedIndex.ratingKeys.add(ratingKey);
    watchedIndex.titleKeys.add(show ? episodeKeyFor(show, season, episode) : `movie|${title}`);
    watchedIndexByUser.set(wkey, watchedIndex);
    if (viewedAt >= startOfTodaySec) {
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
      episodesToday++;
      todayUsers.add(wkey);
      todayViews.push(entry);
      todayUserCounts.set(wkey, (todayUserCounts.get(wkey) ?? 0) + 1);
    }
  }

  const userHistory: Record<string, PlexHistoryEntry[]> = {};
  for (const [k, list] of historyByUser.entries()) {
    userHistory[k] = list.sort((a, b) => b.viewedAt - a.viewedAt).slice(0, 50);
  }

  const result = {
    episodesToday,
    activeUsersToday: todayUsers.size,
    userHistory,
    watchedIndexByUser: Object.fromEntries(watchedIndexByUser),
    todayViews: todayViews.sort((a, b) => b.viewedAt - a.viewedAt),
    activeUsersTodayList: Array.from(todayUserCounts.entries())
      .map(([user, count]) => ({ user, count }))
      .sort((a, b) => b.count - a.count),
  };
  plexHistoryCache = { url, ...result, expiresAt: Date.now() + 60_000 };
  return result;
}

// ---------- Sesiuni (mapare comună) ----------

function mapPlexSessions(sessionsMd: PlexMetadataItem[]): PlexSession[] {
  return sessionsMd.map((s: PlexMetadataItem) => {
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
}

// ---------- Doar sesiuni curente (rapid — pentru "cine vizionează acum") ----------

export const getPlexSessions = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ status: ServiceStatus; error?: string; sessions: PlexSession[] }> => {
    const token = process.env.PLEX_TOKEN;
    if (!token) {
      return { status: "error", error: "PLEX_TOKEN not configured", sessions: [] };
    }
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    try {
      const { url } = await discoverPlexUrl(token, process.env.PLEX_URL);
      const sessionsJson = await fetchJson<PlexApiResponse>(`${url}/status/sessions`, { headers });
      const sessionsMd = sessionsJson?.MediaContainer?.Metadata ?? [];
      return { status: "ok", sessions: mapPlexSessions(sessionsMd) };
    } catch (e) {
      return { status: "error", error: errMsg(e), sessions: [] };
    }
  },
);

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
    };
  }
  const headers = { Accept: "application/json", "X-Plex-Token": token };

  try {
    const discovered = await discoverPlexUrl(token, base);
    const url = discovered.url;
    const [rootJson, sessionsJson, libsJson, history] = await Promise.all([
      fetchJson<PlexApiResponse>(`${url}/`, { headers }).catch(() => null),
      fetchJson<PlexApiResponse>(`${url}/status/sessions`, { headers }).catch(() => null),
      fetchJson<PlexApiResponse>(`${url}/library/sections`, { headers }).catch(() => null),
      fetchPlexHistory(url, headers).catch(() => ({
        episodesToday: 0,
        activeUsersToday: 0,
        userHistory: {},
        todayViews: [],
        activeUsersTodayList: [],
      })),
    ]);

    // Eșec total (nu doar o cerere izolată) — tratăm ca eroare, nu ca date parțiale
    if (!rootJson && !sessionsJson && !libsJson) {
      throw new Error("Plex nu a răspuns la nicio cerere");
    }

    const mc = rootJson?.MediaContainer ?? {};
    const sessionsMd = sessionsJson?.MediaContainer?.Metadata ?? [];
    const libsMd = libsJson?.MediaContainer?.Directory ?? [];

    const libraries: PlexLibrary[] = await Promise.all(
      libsMd.map(async (l: PlexDirectoryLike) => {
        const cacheKey = `${url}:${l.key}`;
        const cached = libraryCountCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          return {
            key: String(l.key),
            title: String(l.title),
            type: String(l.type),
            count: cached.count,
          };
        }
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
        libraryCountCache.set(cacheKey, { count, expiresAt: Date.now() + LIBRARY_COUNT_TTL_MS });
        return { key: String(l.key), title: String(l.title), type: String(l.type), count };
      }),
    );

    const sessions: PlexSession[] = mapPlexSessions(sessionsMd);

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
      episodesToday: history.episodesToday,
      activeUsersToday: history.activeUsersToday,
      userHistory: history.userHistory,
      todayViews: history.todayViews,
      activeUsersTodayList: history.activeUsersTodayList,
    };
  } catch (e) {
    return { status: "error", error: errMsg(e), sessions: [], libraries: [] };
  }
});

interface PlexDirectoryLike {
  key?: string;
  title?: string;
  type?: string;
}
