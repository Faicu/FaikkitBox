// ---------------------------------------------------------------------------
// Sursă unică pentru CONȚINUTUL (titlu + text) notificărilor push din
// aplicație — trimiterea efectivă rămâne în push.ts (sendPushToAll, singura
// funcție care vorbește cu web-push), dar construirea textului nu mai e
// împrăștiată sau duplicată în fiecare modul care are nevoie să notifice.
//
// Torrentele (download.ts, pinned-watcher.ts) folosesc buildTorrentDisplayName
// (tmdb-title-lookup.ts) + detectTorrentQuality (torrent-quality.ts) — aceeași
// logică peste tot, nu recalculată ad-hoc per apel.
// ---------------------------------------------------------------------------

import { sendPushToAll } from "./push";
import { buildTorrentDisplayName } from "./tmdb-title-lookup";
import { detectTorrentQuality } from "./torrent-quality";

export interface PushNotification {
  title: string;
  body: string;
}

// --- Torrente (filelist/download.ts) ----------------------------------------

export async function buildTorrentAddedNotification(params: {
  torrentName: string;
  imdb?: string | null;
  auto: boolean; // true = "Auto-descărcat" (pornit din pinned-watcher), false = "Torrent adăugat" (manual)
}): Promise<PushNotification> {
  const displayName = await buildTorrentDisplayName(params.torrentName, params.imdb).catch(
    () => params.torrentName,
  );
  const quality = detectTorrentQuality(params.torrentName);
  const prefix = params.auto ? "Auto-descărcat" : "Torrent adăugat";
  return { title: "⬇️ Torrent", body: `${prefix}: [${quality}] ${displayName}` };
}

export async function buildTorrentCompleteNotification(params: {
  torrentName: string;
  imdb?: string | null;
}): Promise<PushNotification> {
  const displayName = await buildTorrentDisplayName(params.torrentName, params.imdb).catch(
    () => params.torrentName,
  );
  const quality = detectTorrentQuality(params.torrentName);
  return { title: "✅ Torrent", body: `Torrent descărcat complet: [${quality}] ${displayName}` };
}

// --- Monitorizare (server/plugins/pinned-watcher.ts) ------------------------
// Construiesc doar {title, body} — pinned-watcher le pune într-o listă și le
// trimite pe toate la final, o singură dată per item verificat (nu direct
// din aceste funcții), ca să nu spargem gruparea existentă.

export function buildEpisodeAiredNotification(
  showTitle: string,
  epLabel: string,
): PushNotification {
  return { title: `📅 ${showTitle} — Episod nou`, body: epLabel };
}

export function buildNewTorrentsNotification(showTitle: string, label: string): PushNotification {
  return { title: `🎞 ${showTitle} — Torrente noi`, body: label };
}

export function buildAutoDownloadNotification(
  showTitle: string,
  quality: string,
  bodyName: string,
): PushNotification {
  return { title: `⬇️ ${showTitle} — Descărcare automată`, body: `${quality}: ${bodyName}` };
}

export function buildPlexNotification(showTitle: string, label: string): PushNotification {
  return { title: `📺 ${showTitle} — în Plex`, body: label };
}

// --- Commit-uri GitHub (3 locuri: webhook, plugin de polling, funcție server) —
// singurul caz din aplicație unde trimiterea e imediată, nu grupată/batch,
// deci funcția trimite direct, nu doar construiește.

export async function notifyGithubCommit(author: string, message: string): Promise<void> {
  await sendPushToAll(`📦 Commit nou — ${author}`, message);
}
