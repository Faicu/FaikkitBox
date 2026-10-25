// Partea de server a indiciului HDR (regulile sunt în media/device-hdr.ts):
// dispozitivele din /devices, dovezile strânse din sesiunile Plex și
// indiciul pentru un utilizator, după istoricul lui de vizionare.

import { cachedAsync, fetchJson } from "./shared";
import { discoverPlexUrl, mediaIsHdr, type PlexMetadataItem } from "./plex-shared";
import {
  pickDevices,
  resolveDeviceHdr,
  type DeviceHdrSource,
  type HdrVerdict,
} from "../media/device-hdr";

// Fereastra pentru „dispozitivul obișnuit".
const USUAL_WINDOW_DAYS = 60;

export interface HdrDeviceHint {
  clientId: string;
  name: string;
  verdict: HdrVerdict;
  sure: boolean;
  reason: string;
  source: DeviceHdrSource;
}

export interface HdrHint {
  usual: HdrDeviceHint;
  // Doar dacă diferă de cel obișnuit.
  last: HdrDeviceHint | null;
}

interface PlexDevice {
  clientId: string;
  name: string;
  platform: string;
}

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

// /devices: ID local → dispozitiv. Lista crește doar când apare un dispozitiv
// nou, deci 10 minute de cache ajung.
function plexDevices(): Promise<Map<number, PlexDevice>> {
  return cachedAsync("plexDevices", 10 * 60_000, async () => {
    const token = process.env.PLEX_TOKEN;
    const map = new Map<number, PlexDevice>();
    if (!token) return map;
    const { url } = await discoverPlexUrl(token, process.env.PLEX_URL);
    const json = await fetchJson<{
      MediaContainer?: {
        Device?: Array<{
          id?: number;
          name?: string;
          platform?: string;
          clientIdentifier?: string;
        }>;
      };
    }>(`${url}/devices`, { headers: { Accept: "application/json", "X-Plex-Token": token } });
    for (const d of json?.MediaContainer?.Device ?? []) {
      if (d.id == null || !d.clientIdentifier) continue;
      map.set(Number(d.id), {
        clientId: d.clientIdentifier,
        name: (d.name ?? "").trim(),
        platform: (d.platform ?? "").trim(),
      });
    }
    return map;
  });
}

// Din pluginul plex-session-tracker, la fiecare verificare: modelul raportat
// de aplicație și, dacă un fișier HDR merge cu video-ul netranscodat (direct
// play sau direct stream), data — dovada că dispozitivul a primit HDR.
// O transcodare NU e dovadă de lipsă: Plex transcodează și pentru subtitrări
// arse, lățime de bandă sau sunet, nu doar pentru HDR.
export async function recordDeviceSessions(sessions: PlexMetadataItem[]): Promise<void> {
  const rows = sessions.flatMap((s) => {
    const clientId = s.Player?.machineIdentifier;
    if (!clientId) return [];
    const media = s.Media?.[0];
    const video = (media?.Part?.[0]?.Stream ?? []).find((x) => x.streamType === 1);
    const videoDecision = s.TranscodeSession?.videoDecision ?? video?.decision;
    const hdrDirect = videoDecision !== "transcode" && mediaIsHdr(media);
    return [
      {
        clientId,
        model: s.Player?.model || null,
        product: s.Player?.product || null,
        hdrDirect,
      },
    ];
  });
  if (rows.length === 0) return;
  const database = await db();
  const upsert = database.prepare(
    `INSERT INTO device_hdr (client_id, model, product, hdr_direct_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(client_id) DO UPDATE SET
       model = COALESCE(excluded.model, model),
       product = COALESCE(excluded.product, product),
       hdr_direct_at = COALESCE(excluded.hdr_direct_at, hdr_direct_at)`,
  );
  const now = Date.now();
  for (const r of rows) upsert.run(r.clientId, r.model, r.product, r.hdrDirect ? now : null);
}

async function accountOf(userId: number): Promise<number | null> {
  const database = await db();
  const row = database.prepare("SELECT plex_account_id FROM users WHERE id = ?").get(userId) as
    { plex_account_id: number | null } | undefined;
  return row?.plex_account_id ?? null;
}

// ID-urile locale ale dispozitivelor din istoricul contului Plex al
// utilizatorului, cu vizionările — null dacă n-are cont legat sau Plex nu
// răspunde.
async function userViews(userId: number) {
  const accountId = await accountOf(userId);
  if (accountId == null) return null;
  // Dinamic: plex.ts aduce server fn-uri, iar modulul e importat și de
  // pluginul de sesiuni, care are nevoie doar de recordDeviceSessions.
  const { getPlexViewsByAccount } = await import("./plex");
  const byAccount = await getPlexViewsByAccount();
  return byAccount?.[String(accountId)] ?? null;
}

export async function getHdrHintForUser(userId: number): Promise<HdrHint | null> {
  const views = await userViews(userId);
  if (!views) return null;
  const sinceSec = Math.floor(Date.now() / 1000) - USUAL_WINDOW_DAYS * 86400;
  const picked = pickDevices(views, sinceSec);
  if (!picked) return null;
  const devices = await plexDevices();
  const usual = await hintFor(devices.get(picked.usual));
  if (!usual) return null;
  const last = picked.last === picked.usual ? null : await hintFor(devices.get(picked.last));
  return { usual, last };
}

async function hintFor(device: PlexDevice | undefined): Promise<HdrDeviceHint | null> {
  if (!device) return null;
  const database = await db();
  const row = database
    .prepare(
      "SELECT model, product, hdr_direct_at, user_answer FROM device_hdr WHERE client_id = ?",
    )
    .get(device.clientId) as
    | {
        model: string | null;
        product: string | null;
        hdr_direct_at: number | null;
        user_answer: number | null;
      }
    | undefined;
  const r = resolveDeviceHdr(
    { name: device.name, platform: device.platform, model: row?.model, product: row?.product },
    {
      userAnswer: row?.user_answer == null ? null : row.user_answer === 1,
      hdrDirectAt: row?.hdr_direct_at ?? null,
    },
  );
  return {
    clientId: device.clientId,
    name: device.name || device.platform || "un dispozitiv fără nume",
    verdict: r.verdict,
    sure: r.sure,
    reason: r.reason,
    source: r.source,
  };
}

// Confirmarea manuală (null = anulată). Doar pentru dispozitive pe care
// utilizatorul chiar s-a uitat; răspunsul e al dispozitivului, deci îl văd și
// ceilalți care se uită pe el.
export async function setDeviceHdrAnswer(
  userId: number,
  isAdmin: boolean,
  clientId: string,
  hasHdr: boolean | null,
): Promise<boolean> {
  if (!isAdmin) {
    const views = await userViews(userId);
    const devices = await plexDevices();
    const own = (views ?? []).some(
      (v) => v.deviceId != null && devices.get(v.deviceId)?.clientId === clientId,
    );
    if (!own) return false;
  }
  const database = await db();
  database
    .prepare(
      `INSERT INTO device_hdr (client_id, user_answer, answered_by_user_id, answered_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(client_id) DO UPDATE SET
         user_answer = excluded.user_answer,
         answered_by_user_id = excluded.answered_by_user_id,
         answered_at = excluded.answered_at`,
    )
    .run(clientId, hasHdr == null ? null : hasHdr ? 1 : 0, userId, Date.now());
  return true;
}
