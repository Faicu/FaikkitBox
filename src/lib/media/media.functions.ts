// ---------------------------------------------------------------------------
// Server functions pentru `media`, separate de media.ts: componentele client
// care importau server functions din media.ts trăgeau db.ts în bundle-ul
// public (schema la vedere în /assets/db-*.js). Aici nu există importuri
// server statice — `await import()` din handler rămâne pe server.
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";

import { isUnauthorizedError } from "../auth/unauthorized";

// Doar tipuri — nu trag nimic în bundle.
export type { LibraryTitleMatch, DownloadingMediaEntry } from "./media";
import type { LibraryTitleMatch } from "./media";
export type { ShowWatchOutcome, SetShowWatchInput } from "./show-watch";
import type { ShowWatchOutcome, SetShowWatchInput } from "./show-watch";

// Titluri existente în bibliotecă, pentru descărcarea manuală de pe Filelist.
export const searchLibraryTitles = createServerFn({ method: "GET" })
  .validator((data: { query: string }) => data)
  .handler(async ({ data }): Promise<LibraryTitleMatch[]> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { searchLibraryTitlesCore } = await import("./media");
    return searchLibraryTitlesCore(data.query);
  });

// ---------------------------------------------------------------------------
// Urmărirea serialelor (vezi show-watch.ts)
// ---------------------------------------------------------------------------

// Cine a adăugat serialul, sau un admin — urmărirea pornește descărcări reale.
async function requireShowManage(mediaId: number) {
  const { requireAuth, isAdminOrOwner } = await import("../auth/admin.server");
  const session = await requireAuth();
  const { getDb } = await import("../db");
  const row = getDb()
    .prepare("SELECT requested_by_user_id FROM media WHERE id = ? AND media_type = 'tv_show'")
    .get(mediaId) as { requested_by_user_id: number | null } | undefined;
  if (!row) throw new Error("Serialul nu există");
  if (!isAdminOrOwner(session, row.requested_by_user_id)) {
    throw new Error("Nu ai drepturi pentru serialul ăsta");
  }
}

export const setShowWatch = createServerFn({ method: "POST" })
  .validator((data: SetShowWatchInput) => data)
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      await requireShowManage(data.mediaId);
      const { setShowWatchCore } = await import("./show-watch");
      await setShowWatchCore(data);
      // Prima verificare acum, nu la următorul ciclu.
      if (data.enabled) {
        const { pokeWatcher } = await import("../watcher/poke");
        pokeWatcher("show-watch");
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

// „Verifică acum” — ignoră cadența pentru serialul deschis, ca „de ce n-a
// descărcat?” să nu aibă răspunsul „așteaptă 3 ore”.
export const checkShowNow = createServerFn({ method: "POST" })
  .validator((data: { mediaId: number }) => data)
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; outcome: ShowWatchOutcome } | { ok: false; error: string }> => {
      try {
        await requireShowManage(data.mediaId);
        const { checkShow } = await import("./show-watch");
        return { ok: true, outcome: await checkShow(data.mediaId) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

// Serialele urmărite, pentru Watcher → Seriale și filme. Ora verificării vine
// din `media` — o verificare fără rezultat nu scrie în jurnal.
export interface WatchedShowSummary {
  mediaId: number;
  title: string;
  quality: string | null;
  from: string | null;
  lastCheckedAt: string | null;
  nextEpisode: string | null;
  nextEpisodeAirstamp: string | null;
  nextEpisodeAirDate: string | null;
}

export const getShowWatchStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ shows: WatchedShowSummary[] }> => {
    const { requireAuth } = await import("../auth/admin.server");
    await requireAuth();
    const { getDb } = await import("../db");
    const db = getDb();

    const shows = db
      .prepare(
        `SELECT id AS mediaId, title, auto_download_quality AS quality,
                auto_download_from AS "from", watch_last_checked_at AS lastCheckedAt,
                next_episode AS nextEpisode, next_episode_airstamp AS nextEpisodeAirstamp,
                next_episode_air_date AS nextEpisodeAirDate
           FROM media WHERE media_type = 'tv_show' AND auto_download = 1
          ORDER BY title`,
      )
      .all() as unknown as WatchedShowSummary[];

    return { shows };
  },
);

// ---------------------------------------------------------------------------
// Urmărirea filmelor (vezi movie-watch.ts)
// ---------------------------------------------------------------------------

export type {
  SetMovieWatchInput,
  WantedMovie,
  MovieWatchOutcome,
  WantedMovieDetail,
} from "./movie-watch";
import type {
  SetMovieWatchInput,
  WantedMovie,
  MovieWatchOutcome,
  WantedMovieDetail,
} from "./movie-watch";

// Cine poate opri urmărirea unui film: cel care a pornit-o, sau un admin.
async function requireMovieWatchOwner(where: { tmdbId: number } | { mediaId: number }) {
  const { requireAuth, isAdminOrOwner } = await import("../auth/admin.server");
  const session = await requireAuth();
  const { getDb } = await import("../db");
  const db = getDb();
  const row = (
    "tmdbId" in where
      ? db.prepare(
          "SELECT requested_by_user_id FROM media WHERE tmdb_id = ? AND media_type = 'movie'",
        )
      : db.prepare("SELECT requested_by_user_id FROM media WHERE id = ? AND media_type = 'movie'")
  ).get("tmdbId" in where ? where.tmdbId : where.mediaId) as
    { requested_by_user_id: number | null } | undefined;
  // Rând inexistent: oprirea e oricum un no-op, iar „n-ai drepturi” ar fi fals.
  if (!row) return;
  if (!isAdminOrOwner(session, row.requested_by_user_id)) {
    throw new Error("Urmărirea a fost pornită de altcineva");
  }
}

// Pornirea e deschisă oricui e logat (un film așteptat nu consumă nimic);
// oprirea ar putea anula așteptarea altcuiva, deci cere proprietatea.
export const setMovieWatch = createServerFn({ method: "POST" })
  .validator((data: SetMovieWatchInput) => data)
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      const { requireAuth } = await import("../auth/admin.server");
      const session = await requireAuth();
      if (!data.enabled) await requireMovieWatchOwner({ tmdbId: data.tmdbId });
      const { setMovieWatchCore } = await import("./movie-watch");
      await setMovieWatchCore({ ...data, requestedByUserId: session.data.userId ?? null });
      // Prima căutare peste un minut, ca să nu repete căutarea din wizard.
      if (data.enabled) {
        const { pokeWatcher } = await import("../watcher/poke");
        pokeWatcher("show-watch", 65_000);
      }
      return { ok: true };
    } catch (e) {
      // Sesiunea expirată merge mai departe ca eroare (redirect spre login).
      if (isUnauthorizedError(e)) throw e;
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

export const listWantedMovies = createServerFn({ method: "GET" }).handler(
  async (): Promise<WantedMovie[]> => {
    const { requireAuth, isAdminOrOwner } = await import("../auth/admin.server");
    const session = await requireAuth();
    const { listWantedMoviesCore } = await import("./movie-watch");
    // canManage se calculează aici, unde e sesiunea; clientul primește un
    // boolean, nu id-uri de comparat.
    return listWantedMoviesCore().map((m) => ({
      ...m,
      canManage: isAdminOrOwner(session, m.requestedByUserId),
    }));
  },
);

// „Verifică acum” pentru un film — ignoră cadența de 12h.
export const checkMovieNow = createServerFn({ method: "POST" })
  .validator((data: { mediaId: number }) => data)
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; outcome: MovieWatchOutcome } | { ok: false; error: string }> => {
      try {
        await requireMovieWatchOwner({ mediaId: data.mediaId });
        const { checkMovie } = await import("./movie-watch");
        return { ok: true, outcome: await checkMovie(data.mediaId) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

// Detaliile unui film așteptat, pentru drawer (canManage calculat aici).
export const getWantedMovieDetail = createServerFn({ method: "GET" })
  .validator((data: { mediaId: number }) => data)
  .handler(async ({ data }): Promise<(WantedMovieDetail & { canManage: boolean }) | null> => {
    const { requireAuth, isAdminOrOwner } = await import("../auth/admin.server");
    const session = await requireAuth();
    const { getWantedMovieDetailCore } = await import("./movie-watch");
    const detail = getWantedMovieDetailCore(data.mediaId);
    if (!detail) return null;
    return { ...detail, canManage: isAdminOrOwner(session, detail.requestedByUserId) };
  });
