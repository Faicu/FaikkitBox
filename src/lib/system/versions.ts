// ---------------------------------------------------------------------------
// Versiunile serviciilor și actualizările disponibile (Plex, Immich, Ubuntu).
// Folosite de butoanele Update (prin getVersions) și de verificarea zilnică a
// actualizărilor (update-check.ts) — aceleași răspunsuri, deci notificarea și
// butonul spun mereu același lucru.
// ---------------------------------------------------------------------------

import { fetchJson as sharedFetchJson } from "../services/shared";

export type ServiceVersion = {
  name: "Plex" | "Immich" | "qBittorrent" | "Ubuntu";
  current?: string;
  latest?: string;
  changelog?: string;
  upToDate?: boolean;
  error?: string;
  // Doar Ubuntu: câte pachete ar instala Update și dacă sistemul cere reboot.
  pending?: number;
  rebootRequired?: boolean;
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

function fetchJson(url: string, init?: RequestInit, timeoutMs = 8000): Promise<unknown> {
  const githubToken = process.env.GITHUB_TOKEN;
  const extraHeaders: Record<string, string> =
    githubToken && url.includes("api.github.com") ? { Authorization: `Bearer ${githubToken}` } : {};
  return sharedFetchJson(
    url,
    {
      ...init,
      headers: {
        accept: "application/json",
        "user-agent": "faikkitbox-monitor/1.0",
        ...extraHeaders,
        ...(init?.headers ?? {}),
      },
    },
    timeoutMs,
  );
}

export async function plexVersion(): Promise<ServiceVersion> {
  const base = process.env.PLEX_URL;
  const token = process.env.PLEX_TOKEN;
  const v: ServiceVersion = {
    name: "Plex",
    changelog: "https://forums.plex.tv/c/plex-media-server/12",
  };
  try {
    if (base && token) {
      const j = (await fetchJson(`${base.replace(/\/$/, "")}/identity?X-Plex-Token=${token}`)) as {
        MediaContainer?: { version?: string };
      };
      v.current = j?.MediaContainer?.version;
    }
  } catch (e) {
    v.error = `Plex curent: ${(e as Error).message}`;
  }
  try {
    // Canalul beta (8), cu tokenul — exact întrebarea pe care o pune
    // containerul la pornire (cont-init.d/50-plex-update din imaginea
    // plexinc/pms-docker:beta). Canalul public, folosit înainte, rămânea în
    // urma versiunii instalate și nu arăta niciodată actualizările beta.
    const res = await fetch(
      `https://plex.tv/downloads/details/5?build=linux-x86_64&channel=8&distro=debian&X-Plex-Token=${token ?? ""}`,
      { signal: AbortSignal.timeout(8000) },
    );
    const xml = await res.text();
    v.latest = /<Release[^>]*\sversion="([^"]+)"/.exec(xml)?.[1];
  } catch (e) {
    v.error = v.error ?? `Plex ultima: ${(e as Error).message}`;
  }
  v.upToDate = cmp(v.current, v.latest);
  return v;
}

export async function immichVersion(): Promise<ServiceVersion> {
  const base = process.env.IMMICH_URL;
  const key = process.env.IMMICH_API_KEY;
  const v: ServiceVersion = {
    name: "Immich",
    changelog: "https://github.com/immich-app/immich/releases",
  };
  try {
    if (base && key) {
      const j = (await fetchJson(`${base.replace(/\/$/, "")}/api/server/version`, {
        headers: { "x-api-key": key },
      })) as { major: number; minor: number; patch: number };
      v.current = `${j.major}.${j.minor}.${j.patch}`;
    }
  } catch (e) {
    v.error = `Immich curent: ${(e as Error).message}`;
  }
  try {
    const j = (await fetchJson(
      "https://api.github.com/repos/immich-app/immich/releases/latest",
    )) as {
      tag_name?: string;
    };
    v.latest = j?.tag_name;
  } catch (e) {
    v.error = v.error ?? `Immich ultima: ${(e as Error).message}`;
  }
  v.upToDate = cmp(v.current, v.latest);
  return v;
}

export async function ubuntuVersion(): Promise<ServiceVersion> {
  const v: ServiceVersion = { name: "Ubuntu" };
  try {
    const { readUbuntuStatus } = await import("./ubuntu-status");
    const st = await readUbuntuStatus();
    v.pending = st.pending;
    v.rebootRequired = st.rebootRequired;
    v.upToDate = st.pending === 0;
  } catch (e) {
    v.error = `Ubuntu: ${(e as Error).message}`;
  }
  return v;
}

export async function readAllVersions(): Promise<{
  plex: ServiceVersion;
  immich: ServiceVersion;
  ubuntu: ServiceVersion;
}> {
  const [plex, immich, ubuntu] = await Promise.all([
    plexVersion(),
    immichVersion(),
    ubuntuVersion(),
  ]);
  return { plex, immich, ubuntu };
}
