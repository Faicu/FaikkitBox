// ---------------------------------------------------------------------------
// Urmărirea încărcărilor în Immich — rulată de
// server/plugins/immich-upload-tracker.ts, la 5 minute.
//
// Varianta veche compara contoarele per utilizator din /server/statistics și
// ținea punctul de plecare în memorie. Rula doar cât era deschisă pagina
// Immich (verificarea mergea pe spinarea cererii de statistici), iar prima
// verificare după fiecare repornire doar nota contoarele. Rezultatul, găsit pe
// 26 sept. 2026: 285 de încărcări în 30 de zile, zero intrări în jurnal.
//
// Acum: cerem Immich-ului exact ce s-a încărcat de la ultima verificare
// (search/metadata cu createdAfter = momentul încărcării, nu data EXIF), iar
// punctul de plecare stă în DB (immich_upload_tracker). O încărcare = o
// intrare: ce s-a găsit se adună în `pending` și se scrie în jurnal abia când
// o verificare nu mai găsește nimic nou la acel utilizator.
//
// Căutarea vede asset-urile utilizatorului căruia îi aparține cheia API (și pe
// cele partajate cu el). Pe server există un singur utilizator Immich; la mai
// mulți, cheia ar trebui să fie a unui cont care îi vede pe toți.
// ---------------------------------------------------------------------------

import { getDb } from "../db";
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

// „1 fotografie”, „2 fotografii”, „25 de fotografii”.
function plural(n: number, one: string, many: string): string {
  if (n === 1) return `1 ${one}`;
  const rest = n % 100;
  return n >= 20 && (rest === 0 || rest >= 20) ? `${n} de ${many}` : `${n} ${many}`;
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
  if (p.photos > 0) parts.push(plural(p.photos, "fotografie", "fotografii"));
  if (p.videos > 0) parts.push(plural(p.videos, "videoclip", "videoclipuri"));
  const from = hhmm(p.firstAt);
  const to = hhmm(p.lastAt);
  const when = from === to ? `la ora ${from}` : `între ${from} și ${to}`;
  return `${userName} a încărcat ${parts.join(" și ")} ${when}`;
}

// Ce vede utilizatorul în galerie, nu numărul brut de asset-uri: un Live Photo
// e o poză plus un videoclip-pereche (legat prin livePhotoVideoId, ascuns) —
// numărat o singură dată, ca poză. Aceeași regulă ca la „încărcări azi”
// din immich.ts.
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

  // O eroare aici aruncă mai departe fără să mute checked_until — verificarea
  // următoare cere din nou același interval, deci nu se pierde nimic.
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

  // Încărcările încheiate: nimic nou la acest utilizator de la verificarea
  // trecută. Numele vin din statistici, cerute doar când chiar e ceva de scris.
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

// Pentru pagina Immich: până unde s-a verificat și ce încărcare e în curs.
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
