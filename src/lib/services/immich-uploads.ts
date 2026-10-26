// ---------------------------------------------------------------------------
// Încărcările în Immich, în jurnal — sarcina immich-uploads din Watcher.
// Varianta veche rula doar cât era deschisă pagina Immich și pornea de la zero
// la fiecare repornire: 285 de încărcări într-o lună, zero intrări (26 sept.
// 2026).
//
// Acum cerem exact ce s-a încărcat de la ultima verificare (după momentul
// încărcării, nu EXIF), cu punctul de plecare în DB. O încărcare = o intrare,
// scrisă când o verificare nu mai găsește nimic nou la acel utilizator.
// Căutarea vede asset-urile contului cheii API — pe server e un singur cont.
// ---------------------------------------------------------------------------

import { getDb } from "../db";
import { pluralRo } from "../format";
import { fetchJson, stripSlash } from "./shared";

interface PendingUpload {
  photos: number;
  videos: number;
  // Momentul încărcării (createdAt), primul și ultimul văzut.
  firstAt: string;
  lastAt: string;
}

type Pending = Record<string, PendingUpload>;

interface ImmichAsset {
  id: string;
  ownerId: string;
  type: string;
  createdAt: string;
  livePhotoVideoId?: string | null;
  visibility?: string;
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("ro-RO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Bucharest",
  });
}

export function buildImmichUploadMessage(userName: string, p: PendingUpload): string {
  const parts: string[] = [];
  if (p.photos > 0) parts.push(pluralRo(p.photos, "fotografie", "fotografii"));
  if (p.videos > 0) parts.push(pluralRo(p.videos, "videoclip", "videoclipuri"));
  const from = hhmm(p.firstAt);
  const to = hhmm(p.lastAt);
  const when = from === to ? `la ora ${from}` : `între ${from} și ${to}`;
  return `${userName} a încărcat ${parts.join(" și ")} ${when}`;
}

// Ce vede utilizatorul în galerie: un Live Photo (poză + video ascuns) se
// numără o dată — ca la „încărcări azi” din immich.ts.
export function countVisible(
  items: ImmichAsset[],
): Map<string, { photos: number; videos: number }> {
  const paired = new Set(items.map((a) => a.livePhotoVideoId).filter(Boolean));
  const byOwner = new Map<string, { photos: number; videos: number }>();
  for (const a of items) {
    if (a.type === "VIDEO" && (paired.has(a.id) || a.visibility === "hidden")) continue;
    const c = byOwner.get(a.ownerId) ?? { photos: 0, videos: 0 };
    if (a.type === "VIDEO") c.videos++;
    else c.photos++;
    byOwner.set(a.ownerId, c);
  }
  return byOwner;
}

export async function checkImmichUploads(): Promise<void> {
  const base = process.env.IMMICH_URL;
  const key = process.env.IMMICH_API_KEY;
  if (!base || !key) return;
  const url = stripSlash(base);
  const headers = { "x-api-key": key, Accept: "application/json" };

  const db = getDb();
  const now = new Date().toISOString();
  const state = db
    .prepare("SELECT checked_until, pending FROM immich_upload_tracker WHERE id = 1")
    .get() as { checked_until: string; pending: string } | undefined;
  if (!state) {
    // Prima rulare: pornim de acum, fără să trecem în jurnal tot istoricul.
    db.prepare("INSERT INTO immich_upload_tracker (id, checked_until) VALUES (1, ?)").run(now);
    return;
  }

  // O eroare nu mută checked_until — intervalul se cere din nou.
  let items: ImmichAsset[] = [];
  let page: number | string | null = 1;
  for (let guard = 0; page != null && guard < 20; guard++) {
    const res: { assets?: { items?: ImmichAsset[]; nextPage?: number | string | null } } =
      await fetchJson(
        `${url}/api/search/metadata`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            createdAfter: state.checked_until,
            createdBefore: now,
            size: 1000,
            page,
          }),
        },
        10_000,
      );
    items = items.concat(res.assets?.items ?? []);
    page = res.assets?.nextPage ?? null;
  }

  const pending: Pending = JSON.parse(state.pending || "{}");
  const found = countVisible(items);
  for (const [owner, c] of found) {
    const times = items
      .filter((a) => a.ownerId === owner)
      .map((a) => a.createdAt)
      .sort();
    const prev = pending[owner];
    pending[owner] = {
      photos: (prev?.photos ?? 0) + c.photos,
      videos: (prev?.videos ?? 0) + c.videos,
      firstAt: prev?.firstAt ?? times[0],
      lastAt: times[times.length - 1],
    };
  }

  // Încărcările încheiate (nimic nou de data trecută); numele vin din
  // statistici, cerute doar la nevoie.
  const done = Object.keys(pending).filter((owner) => !found.has(owner));
  if (done.length > 0) {
    const stats = await fetchJson<{
      usageByUser?: Array<{ userId?: string; userName?: string }>;
    }>(`${url}/api/server/statistics`, { headers }).catch(() => null);
    const names = new Map((stats?.usageByUser ?? []).map((u) => [u.userId, u.userName]));
    const { logActivity } = await import("../activity-log");
    for (const owner of done) {
      const p = pending[owner];
      delete pending[owner];
      const userName = names.get(owner) ?? "Immich";
      await logActivity("immich_upload", buildImmichUploadMessage(userName, p), {
        user: userName,
        newPhotos: p.photos,
        newVideos: p.videos,
        firstAt: p.firstAt,
        lastAt: p.lastAt,
      });
    }
  }

  db.prepare("UPDATE immich_upload_tracker SET checked_until = ?, pending = ? WHERE id = 1").run(
    now,
    JSON.stringify(pending),
  );
}

// Pentru Watcher: până unde s-a verificat și ce încărcare e în curs.
export function readImmichTrackerState(): {
  checkedUntil: string | null;
  inProgress: number;
} {
  const row = getDb()
    .prepare("SELECT checked_until, pending FROM immich_upload_tracker WHERE id = 1")
    .get() as { checked_until: string; pending: string } | undefined;
  if (!row) return { checkedUntil: null, inProgress: 0 };
  const pending: Pending = JSON.parse(row.pending || "{}");
  const inProgress = Object.values(pending).reduce((n, p) => n + p.photos + p.videos, 0);
  return { checkedUntil: row.checked_until, inProgress };
}
