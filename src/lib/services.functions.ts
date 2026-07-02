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
    const [rootJson, sessionsJson, libsJson, recentJson] = await Promise.all([
      fetchJson<any>(`${url}/`, { headers }),
      fetchJson<any>(`${url}/status/sessions`, { headers }),
      fetchJson<any>(`${url}/library/sections`, { headers }),
      fetchJson<any>(`${url}/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=8`, { headers }).catch(() => ({ MediaContainer: { Metadata: [] } })),
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
    };
  } catch (e) {
    return { status: "error", error: errMsg(e), sessions: [], libraries: [], recentlyAdded: [] };
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
    const [version, stats, jobs] = await Promise.all([
      fetchJson<any>(`${url}/api/server/version`, { headers }).catch(() => null),
      fetchJson<any>(`${url}/api/server/statistics`, { headers }),
      fetchJson<any>(`${url}/api/jobs`, { headers }).catch(() => null),
    ]);

    const usageByUser = Array.isArray(stats?.usageByUser)
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

    return {
      status: "ok",
      version: version ? `${version.major}.${version.minor}.${version.patch}` : undefined,
      totalAssets: Number(stats?.photos ?? 0) + Number(stats?.videos ?? 0),
      photos: Number(stats?.photos ?? 0),
      videos: Number(stats?.videos ?? 0),
      usageBytes: Number(stats?.usage ?? 0),
      usageByUser,
      activeJobs,
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
    try {
      const mainRes = await qbitFetch(url, "/api/v2/sync/maindata", user, pass);
      const main = await mainRes.json();
      freeSpace = Number(main?.server_state?.free_space_on_disk ?? 0);
    } catch {}

    const torrents: QbitTorrent[] = torrentsRaw.slice(0, 40).map((t: any) => ({
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
      globalRatio: Number(xfer?.global_ratio ?? 0) || (Number(xfer?.up_info_data ?? 0) / Math.max(1, Number(xfer?.dl_info_data ?? 1))),
      torrents,
      counts: { downloading, seeding, paused, total: torrentsRaw.length },
    };
  } catch (e) {
    qbitCookie = null;
    return {
      status: "error", error: errMsg(e),
      dlSpeed: 0, upSpeed: 0, dlSpeedLimit: 0, upSpeedLimit: 0,
      totalDl: 0, totalUp: 0, freeSpaceOnDisk: 0, globalRatio: 0,
      torrents: [], counts: { downloading: 0, seeding: 0, paused: 0, total: 0 },
    };
  }
});

// ---------- Host (Glances) ----------

export const getHost = createServerFn({ method: "GET" }).handler(async (): Promise<HostData> => {
  const base = process.env.GLANCES_URL;
  if (!base) return { status: "error", configured: false, error: "GLANCES_URL not configured. Install Glances on your mini-PC and add the secret." };
  const url = stripSlash(base);

  // Try API v4 first, then v3
  async function tryApi(v: string): Promise<any> {
    return fetchJson<any>(`${url}/api/${v}/all`);
  }
  try {
    let all: any;
    try {
      all = await tryApi("4");
    } catch {
      all = await tryApi("3");
    }

    const system = all.system ?? {};
    const cpu = all.cpu ?? all.quicklook ?? {};
    const load = all.load ?? {};
    const mem = all.mem ?? {};
    const memswap = all.memswap ?? {};
    const fsRaw = Array.isArray(all.fs) ? all.fs : [];
    const netRaw = Array.isArray(all.network) ? all.network : [];
    const sensorsRaw = Array.isArray(all.sensors) ? all.sensors : [];
    const processlist = Array.isArray(all.processlist) ? all.processlist : [];
    const uptime = all.uptime;

    return {
      status: "ok",
      configured: true,
      hostname: system.hostname,
      os: `${system.os_name ?? ""} ${system.os_version ?? ""}`.trim() || undefined,
      uptimeSec: typeof uptime === "number" ? uptime : parseUptime(uptime),
      cpuPercent: Number(cpu.total ?? cpu.cpu_percent ?? 0),
      cpuCores: Number(all.core?.log ?? all.core?.phys ?? 0) || undefined,
      loadAvg: [Number(load.min1 ?? 0), Number(load.min5 ?? 0), Number(load.min15 ?? 0)],
      memPercent: Number(mem.percent ?? 0),
      memUsedBytes: Number(mem.used ?? 0),
      memTotalBytes: Number(mem.total ?? 0),
      swapPercent: Number(memswap.percent ?? 0),
      disks: fsRaw.map((f: any) => ({
        mount: f.mnt_point ?? f.device_name ?? "?",
        percent: Number(f.percent ?? 0),
        usedBytes: Number(f.used ?? 0),
        totalBytes: Number(f.size ?? 0),
      })),
      net: netRaw
        .filter((n: any) => (n.interface_name || n.name) && !(n.interface_name || n.name).startsWith("lo"))
        .map((n: any) => ({
          name: n.interface_name ?? n.name,
          rxSec: Number(n.bytes_recv_rate_per_sec ?? n.rx ?? 0),
          txSec: Number(n.bytes_sent_rate_per_sec ?? n.tx ?? 0),
        })),
      sensors: sensorsRaw.slice(0, 8).map((s: any) => ({
        label: s.label ?? "sensor",
        value: Number(s.value ?? 0),
        unit: s.unit ?? "",
      })),
      topProcesses: processlist
        .slice()
        .sort((a: any, b: any) => Number(b.cpu_percent ?? 0) - Number(a.cpu_percent ?? 0))
        .slice(0, 6)
        .map((p: any) => ({
          name: Array.isArray(p.name) ? p.name.join(" ") : p.name ?? p.cmdline?.[0] ?? "?",
          cpu: Number(p.cpu_percent ?? 0),
          mem: Number(p.memory_percent ?? 0),
        })),
    };
  } catch (e) {
    return { status: "error", configured: true, error: errMsg(e) };
  }
});

function parseUptime(u: unknown): number | undefined {
  if (typeof u !== "string") return undefined;
  // format like "1 day, 2:34:56" or "2:34:56"
  const dayMatch = /(\d+)\s+day/.exec(u);
  const days = dayMatch ? Number(dayMatch[1]) : 0;
  const timeMatch = /(\d+):(\d+):(\d+)/.exec(u);
  if (!timeMatch) return days * 86400;
  return days * 86400 + Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3]);
}