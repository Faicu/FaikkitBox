import { createServerFn } from "@tanstack/react-start";

export type ServiceVersion = {
  name: "Plex" | "Immich" | "qBittorrent";
  current?: string;
  latest?: string;
  changelog?: string;
  upToDate?: boolean;
  error?: string;
};

function normalize(v?: string) {
  return (v ?? "").replace(/^v/i, "").split(/[-+ ]/)[0].trim();
}

function cmp(a?: string, b?: string): boolean | undefined {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return undefined;
  const pa = na.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = nb.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return false;
    if (x > y) return true;
  }
  return true;
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 8000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const githubToken = process.env.GITHUB_TOKEN;
  const extraHeaders: Record<string, string> =
    githubToken && url.includes("api.github.com")
      ? { Authorization: `Bearer ${githubToken}` }
      : {};
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        accept: "application/json",
        "user-agent": "faikkitbox-monitor/1.0",
        ...extraHeaders,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function plexVersion(): Promise<ServiceVersion> {
  const base = process.env.PLEX_URL;
  const token = process.env.PLEX_TOKEN;
  const v: ServiceVersion = { name: "Plex", changelog: "https://forums.plex.tv/c/plex-media-server/12" };
  try {
    if (base && token) {
      const j = await fetchJson(`${base.replace(/\/$/, "")}/identity?X-Plex-Token=${token}`);
      v.current = j?.MediaContainer?.version;
    }
  } catch (e) {
    v.error = `Plex curent: ${(e as Error).message}`;
  }
  try {
    const j = await fetchJson("https://plex.tv/api/downloads/5.json");
    v.latest = j?.computer?.Linux?.version ?? j?.nas?.Synology?.version;
  } catch (e) {
    v.error = v.error ?? `Plex ultima: ${(e as Error).message}`;
  }
  v.upToDate = cmp(v.current, v.latest);
  return v;
}

async function immichVersion(): Promise<ServiceVersion> {
  const base = process.env.IMMICH_URL;
  const key = process.env.IMMICH_API_KEY;
  const v: ServiceVersion = { name: "Immich", changelog: "https://github.com/immich-app/immich/releases" };
  try {
    if (base && key) {
      const j = await fetchJson(`${base.replace(/\/$/, "")}/api/server/version`, {
        headers: { "x-api-key": key },
      });
      v.current = `${j.major}.${j.minor}.${j.patch}`;
    }
  } catch (e) {
    v.error = `Immich curent: ${(e as Error).message}`;
  }
  try {
    const j = await fetchJson("https://api.github.com/repos/immich-app/immich/releases/latest");
    v.latest = j?.tag_name;
  } catch (e) {
    v.error = v.error ?? `Immich ultima: ${(e as Error).message}`;
  }
  v.upToDate = cmp(v.current, v.latest);
  return v;
}

export const getVersions = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin.server");
  await requireAdmin();
  const [plex, immich] = await Promise.all([plexVersion(), immichVersion()]);
  return { plex, immich, fetchedAt: new Date().toISOString() };
});