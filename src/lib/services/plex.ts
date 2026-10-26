import { createServerFn } from "@tanstack/react-start";
import { cachedAsync, fetchJson, errMsg, type ServiceStatus } from "./shared";
import {
  discoverPlexUrl,
  plexQualityFromMedia,
  isHdrLabel,
  type PlexApiResponse,
  type PlexMetadataItem,
  type PlexStream,
} from "./plex-shared";

export type { ShowEpisodeInfo, ShowStatusData } from "./plex-library";

// ---------- Types ----------

export interface PlexSession {
  title: string;
  grandparentTitle?: string;
  ratingKey?: string;
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
  // Posterul (la episoade, al serialului) și fundalul — prin proxy-ul /api/plex-thumb.
  thumbPath?: string;
  artPath?: string;
  // Calitate și redare (mapPlexSessions).
  playbackMode?: "direct" | "direct-stream" | "transcode";
  sourceQuality?: string;
  streamQuality?: string;
  videoCodec?: string;
  // Codecul video al fișierului, doar la transcodare (altfel = `videoCodec`).
  sourceVideoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  hwTranscode?: boolean;
  // Sunetul convertit (codecul sursei → cel livrat), independent de video.
  audioTranscode?: { from?: string; to?: string };
  burnedSubtitle?: boolean;
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

// Numărul de iteme dintr-o bibliotecă se schimbă rar — cache 5 minute per secțiune.
const libraryCountCache = new Map<string, { count: number | null; expiresAt: number }>();
const LIBRARY_COUNT_TTL_MS = 5 * 60 * 1000;

// Indexul „văzut de X” — sursa unică pentru starea și data vizionării în
// Bibliotecă. Spre deosebire de `userHistory` (plafonat la 50/user), ține TOT
// istoricul Plex (per key → ultimul viewedAt), ca titlurile văzute demult să
// nu dispară.
export interface PlexWatchedIndex {
  ratingKeys: Map<string, number>; // ratingKey -> ultimul viewedAt
  titleKeys: Map<string, number>; // titlu|sezon|episod (sau movie|titlu) -> ultimul viewedAt
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
  return getWatchedAt(index, item) != null;
}

// Ca `isItemWatched`, dar cu data — pentru „văzut pe <dată>”.
export function getWatchedAt(
  index: PlexWatchedIndex,
  item: {
    ratingKey?: string | null;
    title: string;
    show?: string | null;
    season?: number | null;
    episode?: number | null;
  },
): number | null {
  if (item.ratingKey && index.ratingKeys.has(item.ratingKey)) {
    return index.ratingKeys.get(item.ratingKey) ?? 0;
  }
  const key = item.show
    ? episodeKeyFor(item.show, item.season, item.episode)
    : `movie|${item.title}`;
  if (index.titleKeys.has(key)) return index.titleKeys.get(key) ?? 0;
  return null;
}

// Owner-ul serverului (contul lui PLEX_TOKEN) — pentru rezerva „Marchează ca
// vizionat”, care setează viewCount fără să scrie în istoric. viewCount-ul
// văzut prin token e al owner-ului, deci rezerva e sigură doar pentru el, nu
// pentru utilizatorii Plex Home.
let plexOwnerUsernameCache: { url: string; username: string | null; expiresAt: number } | null =
  null;

export async function getPlexOwnerUsername(): Promise<string | null> {
  const token = process.env.PLEX_TOKEN;
  if (!token) return null;
  try {
    const { url } = await discoverPlexUrl(token, process.env.PLEX_URL);
    if (
      plexOwnerUsernameCache &&
      plexOwnerUsernameCache.url === url &&
      plexOwnerUsernameCache.expiresAt > Date.now()
    ) {
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

// viewCount direct pe item-ele date (o singură cerere) — rezerva owner-ului,
// cu data ultimei vizionări.
export async function getPlexViewedRatingKeys(ratingKeys: string[]): Promise<Map<string, number>> {
  if (ratingKeys.length === 0) return new Map();
  const token = process.env.PLEX_TOKEN;
  if (!token) return new Map();
  try {
    const { url } = await discoverPlexUrl(token, process.env.PLEX_URL);
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const json = await fetchJson<PlexApiResponse>(
      `${url}/library/metadata/${ratingKeys.join(",")}`,
      { headers },
      12000,
    );
    const items = json?.MediaContainer?.Metadata ?? [];
    const viewed = new Map<string, number>();
    for (const it of items) {
      if (it.ratingKey != null && Number(it.viewCount ?? 0) > 0) {
        viewed.set(String(it.ratingKey), Number(it.lastViewedAt ?? 0));
      }
    }
    return viewed;
  } catch {
    return new Map();
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
  viewsByAccount: Record<string, PlexView[]>;
  accountNames: Record<string, string>;
  expiresAt: number;
} | null = null;

// O vizionare din istoric, neplafonată — pentru „utilizator activ” la contribuții.
export interface PlexView {
  ratingKey?: string;
  type: string;
  viewedAt: number;
  // ID-ul local al dispozitivului — pentru indiciul HDR.
  deviceId?: number;
}

// Vizionările din tot istoricul Plex, grupate pe ID-ul contului Plex — nu pe
// nume: /accounts dă numele afișat („Dragomir Andreea”), nu username-ul de la
// înregistrare. null dacă Plex nu răspunde (≠ „nimeni nu s-a uitat”).
export async function getPlexViewsByAccount(): Promise<Record<string, PlexView[]> | null> {
  const token = process.env.PLEX_TOKEN;
  if (!token) return null;
  try {
    const { url } = await discoverPlexUrl(token, process.env.PLEX_URL);
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    return (await fetchPlexHistory(url, headers)).viewsByAccount;
  } catch {
    return null;
  }
}

// Istoricul unui user — din cache-ul lui fetchPlexHistory, populat cu o cerere
// reală dacă e rece (altfel pagina de detalii ar rămâne goală după restart).
// Grupat pe numele afișat, aflat după ID-ul contului; username-ul e rezervă.
export async function getPlexUserHistory(
  plexAccountId: number | null,
  username: string | null,
): Promise<PlexHistoryEntry[]> {
  const token = process.env.PLEX_TOKEN;
  if (!token) return [];
  try {
    const { url } = await discoverPlexUrl(token, process.env.PLEX_URL);
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const history = await fetchPlexHistory(url, headers);
    const name =
      (plexAccountId != null ? history.accountNames[String(plexAccountId)] : undefined) ?? username;
    return name ? (history.userHistory[name] ?? []) : [];
  } catch {
    return [];
  }
}

// Cheia unui cont în istoricul Plex: numele afișat din /accounts, după ID-ul
// contului; username-ul de la înregistrare e rezervă (la mulți diferă).
export async function getPlexHistoryName(
  plexAccountId: number | null,
  username: string | null,
): Promise<string | null> {
  const token = process.env.PLEX_TOKEN;
  if (!token || plexAccountId == null) return username;
  try {
    const { url } = await discoverPlexUrl(token, process.env.PLEX_URL);
    const headers = { Accept: "application/json", "X-Plex-Token": token };
    const history = await fetchPlexHistory(url, headers);
    return history.accountNames[String(plexAccountId)] ?? username;
  } catch {
    return username;
  }
}

// Indexul „văzut” pentru toți userii — „cine a mai văzut” din drawer.
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

const HISTORY_PAGE_SIZE = 1000;

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
  viewsByAccount: Record<string, PlexView[]>;
  accountNames: Record<string, string>;
}> {
  if (plexHistoryCache && plexHistoryCache.url === url && plexHistoryCache.expiresAt > Date.now()) {
    return {
      episodesToday: plexHistoryCache.episodesToday,
      activeUsersToday: plexHistoryCache.activeUsersToday,
      userHistory: plexHistoryCache.userHistory,
      watchedIndexByUser: plexHistoryCache.watchedIndexByUser,
      todayViews: plexHistoryCache.todayViews,
      activeUsersTodayList: plexHistoryCache.activeUsersTodayList,
      viewsByAccount: plexHistoryCache.viewsByAccount,
      accountNames: plexHistoryCache.accountNames,
    };
  }
  // Tot istoricul, pe pagini de 1000, fără plafon (~1000 de intrări pe an).
  const entries: PlexMetadataItem[] = [];
  for (;;) {
    const page = await fetchJson<PlexApiResponse>(
      `${url}/status/sessions/history/all?sort=viewedAt:desc&X-Plex-Container-Start=${entries.length}&X-Plex-Container-Size=${HISTORY_PAGE_SIZE}`,
      { headers },
      12000,
    );
    const items: PlexMetadataItem[] = page?.MediaContainer?.Metadata ?? [];
    entries.push(...items);
    const total = Number(page?.MediaContainer?.totalSize ?? 0);
    if (items.length < HISTORY_PAGE_SIZE || (total > 0 && entries.length >= total)) break;
  }

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
    // Ignorat, cu rezervă mai jos.
  }

  const historyByUser = new Map<string, PlexHistoryEntry[]>();
  const watchedIndexByUser = new Map<string, PlexWatchedIndex>();
  const viewsByAccount: Record<string, PlexView[]> = {};
  // „Azi” în ora României, nu UTC.
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

    if (accountId != null) {
      (viewsByAccount[String(accountId)] ??= []).push({
        ratingKey,
        type: String(e.type ?? "unknown"),
        viewedAt,
        deviceId: e.deviceID != null ? Number(e.deviceID) : undefined,
      });
    }

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

    // Neplafonat (vezi PlexWatchedIndex) — ultimul viewedAt per key.
    const watchedIndex = watchedIndexByUser.get(wkey) ?? {
      ratingKeys: new Map<string, number>(),
      titleKeys: new Map<string, number>(),
    };
    if (ratingKey && viewedAt > (watchedIndex.ratingKeys.get(ratingKey) ?? -1)) {
      watchedIndex.ratingKeys.set(ratingKey, viewedAt);
    }
    const tkey = show ? episodeKeyFor(show, season, episode) : `movie|${title}`;
    if (viewedAt > (watchedIndex.titleKeys.get(tkey) ?? -1)) {
      watchedIndex.titleKeys.set(tkey, viewedAt);
    }
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
    viewsByAccount,
    accountNames: Object.fromEntries(
      Array.from(accountMap.entries(), ([id, name]) => [String(id), name]),
    ),
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
    const ts = s.TranscodeSession;
    const videoDecision = ts?.videoDecision ?? video?.decision ?? part?.decision;
    const audioDecision = ts?.audioDecision ?? audio?.decision ?? part?.decision;
    // Eticheta principală descrie video-ul, ca în Plex: "transcode" = video
    // re-encodat; "copy" = doar reîmpachetat; nimic = direct play. Un video
    // copiat cu sunetul convertit NU e transcodare video — sunetul apare
    // separat (`audioTranscode`).
    const videoTranscoded = videoDecision === "transcode";
    const audioTranscoded = audioDecision === "transcode";
    const decisions = [videoDecision, audioDecision, part?.decision];
    const playbackMode: "direct" | "direct-stream" | "transcode" = videoTranscoded
      ? "transcode"
      : decisions.includes("copy") || decisions.includes("transcode")
        ? "direct-stream"
        : "direct";
    // La direct play fluxul livrat e sursa — eticheta din stream, care are HDR-ul.
    const mediaQuality = plexQualityFromMedia(media);
    const sourceQuality = sourceQualityFromStream(video) ?? mediaQuality;
    const streamQuality = playbackMode === "transcode" ? mediaQuality : sourceQuality;
    return {
      title: s.title ?? "Unknown",
      grandparentTitle: s.grandparentTitle,
      ratingKey: s.ratingKey,
      type: s.type ?? "",
      user: s?.User?.title ?? "?",
      device: s?.Player?.device ?? s?.Player?.product ?? "?",
      player: s?.Player?.title ?? "?",
      playerState: s?.Player?.state ?? "playing",
      progress: dur > 0 ? off / dur : 0,
      viewOffsetMs: off,
      durationMs: dur,
      videoDecision,
      audioDecision,
      bitrateKbps: Number(media?.bitrate ?? 0) || undefined,
      thumbPath: s.grandparentThumb ?? s.thumb,
      artPath: s.grandparentArt ?? s.art,
      playbackMode,
      sourceQuality: sourceQuality ?? undefined,
      streamQuality: streamQuality ?? undefined,
      videoCodec: ts?.videoCodec ?? media?.videoCodec ?? video?.codec,
      sourceVideoCodec: videoTranscoded ? ts?.sourceVideoCodec : undefined,
      audioCodec: ts?.audioCodec ?? media?.audioCodec ?? audio?.codec,
      audioChannels: ts?.audioChannels ?? media?.audioChannels ?? audio?.channels,
      hwTranscode: videoTranscoded && !!(ts?.transcodeHwFullPipeline || ts?.transcodeHwRequested),
      audioTranscode: audioTranscoded
        ? { from: ts?.sourceAudioCodec ?? audio?.codec, to: ts?.audioCodec }
        : undefined,
      burnedSubtitle: ts?.subtitleDecision === "burn",
    };
  });
}

// La transcodare, `Media`/`Part` descriu fluxul LIVRAT; rezoluția sursei apare
// doar în `displayTitle`-ul stream-ului video, de unde o scoatem.
function sourceQualityFromStream(video: PlexStream | undefined): string | null {
  const title = video?.displayTitle;
  if (!title) return null;
  const m = /^\s*(4K|2160p?|1080p?|720p?|576p?|480p?|SD)\b/i.exec(title);
  if (!m) return null;
  const token = m[1].toUpperCase();
  const hdr = isHdrLabel(title) ? " HDR" : "";
  if (token === "4K" || token.startsWith("2160")) return `4K${hdr}`;
  if (token === "SD") return "SD";
  return `${token.replace(/P$/, "").toLowerCase()}p${hdr}`;
}

// ---------- Doar sesiuni curente (rapid — pentru "cine vizionează acum") ----------

export const getPlexSessions = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ status: ServiceStatus; error?: string; sessions: PlexSession[] }> => {
    await (await import("../auth/admin.server")).requireAuth();
    // Cache scurt, comun: clientul cere la 1s, dar zece tab-uri nu înseamnă
    // zece cereri pe secundă către Plex.
    return cachedAsync("plexSessions", 900, collectPlexSessions);
  },
);

async function collectPlexSessions(): Promise<{
  status: ServiceStatus;
  error?: string;
  sessions: PlexSession[];
}> {
  {
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
  }
}

// ---------- Status live (sesiuni, biblioteci, recent added) ----------

export const getPlex = createServerFn({ method: "GET" }).handler(async (): Promise<PlexData> => {
  await (await import("../auth/admin.server")).requireAuth();
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

    // Eșec total — eroare, nu date parțiale.
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
        let count: number | null;
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
        ratingKey: s.ratingKey,
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
