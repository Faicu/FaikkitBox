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
            quality,
            durationMs,
            hasRomanianSubtitle,
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
            quality,
            durationMs,
            hasRomanianSubtitle,
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
