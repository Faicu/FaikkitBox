// ---------------------------------------------------------------------------
// Sursă unică pentru CONȚINUTUL (titlu + text + imagine + link) notificărilor
// push din aplicație — trimiterea efectivă rămâne în push.ts (sendPushToAll,
// singura funcție care vorbește cu web-push), dar construirea conținutului nu
// mai e împrăștiată sau duplicată în fiecare modul care are nevoie să notifice.
//
// Totul e aici: și builder-ele "bogate" (torrent/watcher, mai jos) care au
// nevoie de parametri/lookup-uri, și PUSH_TITLES/PUSH_URLS — titlul/link-ul
// implicit pentru evenimentele simple logate prin logActivity() (server,
// Plex, Immich, update-uri, erori...), consumate de activity-log.ts. Dacă
// vrei să schimbi cum arată orice notificare din aplicație, e un singur loc.
//
// Torrentele (download.ts) folosesc buildTorrentDisplayName
// (tmdb-title-lookup.ts) + detectTorrentQuality (torrent-quality.ts) — aceeași
// logică peste tot, nu recalculată ad-hoc per apel.
// ---------------------------------------------------------------------------

import { sendPushToAll } from "./push";
import { buildTorrentDisplayName, lookupPosterUrlByImdbId } from "./tmdb-title-lookup";
import { detectTorrentQuality } from "./torrent-quality";
import type { ActivityType } from "./activity-log";

export interface PushNotification {
  title: string;
  body: string;
  image?: string | null;
  url?: string;
}

// --- Evenimente simple (logActivity, activity-log.ts) -----------------------
// Titlul/link-ul implicit per tip de activitate — logActivity le folosește
// când apelul nu suprascrie explicit `options.title`/`options.url` (ex.
// torrent_added/torrent_complete, care diferă manual/automat — vezi mai jos).

export const PUSH_TITLES: Record<ActivityType, string> = {
  server_start: "🟢 Serverul a pornit",
  server_stop: "🔴 Serverul s-a oprit",
  plex_watch_start: "🎬 Vizionare începută",
  plex_watch_stop: "🎬 Vizionare încheiată",
  // Fallback — titlul real vine din options.title (n.title de la
  // buildTorrentAddedNotification/buildTorrentCompleteNotification, mai jos),
  // fiindcă torrent_added acoperă atât manual cât și automat.
  torrent_added: "⬇️ Descărcare Inițiată",
  torrent_complete: "✅ Descărcare Completă",
  immich_upload: "📷 Immich",
  service_restart: "🔄 Serviciu Repornit",
  service_update: "⬆️ Actualizare Aplicată",
  ubuntu_update: "🐧 Ubuntu Actualizat",
  qbit_action: "⚙️ Acțiune qBittorrent",
  app_error: "⚠️ Eroare Nouă Aplicație",
  // O singură intrare de log per rulare (descărcare unică sau backfill întreg
  // — vezi logSubtitleRun în src/lib/filelist/subtitles.ts), deci un singur
  // push per rulare, nu per torrent.
  subtitle_fix: "💬 Corecție Subtitrare",
  account_request: "🆕 Cerere Aprobare Cont",
};

// Pagina spre care duce apăsarea notificării — implicit per tip; se poate
// suprascrie punctual din `options.url` la apel din logActivity.
export const PUSH_URLS: Record<ActivityType, string> = {
  server_start: "/sistem",
  server_stop: "/sistem",
  plex_watch_start: "/",
  plex_watch_stop: "/",
  torrent_added: "/biblioteca",
  torrent_complete: "/biblioteca",
  immich_upload: "/immich",
  service_restart: "/sistem",
  service_update: "/sistem",
  ubuntu_update: "/sistem",
  qbit_action: "/qbit",
  app_error: "/tehnic",
  subtitle_fix: "/biblioteca",
  account_request: "/users",
};

// --- Server (activity-log.ts — start/stop) ----------------------------------

export function buildServerStartMessage(cause: string, time: string): string {
  return `Cauză: ${cause}, ora ${time}`;
}

export function buildServerStopMessage(cause: string, time: string): string {
  return `Cauză: ${cause}, ora ${time}`;
}

// --- Plex (activity-log.ts — tracking sesiuni) -------------------------------

export function buildPlexWatchStartMessage(user: string, what: string): string {
  return `${user}: ${what}`;
}

export function buildPlexWatchStopMessage(user: string, what: string, progress: string): string {
  return `${user}: ${what}${progress}`;
}

// --- Torrente (filelist/download.ts) ----------------------------------------

export async function buildTorrentAddedNotification(params: {
  torrentName: string;
  imdb?: string | null;
}): Promise<PushNotification> {
  const [displayName, image] = await Promise.all([
    buildTorrentDisplayName(params.torrentName, params.imdb).catch(() => params.torrentName),
    params.imdb ? lookupPosterUrlByImdbId(params.imdb).catch(() => null) : Promise.resolve(null),
  ]);
  const quality = detectTorrentQuality(params.torrentName);
  return {
    title: "⬇️ Descărcare Inițiată",
    body: `${displayName} [${quality}]`,
    image,
    url: "/biblioteca",
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
    url: "/biblioteca",
  };
}

// --- Commit-uri GitHub (3 locuri: webhook, plugin de polling, funcție server) —
// singurul caz din aplicație unde trimiterea e imediată, nu grupată/batch,
// deci funcția trimite direct, nu doar construiește.

export async function notifyGithubCommit(author: string, message: string): Promise<void> {
  await sendPushToAll(`📦 Commit nou — ${author}`, message, { url: "/tehnic" });
}
