// ---------------------------------------------------------------------------
// Sursă unică pentru CONȚINUTUL (titlu + text + imagine + link) notificărilor
// push din aplicație — trimiterea efectivă rămâne în push.ts (sendPushToAll,
// singura funcție care vorbește cu web-push), dar construirea conținutului nu
// mai e împrăștiată sau duplicată în fiecare modul care are nevoie să notifice.
//
// Torrentele (download.ts, pinned-watcher.ts) folosesc buildTorrentDisplayName
// (tmdb-title-lookup.ts) + detectTorrentQuality (torrent-quality.ts) — aceeași
// logică peste tot, nu recalculată ad-hoc per apel.
// ---------------------------------------------------------------------------

import { sendPushToAll } from "./push";
import { buildTorrentDisplayName, lookupPosterUrlByImdbId } from "./tmdb-title-lookup";
import { detectTorrentQuality } from "./torrent-quality";

export interface PushNotification {
  title: string;
  body: string;
  image?: string | null;
  url?: string;
}

// --- Torrente (filelist/download.ts) ----------------------------------------

export async function buildTorrentAddedNotification(params: {
  torrentName: string;
  imdb?: string | null;
  auto: boolean; // true = "Auto-descărcat" (pornit din pinned-watcher), false = "Torrent adăugat" (manual)
}): Promise<PushNotification> {
  const [displayName, image] = await Promise.all([
    buildTorrentDisplayName(params.torrentName, params.imdb).catch(() => params.torrentName),
    params.imdb ? lookupPosterUrlByImdbId(params.imdb).catch(() => null) : Promise.resolve(null),
  ]);
  const quality = detectTorrentQuality(params.torrentName);
  return {
    title: params.auto ? "⬇️ Descărcare Automată" : "⬇️ Descărcare Inițiată",
    body: `${displayName} [${quality}]`,
    image,
    url: "/lansari",
  };
}

export async function buildTorrentCompleteNotification(params: {
  torrentName: string;
  imdb?: string | null;
}): Promise<PushNotification> {
  const [displayName, image] = await Promise.all([
    buildTorrentDisplayName(params.torrentName, params.imdb).catch(() => params.torrentName),
    params.imdb ? lookupPosterUrlByImdbId(params.imdb).catch(() => null) : Promise.resolve(null),
  ]);
  const quality = detectTorrentQuality(params.torrentName);
  return {
    title: "✅ Descărcare Completă",
    body: `${displayName} [${quality}]`,
    image,
    url: "/lansari",
  };
}

// --- Monitorizare (server/plugins/pinned-watcher.ts) ------------------------
// Construiesc doar {title, body, url} — pinned-watcher le pune într-o listă și
// le trimite pe toate la final, o singură dată per item verificat (nu direct
// din aceste funcții), ca să nu spargem gruparea existentă.

export function buildEpisodeAiredNotification(
  showTitle: string,
  epKey: string,
  epLabel: string,
): PushNotification {
  return { title: `📅 ${showTitle} ${epKey} Lansat`, body: epLabel, url: "/lansari" };
}

export function buildNewTorrentsNotification(showTitle: string, label: string): PushNotification {
  return { title: `🎞 ${showTitle} - Disponibil`, body: label, url: "/lansari" };
}

export function buildAutoDownloadNotification(
  showTitle: string,
  quality: string,
  bodyName: string,
): PushNotification {
  return {
    title: `⬇️ ${showTitle}`,
    body: `Descărcare Automată: ${bodyName} [${quality}]`,
    url: "/lansari",
  };
}

// --- Commit-uri GitHub (3 locuri: webhook, plugin de polling, funcție server) —
// singurul caz din aplicație unde trimiterea e imediată, nu grupată/batch,
// deci funcția trimite direct, nu doar construiește.

export async function notifyGithubCommit(author: string, message: string): Promise<void> {
  await sendPushToAll(`📦 Commit nou — ${author}`, message, { url: "/tehnic" });
}
