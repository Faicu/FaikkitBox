// ---------------------------------------------------------------------------
// Server functions pentru `media`, separate intenționat de media.ts.
//
// media.ts are `import { getDb } from "../db"` static la vârf, iar db.ts
// conține schema SQLite completă și hashing-ul de parole. Cât timp componente
// client importau server functions DIN media.ts, tot graful ajungea în
// bundle-ul public: /assets/db-*.js era servit cu 200 către orice browser
// (verificat — fără valori secrete din .env, care sunt înlocuite la build, dar
// cu schema și structura internă la vedere).
//
// Fișierul ăsta e subțire și fără importuri server statice: corpul unui
// handler de server function e eliminat din bundle-ul de client, deci
// `await import("./media")` de mai jos rămâne exclusiv pe server.
//
// Regulă generală: orice modul importat de componente client trebuie să nu
// aibă importuri statice server-only.
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";

// Doar tipuri — se șterg la compilare, nu trag nimic în bundle.
export type { LibraryTitleMatch, DownloadingMediaEntry } from "./media";
import type { LibraryTitleMatch, DownloadingMediaEntry } from "./media";
export type { ShowWatchOutcome, SetShowWatchInput } from "./show-watch";
import type { ShowWatchOutcome, SetShowWatchInput } from "./show-watch";

// Căutare de titluri deja existente în bibliotecă (rânduri-rădăcină, fără
// parent_id) — folosită la descărcarea manuală de pe Filelist.
export const searchLibraryTitles = createServerFn({ method: "GET" })
  .validator((data: { query: string }) => data)
  .handler(async ({ data }): Promise<LibraryTitleMatch[]> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { searchLibraryTitlesCore } = await import("./media");
    return searchLibraryTitlesCore(data.query);
  });

// Ce e deja în curs de descărcare pentru un titlu (torrent pornit, dar încă
// neindexat de Plex) — folosit de wizard ca să blocheze acțiuni duplicate.
export const getDownloadingMediaForTmdbId = createServerFn({ method: "GET" })
  .validator((data: { tmdbId: number; mediaType: "movie" | "tv" }) => data)
  .handler(async ({ data }): Promise<DownloadingMediaEntry[]> => {
    const { requireAuth } = await import("../auth/admin.server");
    await requireAuth();
    const { getDownloadingMediaForTmdbIdCore } = await import("./media");
    return getDownloadingMediaForTmdbIdCore(data.tmdbId, data.mediaType);
  });

// ---------------------------------------------------------------------------
// Urmărirea serialelor (vezi show-watch.ts)
// ---------------------------------------------------------------------------

// Aceeași regulă de permisiune ca la ștergere/corectare din drawer: cine a
// adăugat serialul, sau un admin. Urmărirea pornește descărcări reale, deci
// n-are ce căuta la îndemâna oricui e logat.
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
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

// "Verifică acum" din drawer — ignoră cadența de 3 ore pentru serialul
// deschis. Depanarea tipică e "de ce n-a descărcat episodul?", iar fără
// butonul ăsta răspunsul ar fi "așteaptă 3 ore și vezi".
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

// Starea urmăririi, pentru panoul "Plugin-uri active" din Tehnic: câte
// seriale sunt urmărite și când a verificat plugin-ul ultima dată. Timestamp-ul
// vine din `media`, nu din jurnalul de activitate — o verificare care n-a găsit
// nimic nu loghează nimic (corect, altfel ar umple jurnalul la fiecare 3 ore),
// deci jurnalul n-ar arăta niciodată că plugin-ul e viu.
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

export interface MissingTitleSummary {
  show: string;
  code: string;
}

export const getShowWatchStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    lastCheckedAt: string | null;
    lastMetaRefreshAt: string | null;
    shows: WatchedShowSummary[];
    missingTitles: MissingTitleSummary[];
  }> => {
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

    // Aceeași condiție ca fillMissingEpisodeTitles — stare tranzitorie, de
    // obicei goală; apare între descărcarea unui episod și următorul ciclu,
    // sau cât timp TMDB încă n-a publicat titlul. Plafonat, ca un serial
    // proaspăt adăugat să nu trimită sute de rânduri către UI.
    const missingTitles = db
      .prepare(
        `SELECT p.title AS show, e.season, e.episode
           FROM media e JOIN media p ON p.id = e.parent_id
          WHERE e.media_type = 'episode' AND e.episode_title IS NULL
            AND e.season IS NOT NULL AND e.episode IS NOT NULL
            AND p.tmdb_id IS NOT NULL
          ORDER BY p.title, e.season, e.episode
          LIMIT 30`,
      )
      .all() as unknown as Array<{ show: string; season: number; episode: number }>;

    const meta = db
      .prepare("SELECT MAX(meta_refreshed_at) AS last FROM media WHERE media_type = 'tv_show'")
      .get() as { last: string | null };

    return {
      lastCheckedAt: shows.reduce<string | null>(
        (max, s) => (s.lastCheckedAt && (!max || s.lastCheckedAt > max) ? s.lastCheckedAt : max),
        null,
      ),
      lastMetaRefreshAt: meta?.last ?? null,
      shows,
      missingTitles: missingTitles.map((m) => ({
        show: m.show,
        code: `S${String(m.season).padStart(2, "0")}E${String(m.episode).padStart(2, "0")}`,
      })),
    };
  },
);

// ---------------------------------------------------------------------------
// Urmărirea filmelor (vezi movie-watch.ts)
// ---------------------------------------------------------------------------

export type { SetMovieWatchInput, WantedMovie, MovieWatchOutcome } from "./movie-watch";
import type { SetMovieWatchInput, WantedMovie, MovieWatchOutcome } from "./movie-watch";

// Cine poate opri o urmărire de film: cel care a pornit-o, sau un admin —
// aceeași regulă ca la ștergerea unui titlu din bibliotecă (isAdminOrOwner).
// Pornirea nu trece pe aici: e deschisă oricui e logat, fiindcă un film
// așteptat nu ocupă nimic până când chiar apare.
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
  // Rând inexistent: lăsăm să treacă. Oprirea unei urmăriri care oricum nu mai
  // există e un no-op în setMovieWatchCore, iar un mesaj de "n-ai drepturi"
  // aici ar fi și fals, și derutant.
  if (!row) return;
  if (!isAdminOrOwner(session, row.requested_by_user_id)) {
    throw new Error("Urmărirea a fost pornită de altcineva");
  }
}

// Pornirea e deschisă oricui e logat — un film așteptat nu consumă nimic până
// când apare, iar descărcarea pe care o declanșează atunci e exact ce a cerut
// utilizatorul. Oprirea, în schimb, ar putea anula așteptarea altcuiva, deci
// trece prin verificarea de proprietate.
export const setMovieWatch = createServerFn({ method: "POST" })
  .validator((data: SetMovieWatchInput) => data)
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      const { requireAuth } = await import("../auth/admin.server");
      const session = await requireAuth();
      if (!data.enabled) await requireMovieWatchOwner({ tmdbId: data.tmdbId });
      const { setMovieWatchCore } = await import("./movie-watch");
      await setMovieWatchCore({ ...data, requestedByUserId: session.data.userId ?? null });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

export const listWantedMovies = createServerFn({ method: "GET" }).handler(
  async (): Promise<WantedMovie[]> => {
    const { requireAuth, isAdminOrOwner } = await import("../auth/admin.server");
    const session = await requireAuth();
    const { listWantedMoviesCore } = await import("./movie-watch");
    // canManage se calculează aici, nu în stratul de DB: sesiunea e cunoscută
    // doar la nivelul ăsta. Clientul primește un boolean gata decis, ca la
    // titlurile din bibliotecă — nu-i trimitem id-uri de utilizator ca să
    // compare el.
    return listWantedMoviesCore().map((m) => ({
      ...m,
      canManage: isAdminOrOwner(session, m.requestedByUserId),
    }));
  },
);

// "Verifică acum" pentru un film urmărit — ignoră cadența de 12 ore. Aceeași
// nevoie ca la checkShowNow: fără el, răspunsul la "de ce n-a descărcat?" ar
// fi "așteaptă 12 ore și vezi".
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
