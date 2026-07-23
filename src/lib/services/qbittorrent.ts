import { createServerFn } from "@tanstack/react-start";
import { errMsg, stripSlash, type ServiceStatus } from "./shared";
import { qbitGet, qbitPostForm, resetQbitCookie } from "../qbit-client";

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
  addedOn: number; // unix timestamp
  category?: string;
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

export const qbitAction = createServerFn({ method: "POST" })
  .validator((data: { hashes: string[] | "all"; action: "pause" | "resume" | "delete" }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const { requireAdmin } = await import("../admin.server");
    try {
      await requireAdmin();
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const base = process.env.QBIT_URL;
    const user = process.env.QBIT_USERNAME;
    const pass = process.env.QBIT_PASSWORD;
    if (!base || !user || !pass) return { ok: false, error: "qBittorrent not configured" };
    const url = stripSlash(base);
    const hashesStr = data.hashes === "all" ? "all" : data.hashes.join("|");
    try {
      if (data.action === "delete") {
        const res = await qbitPostForm(url, "/api/v2/torrents/delete", user, pass, {
          hashes: hashesStr,
          deleteFiles: "true",
        });
        return { ok: res.ok };
      }
      const primary =
        data.action === "pause" ? "/api/v2/torrents/pause" : "/api/v2/torrents/resume";
      const fallback = data.action === "pause" ? "/api/v2/torrents/stop" : "/api/v2/torrents/start";
      let res = await qbitPostForm(url, primary, user, pass, { hashes: hashesStr });
      if (!res.ok) {
        res = await qbitPostForm(url, fallback, user, pass, { hashes: hashesStr });
      }
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return { ok: false, error: `HTTP ${res.status} ${t.slice(0, 120)}` };
      }
      return { ok: true };
    } catch (e) {
      resetQbitCookie();
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
      dlSpeed: 0,
      upSpeed: 0,
      dlSpeedLimit: 0,
      upSpeedLimit: 0,
      totalDl: 0,
      totalUp: 0,
      freeSpaceOnDisk: 0,
      globalRatio: 0,
      torrents: [],
      counts: { downloading: 0, seeding: 0, paused: 0, total: 0 },
      sessionDl: 0,
      sessionUp: 0,
    };
  }
  const url = stripSlash(base);
  try {
    const [versionRes, xferRes, torrentsRes] = await Promise.all([
      qbitGet(url, "/api/v2/app/version", user, pass),
      qbitGet(url, "/api/v2/transfer/info", user, pass),
      qbitGet(url, "/api/v2/torrents/info?sort=dlspeed&reverse=true", user, pass),
    ]);
    interface QbitTorrentRaw {
      hash: string;
      name: string;
      progress?: number;
      dlspeed?: number;
      upspeed?: number;
      eta?: number;
      state: string;
      size?: number;
      num_seeds?: number;
      num_leechs?: number;
      ratio?: number;
      added_on?: number;
      category?: string;
    }
    interface QbitTransferInfo {
      dl_info_speed?: number;
      up_info_speed?: number;
      dl_rate_limit?: number;
      up_rate_limit?: number;
      dl_info_data?: number;
      up_info_data?: number;
      global_ratio?: number;
    }
    interface QbitMainData {
      server_state?: { free_space_on_disk?: number; alltime_dl?: number; alltime_ul?: number };
    }

    const version = (await versionRes.text()).trim();
    const xfer: QbitTransferInfo = await xferRes.json();
    const torrentsRaw: QbitTorrentRaw[] = await torrentsRes.json();

    // Preferences for free disk space
    let freeSpace = 0;
    let alltimeDl = 0;
    let alltimeUp = 0;
    try {
      const mainRes = await qbitGet(url, "/api/v2/sync/maindata", user, pass);
      const main: QbitMainData = await mainRes.json();
      freeSpace = Number(main?.server_state?.free_space_on_disk ?? 0);
      alltimeDl = Number(main?.server_state?.alltime_dl ?? 0);
      alltimeUp = Number(main?.server_state?.alltime_ul ?? 0);
    } catch {
      // free space / alltime rămân 0 — endpoint indisponibil pe unele versiuni qBit
    }

    const torrents: QbitTorrent[] = torrentsRaw.map((t) => ({
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
      addedOn: Number(t.added_on ?? 0),
      category: t.category || undefined,
    }));

    let downloading = 0,
      seeding = 0,
      paused = 0;
    for (const t of torrentsRaw) {
      if (t.state?.includes("paused") || t.state === "pausedDL" || t.state === "pausedUP") paused++;
      else if (t.state?.includes("UP") || t.state === "uploading" || t.state === "stalledUP")
        seeding++;
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
    resetQbitCookie();
    return {
      status: "error",
      error: errMsg(e),
      dlSpeed: 0,
      upSpeed: 0,
      dlSpeedLimit: 0,
      upSpeedLimit: 0,
      totalDl: 0,
      totalUp: 0,
      freeSpaceOnDisk: 0,
      globalRatio: 0,
      torrents: [],
      counts: { downloading: 0, seeding: 0, paused: 0, total: 0 },
      sessionDl: 0,
      sessionUp: 0,
    };
  }
});
