// ---------------------------------------------------------------------------
// Sursa unică pentru CONȚINUTUL notificărilor push (titlu, text, imagine,
// link); trimiterea e în push.ts. Aici sunt și builder-ele pentru torrente, și
// titlurile/link-urile implicite (PUSH_TITLES/PUSH_URLS) ale evenimentelor
// simple din logActivity — un singur loc pentru cum arată orice notificare.
// ---------------------------------------------------------------------------

import { sendPushToAll } from "./push";
import { buildTorrentDisplayName, lookupPosterUrlByImdbId } from "../tmdb/tmdb-title-lookup";
import { detectTorrentQuality } from "../media/torrent-quality";
import type { ActivityType } from "../activity-log";
import { resizePosterUrl } from "../tmdb/poster";

export interface PushNotification {
  title: string;
  body: string;
  image?: string | null;
  url?: string;
}

// --- Evenimente simple (logActivity) -----------------------------------------
// Titlul și link-ul implicit per tip, când apelul nu le suprascrie.

export const PUSH_TITLES: Record<ActivityType, string> = {
  server_start: "🟢 Serverul a pornit",
  server_stop: "🔴 Serverul s-a oprit",
  plex_watch_start: "🎬 Vizionare începută",
  plex_watch_stop: "🎬 Vizionare încheiată",
  // Rezervă — titlul real vine din options.title (manual sau automat).
  torrent_added: "⬇️ Descărcare Inițiată",
  torrent_complete: "✅ Descărcare Completă",
  immich_upload: "📷 Immich",
  service_restart: "🔄 Serviciu Repornit",
  service_update: "⬆️ Actualizare Aplicată",
  ubuntu_update: "🐧 Ubuntu Actualizat",
  qbit_action: "⚙️ Acțiune qBittorrent",
  app_error: "⚠️ Eroare Nouă Aplicație",
  // O intrare per rulare (logSubtitleRun), deci un push per rulare, nu per torrent.
  subtitle_fix: "💬 Corecție Subtitrare",
  account_request: "🆕 Cerere Aprobare Cont",
  // Fără push (titlu gol): doar de consultat, în Watcher.
  metadata_refresh: "",
  // Verificarea zilnică; pagina vine din options.url.
  update_available: "🆕 Actualizare disponibilă",
  // Push doar la declarația „Am plătit”; restul trec cu skipPush.
  contribution: "💰 Contribuție declarată",
  // Fără push: programarea, renunțarea și ștergerea — doar în jurnal.
  title_delete: "",
};

// Pagina deschisă de notificare, per tip; suprascrisă de options.url.
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
  metadata_refresh: "/tehnic",
  update_available: "/sistem",
  contribution: "/contributii",
  title_delete: "/biblioteca",
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
// Titlul și posterul vin din rândul deja scris în `media`
// (getMediaDisplayByTorrentHash); lookup-ul TMDB e doar rezervă, pentru
// torrentele fără rând — altfel ar putea diferi de ce arată Biblioteca.

// Posterul din `media` poate fi mic (w92 din wizard); în push e afișat pe toată
// lățimea, deci urcăm rezoluția doar în URL, fără să atingem DB-ul.
function upscalePosterForPush(posterPath: string | null): string | null {
  return resizePosterUrl(posterPath, "w780");
}

function seasonEpisodeLabel(
  season: number | null,
  episode: number | null,
  isSeasonPack: boolean,
): string | null {
  if (season == null) return null;
  if (isSeasonPack) return `Sezonul ${season}`;
  if (episode != null) {
    return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
  }
  return null;
}

async function resolveTorrentDisplay(params: {
  torrentName: string;
  imdb?: string | null;
  torrentHash?: string | null;
}): Promise<{ displayName: string; image: string | null; seasonLabel: string | null }> {
  if (params.torrentHash) {
    const { getMediaDisplayByTorrentHash } = await import("../media/media");
    const known = getMediaDisplayByTorrentHash(params.torrentHash);
    if (known) {
      return {
        displayName: known.title,
        image: upscalePosterForPush(known.posterPath),
        seasonLabel: seasonEpisodeLabel(known.season, known.episode, known.isSeasonPack),
      };
    }
  }
  const [displayName, image] = await Promise.all([
    buildTorrentDisplayName(params.torrentName, params.imdb).catch(() => params.torrentName),
    params.imdb ? lookupPosterUrlByImdbId(params.imdb).catch(() => null) : Promise.resolve(null),
  ]);
  return { displayName, image, seasonLabel: null };
}

export async function buildTorrentAddedNotification(params: {
  torrentName: string;
  imdb?: string | null;
  torrentHash?: string | null;
  // Pornit de urmărire — titlu distinct, ca descărcarea să fie explicabilă.
  auto?: boolean;
}): Promise<PushNotification> {
  const { displayName, image, seasonLabel } = await resolveTorrentDisplay(params);
  const quality = detectTorrentQuality(params.torrentName);
  return {
    title: params.auto ? "🤖 Descărcare Automată" : "⬇️ Descărcare Inițiată",
    body: `${displayName}${seasonLabel ? ` — ${seasonLabel}` : ""} [${quality}]`,
    image,
    url: "/biblioteca",
  };
}

export async function buildTorrentCompleteNotification(params: {
  torrentName: string;
  imdb?: string | null;
  torrentHash?: string | null;
}): Promise<PushNotification> {
  const { displayName, image, seasonLabel } = await resolveTorrentDisplay(params);
  const quality = detectTorrentQuality(params.torrentName);
  return {
    title: "✅ Descărcare Completă",
    body: `${displayName}${seasonLabel ? ` — ${seasonLabel}` : ""} [${quality}]`,
    image,
    url: "/biblioteca",
  };
}

// --- Commit-uri GitHub (webhook, sincronizare după push, funcție server) ------
// O notificare per lot, nu per commit.

export interface CommitNotice {
  author: string;
  message: string;
}

/**
 * O singură notificare pentru tot lotul de commit-uri — nouă notificări pentru
 * un push acopereau ecranul pe Android.
 */
export async function notifyGithubCommits(commits: CommitNotice[]): Promise<void> {
  if (commits.length === 0) return;

  if (commits.length === 1) {
    const { author, message } = commits[0];
    await sendPushToAll(`📦 Commit nou — ${author}`, message, { url: "/tehnic" });
    return;
  }

  const authors = [...new Set(commits.map((c) => c.author))];
  const who = authors.length === 1 ? ` — ${authors[0]}` : "";
  // Primele câteva mesaje; restul doar numărate.
  const MAX_LINES = 4;
  const lines = commits.slice(0, MAX_LINES).map((c) => `• ${c.message}`);
  const rest = commits.length - MAX_LINES;
  if (rest > 0) lines.push(`…și încă ${rest}`);

  await sendPushToAll(`📦 ${commits.length} commit-uri noi${who}`, lines.join("\n"), {
    url: "/tehnic",
  });
}
