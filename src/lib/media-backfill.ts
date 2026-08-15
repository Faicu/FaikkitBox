// ---------------------------------------------------------------------------
// Backfill: completează tabela `media` pentru tot ce era deja în Plex
// înainte de acest sistem (deci fără nicio descărcare/torrent asociat(ă) în
// aplicație) — ca Bibliotecă să citească din DB pentru toată biblioteca, nu
// doar pentru titlurile descărcate de-acum-încolo. Rulează în fundal
// (declanșat manual din UI), pe același tipar ca backfillSubtitles
// (download.ts): stare la nivel de modul, urmărită prin polling, nu printr-un
// singur request HTTP ținut deschis minute în șir.
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";
import { fetchJson } from "./services/shared";
import {
  discoverPlexUrl,
  plexQualityFromMedia,
  hasEmbeddedRomanianSubtitle,
  extractGuidId,
  type PlexApiResponse,
  type PlexMetadataItem,
} from "./services/plex-shared";

interface PlexDirectoryLike {
  key?: string;
  type?: string;
}

// Toată biblioteca (nu doar "recent adăugate", ca la browseCache din
// plex-browse.ts) — filme + episoade, într-un singur request per secțiune.
async function fetchFullPlexLibrary(): Promise<PlexMetadataItem[]> {
  const token = process.env.PLEX_TOKEN;
  if (!token) return [];
  const { url } = await discoverPlexUrl(token, process.env.PLEX_URL);
  const headers = { Accept: "application/json", "X-Plex-Token": token };

  const libsJson = await fetchJson<PlexApiResponse>(`${url}/library/sections`, { headers });
  const libsMd = libsJson?.MediaContainer?.Directory ?? [];
  const movieLibKeys = libsMd
    .filter((l: PlexDirectoryLike) => l.type === "movie")
    .map((l) => l.key);
  const showLibKeys = libsMd.filter((l: PlexDirectoryLike) => l.type === "show").map((l) => l.key);

  const LIMIT = 20_000;
  const [movies, episodes] = await Promise.all([
    Promise.all(
      movieLibKeys.map((key) =>
        fetchJson<PlexApiResponse>(
          `${url}/library/sections/${key}/all?type=1&X-Plex-Container-Start=0&X-Plex-Container-Size=${LIMIT}`,
          { headers },
        ).catch(() => ({ MediaContainer: { Metadata: [] } })),
      ),
    ),
    Promise.all(
      showLibKeys.map((key) =>
        fetchJson<PlexApiResponse>(
          `${url}/library/sections/${key}/all?type=4&X-Plex-Container-Start=0&X-Plex-Container-Size=${LIMIT}`,
          { headers },
        ).catch(() => ({ MediaContainer: { Metadata: [] } })),
      ),
    ),
  ]);

  return [
    ...movies.flatMap((m) => m?.MediaContainer?.Metadata ?? []),
    ...episodes.flatMap((e) => e?.MediaContainer?.Metadata ?? []),
  ];
}

// Detalii complete (Media/Stream) — lista de mai sus nu le include mereu
// complet, iar verificarea subtitrării încorporate are nevoie de Stream.
async function fetchItemDetail(
  url: string,
  headers: Record<string, string>,
  ratingKey: string,
): Promise<PlexMetadataItem | null> {
  try {
    const json = await fetchJson<PlexApiResponse>(
      `${url}/library/metadata/${encodeURIComponent(ratingKey)}`,
      { headers },
    );
    return json?.MediaContainer?.Metadata?.[0] ?? null;
  } catch {
    return null;
  }
}

// Leagă retroactiv un titlu backfill-uit de torrentul lui din qBittorrent
// (dacă încă seed-uiește), potrivind calea exactă a fișierului din Plex —
// devine gestionabil complet (corectare/ștergere subtitrare, ștergere
// titlu), nu doar afișat. Doi pași:
//  1. `content_path` chiar e fișierul video (torrent cu un singur fișier) —
//     potrivire directă.
//  2. `content_path` e un folder (torrent cu fișiere multiple — ex. un
//     videoclip + .nfo/.srt/sample, sau un pachet de sezon) — listăm
//     conținutul torrentului și legăm FIECARE fișier video găsit (calea
//     reconstruită folder+fișier) de același hash. Pentru pachete de sezon,
//     mai multe episoade ajung să partajeze același torrent_hash — intenționat
//     (torrent_hash NU mai e UNIQUE în `media` de la migrarea v13); acțiunile
//     de ștergere/corectare subtitrare se aplică atunci la nivelul întregului
//     pachet, nu doar unui episod.
const MEDIA_EXTENSIONS = [".mkv", ".mp4", ".avi", ".m2ts", ".ts", ".wmv", ".mov"];

interface QbitTorrentMatch {
  hash: string;
  name: string;
}

function hasMediaExtension(path: string): boolean {
  return MEDIA_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext));
}

async function fetchQbitTorrentsByPath(): Promise<Map<string, QbitTorrentMatch>> {
  const byPath = new Map<string, QbitTorrentMatch>();
  const qbitUrl = (process.env.QBIT_URL ?? "http://192.168.1.192:25556").replace(/\/$/, "");
  const qbitUser = process.env.QBIT_USERNAME;
  const qbitPass = process.env.QBIT_PASSWORD;
  if (!qbitUser || !qbitPass) return byPath;
  try {
    const { qbitGet, qbitListFiles } = await import("./qbit-client");
    const res = await qbitGet(qbitUrl, "/api/v2/torrents/info", qbitUser, qbitPass);
    if (!res.ok) return byPath;
    const list = (await res.json()) as Array<{
      hash?: string;
      name?: string;
      content_path?: string;
      save_path?: string;
    }>;
    for (const t of list) {
      if (!t.hash || !t.content_path) continue;
      const match = { hash: t.hash, name: t.name ?? "" };
      if (hasMediaExtension(t.content_path)) {
        byPath.set(t.content_path, match);
        continue;
      }
      // Torrent cu folder — listăm fișierele și legăm fiecare fișier video
      // găsit (fie unul singur, fie un pachet de sezon cu mai multe). qBit
      // întoarce `name` relativ la save_path, deja incluzând folderul
      // rădăcină al torrentului (verificat direct pe un exemplu real) — NU la
      // content_path, care e chiar acel folder; concatenarea cu content_path
      // ar dubla folderul în calea reconstruită.
      if (!t.save_path) continue;
      try {
        const files = await qbitListFiles(qbitUrl, t.hash, qbitUser, qbitPass);
        const videoFiles = files.filter((f) => hasMediaExtension(f.name));
        for (const f of videoFiles) {
          byPath.set(`${t.save_path}/${f.name}`, match);
        }
      } catch {
        // torrent inaccesibil/fișiere indisponibile — sărim, nu blocăm restul
      }
    }
  } catch (e) {
    console.warn("[media-backfill] Nu am putut lista torrentele din qBittorrent:", e);
  }
  return byPath;
}

interface ShowTmdbInfo {
  tmdbId: number | null;
  imdbId: string | null;
  literalTitle: string | null;
  overviewRo: string | null;
  genres: string[];
  tvStatus: string | null;
  posterUrl: string | null;
}

export interface MediaBackfillProgress {
  total: number;
  done: number;
}

export interface MediaBackfillResult {
  status: "ok" | "error";
  error?: string;
  processed: number;
  added: number;
  skipped: number;
}

let backfillRunning = false;
let backfillProgress: MediaBackfillProgress | null = null;
let lastResult: MediaBackfillResult | null = null;

export const getMediaBackfillState = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    running: boolean;
    progress: MediaBackfillProgress | null;
    lastResult: MediaBackfillResult | null;
  }> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();
    return {
      running: backfillRunning,
      progress: backfillProgress,
      lastResult: backfillRunning ? null : lastResult,
    };
  },
);

async function runMediaBackfillWork(): Promise<void> {
  try {
    const token = process.env.PLEX_TOKEN;
    if (!token) {
      lastResult = {
        status: "error",
        error: "PLEX_TOKEN nu este configurat",
        processed: 0,
        added: 0,
        skipped: 0,
      };
      return;
    }
    const { url } = await discoverPlexUrl(token, process.env.PLEX_URL);
    const headers = { Accept: "application/json", "X-Plex-Token": token };

    const allItems = await fetchFullPlexLibrary();

    const { getDb } = await import("./db");
    const db = getDb();
    const alreadyLinked = new Set(
      (
        db
          .prepare("SELECT plex_rating_key FROM media WHERE plex_rating_key IS NOT NULL")
          .all() as Array<{ plex_rating_key: string }>
      ).map((r) => r.plex_rating_key),
    );

    const pending = allItems.filter(
      (it) => it.ratingKey && !alreadyLinked.has(String(it.ratingKey)),
    );

    backfillProgress = { total: pending.length, done: 0 };
    let processed = 0;
    let added = 0;
    let skipped = 0;

    const { searchTmdbTopResultInternal, getTmdbDetailsInternal, getTmdbEpisodeOverviewInternal } =
      await import("./tmdb.functions");
    const { upsertMediaEntryFromPlex } = await import("./media");
    const qbitTorrentsByPath: Map<string, QbitTorrentMatch> =
      pending.length > 0 ? await fetchQbitTorrentsByPath() : new Map();

    // Rezolvarea TMDB a unui serial (căutare + detalii) e cache-uită per
    // rulare — toate episoadele aceluiași serial o refolosesc, ca N episoade
    // să coste 1 căutare + 1 apel de detalii, nu 2×N.
    const showInfoCache = new Map<string, ShowTmdbInfo | null>();
    async function resolveShowInfo(showTitle: string): Promise<ShowTmdbInfo | null> {
      if (showInfoCache.has(showTitle)) return showInfoCache.get(showTitle)!;
      const tmdbId = await searchTmdbTopResultInternal(showTitle, "tv", null);
      const info = tmdbId
        ? await getTmdbDetailsInternal(tmdbId, "tv").then((d) => ({
            tmdbId,
            imdbId: d.imdbId,
            literalTitle: d.literalTitle,
            overviewRo: d.overview,
            genres: d.genres,
            tvStatus: d.tvStatus,
            posterUrl: d.posterUrl,
          }))
        : null;
      showInfoCache.set(showTitle, info);
      return info;
    }

    for (const item of pending) {
      try {
        const isEpisode = item.type === "episode";
        const detail = await fetchItemDetail(url, headers, String(item.ratingKey));
        const media = detail?.Media?.[0] ?? item.Media?.[0];
        const quality = plexQualityFromMedia(media);
        const hasRomanianSubtitle = hasEmbeddedRomanianSubtitle(media);
        const durationMs = Number((detail ?? item).duration ?? 0);
        const filePath = media?.Part?.[0]?.file ?? null;
        const matchedTorrent = filePath ? (qbitTorrentsByPath.get(filePath) ?? null) : null;
        const plexAddedAt = Number((detail ?? item).addedAt ?? 0) || null;

        if (isEpisode) {
          const showTitle = item.grandparentTitle ?? item.title ?? "—";
          const season = item.parentIndex ?? null;
          const episode = item.index ?? null;
          const showInfo = await resolveShowInfo(showTitle);
          let overviewRo = showInfo?.overviewRo ?? null;
          if (showInfo?.tmdbId && season != null && episode != null) {
            const epOverview = await getTmdbEpisodeOverviewInternal(
              showInfo.tmdbId,
              season,
              episode,
            ).catch(() => null);
            if (epOverview) overviewRo = epOverview;
          }
          upsertMediaEntryFromPlex({
            mediaType: "episode",
            imdbId: showInfo?.imdbId ?? null,
            tmdbId: showInfo?.tmdbId ?? null,
            title: showTitle,
            literalTitle: showInfo?.literalTitle ?? null,
            season,
            episode,
            overviewRo,
            genres: showInfo?.genres ?? [],
            tvStatus: showInfo?.tvStatus ?? null,
            posterPath: showInfo?.posterUrl ?? null,
            plexRatingKey: String(item.ratingKey),
            plexAddedAt,
            quality,
            durationMs,
            hasRomanianSubtitle,
            torrentHash: matchedTorrent?.hash ?? null,
            torrentName: matchedTorrent?.name ?? null,
          });
          added++;
        } else {
          const title = item.title ?? "—";
          const year =
            item.year ??
            (item.originallyAvailableAt ? Number(item.originallyAvailableAt.slice(0, 4)) : null);
          // Guid-ul Plex ("imdb://tt...", "tmdb://...") e mereu prezent la
          // filme (agentul nou) — mult mai fiabil decât o căutare pe titlu,
          // care poate rata titluri traduse de Plex (RO) fără corespondent
          // exact pe TMDB (a fost cazul, ex. "Hellraiser 3: Iadul pe pământ").
          const guidTmdbId = extractGuidId(detail ?? undefined, "tmdb");
          const tmdbId = guidTmdbId
            ? Number(guidTmdbId)
            : await searchTmdbTopResultInternal(title, "movie", year);
          const details = tmdbId ? await getTmdbDetailsInternal(tmdbId, "movie") : null;
          upsertMediaEntryFromPlex({
            mediaType: "movie",
            imdbId: details?.imdbId ?? null,
            tmdbId: tmdbId ?? null,
            title,
            originalTitle: details?.originalTitle ?? null,
            literalTitle: details?.literalTitle ?? null,
            year,
            overviewRo: details?.overview ?? null,
            genres: details?.genres ?? [],
            posterPath: details?.posterUrl ?? null,
            plexRatingKey: String(item.ratingKey),
            plexAddedAt,
            quality,
            durationMs,
            hasRomanianSubtitle,
            torrentHash: matchedTorrent?.hash ?? null,
            torrentName: matchedTorrent?.name ?? null,
          });
          added++;
        }
        processed++;
      } catch (e) {
        console.warn(`[media-backfill] Eroare la "${item.title}":`, e);
        skipped++;
      }
      backfillProgress = { total: pending.length, done: backfillProgress.done + 1 };
      // Pauză mică între iteme — TMDB are rate-limit, iar o bibliotecă mare
      // (sute-mii de episoade) nu trebuie lovită dintr-o dată.
      await new Promise((r) => setTimeout(r, 250));
    }

    console.log(
      `[media-backfill] ${processed} procesate, ${added} adăugate, ${skipped} sărite (din ${allItems.length} titluri totale în Plex, ${alreadyLinked.size} deja legate)`,
    );
    lastResult = { status: "ok", processed, added, skipped };
  } catch (e) {
    console.error("[media-backfill] Eroare neașteptată:", e);
    lastResult = {
      status: "error",
      error: e instanceof Error ? e.message : String(e),
      processed: 0,
      added: 0,
      skipped: 0,
    };
  } finally {
    backfillProgress = null;
    backfillRunning = false;
  }
}

export const startMediaBackfill = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ status: "ok" | "error"; error?: string }> => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();

    if (backfillRunning) {
      return { status: "error", error: "Un backfill este deja în curs" };
    }
    if (!process.env.PLEX_TOKEN) {
      return { status: "error", error: "PLEX_TOKEN nu este configurat" };
    }

    backfillRunning = true;
    backfillProgress = null;
    lastResult = null;
    runMediaBackfillWork().catch((e) => {
      console.error("[media-backfill] Eroare neprinsă:", e);
      backfillRunning = false;
    });

    return { status: "ok" };
  },
);

// Echivalentul de mai sus, apelabil direct (fără graniță de server function/
// requireAdmin) — folosit de plugin-ul periodic de sincronizare
// (server/plugins/media-torrent-sync.ts), care rulează în fundal, fără
// sesiune de admin. Așteaptă finalizarea completă (spre deosebire de
// startMediaBackfill, care pornește rularea și răspunde imediat, urmărită
// separat prin polling din UI) — plugin-ul are nevoie de finalul ei înainte
// de a trece la legătura retroactivă/verificarea subtitrărilor.
export async function runMediaBackfillIfIdle(): Promise<void> {
  if (backfillRunning || !process.env.PLEX_TOKEN) return;
  backfillRunning = true;
  backfillProgress = null;
  lastResult = null;
  await runMediaBackfillWork();
}

// Leagă retroactiv torrent_hash pentru rândurile `media` deja indexate în
// Plex (plex_rating_key cunoscut) dar fără torrent asociat — cazul unui
// torrent adăugat direct în qBittorrent (nu prin aplicație) sau al unui
// titlu backfill-uit înainte ca torrentul lui să mai fi fost activ la acel
// moment. Aceeași logică de potrivire ca la backfill (fetchQbitTorrentsByPath
// — inclusiv pachete de sezon, fiecare fișier video legat individual), doar
// că verifică toate rândurile neconectate, nu doar cele nou adăugate în
// această rulare.
export async function linkUnmatchedTorrents(): Promise<{ checked: number; linked: number }> {
  const token = process.env.PLEX_TOKEN;
  if (!token) return { checked: 0, linked: 0 };

  const { getDb } = await import("./db");
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, plex_rating_key FROM media WHERE plex_rating_key IS NOT NULL AND torrent_hash IS NULL",
    )
    .all() as Array<{ id: number; plex_rating_key: string }>;
  if (rows.length === 0) return { checked: 0, linked: 0 };

  const qbitTorrentsByPath = await fetchQbitTorrentsByPath();
  if (qbitTorrentsByPath.size === 0) return { checked: rows.length, linked: 0 };

  const { url } = await discoverPlexUrl(token, process.env.PLEX_URL);
  const headers = { Accept: "application/json", "X-Plex-Token": token };

  let linked = 0;
  for (const row of rows) {
    try {
      const detail = await fetchItemDetail(url, headers, row.plex_rating_key);
      const filePath = detail?.Media?.[0]?.Part?.[0]?.file ?? null;
      const match = filePath ? qbitTorrentsByPath.get(filePath) : null;
      if (match) {
        db.prepare(
          "UPDATE media SET torrent_hash = ?, torrent_name = ?, updated_at = datetime('now') WHERE id = ?",
        ).run(match.hash, match.name, row.id);
        linked++;
      }
    } catch (e) {
      console.warn(`[media-backfill] Nu am putut verifica legătura pentru media.id=${row.id}:`, e);
    }
  }
  if (linked > 0) {
    console.log(
      `[media-backfill] Legătură retroactivă: ${linked}/${rows.length} legate de torrente active din qBittorrent`,
    );
  }
  return { checked: rows.length, linked };
}
