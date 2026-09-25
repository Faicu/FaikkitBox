// ---------------------------------------------------------------------------
// Reîmprospătarea metadatelor de film.
//
// Detaliile unui film (titlu, an, descriere, genuri, poster) se scriau o
// singură dată, la adăugare, și rămâneau înghețate. Un film adăugat înainte ca
// TMDB să aibă traducerea românească rămânea pe veci cu titlul original —
// „Mutiny" în loc de „Trădare la nivel înalt" (găsit 26 sept. 2026, alături de
// alte cinci filme). Serialele aveau deja reîmprospătare (refreshShowMetadata
// din show-watch.ts); filmele n-au fost incluse niciodată.
//
// Detaliile se cer în română la fiecare trecere (getTmdbDetailsInternal, cu
// engleza ca rezervă pentru ce lipsește), deci un câmp încă neromânesc se
// corectează singur la cel mult 12 ore după ce apare traducerea pe TMDB.
// Posterul la fel: la o cerere ro-RO, TMDB întoarce posterul românesc când
// există. Fiecare câmp se scrie separat și doar cu o valoare nevidă — ce
// lipsește la TMDB nu șterge ce avem.
// ---------------------------------------------------------------------------

import { getDb } from "../db";
import { META_INTERVAL_MS } from "./show-watch";

export async function refreshMovieMetadata(): Promise<number> {
  const db = getDb();
  const due = db
    .prepare(
      `SELECT id, tmdb_id FROM media
         WHERE media_type = 'movie' AND tmdb_id IS NOT NULL
           AND (meta_refreshed_at IS NULL OR meta_refreshed_at <= datetime('now', ?))
         ORDER BY meta_refreshed_at IS NOT NULL, meta_refreshed_at`,
    )
    .all(`-${Math.round(META_INTERVAL_MS / 1000)} seconds`) as unknown as Array<{
    id: number;
    tmdb_id: number;
  }>;
  if (due.length === 0) return 0;

  // Un film poate avea mai multe rânduri (versiuni în calități diferite) —
  // TMDB se întreabă o singură dată per film.
  const byTmdb = new Map<number, number[]>();
  for (const r of due) byTmdb.set(r.tmdb_id, [...(byTmdb.get(r.tmdb_id) ?? []), r.id]);

  // Încercarea se marchează și când TMDB n-a răspuns — altfel un tmdb_id care
  // nu mai rezolvă ar fi reîncercat la fiecare rulare (vezi refreshShowMetadata).
  const touch = db.prepare("UPDATE media SET meta_refreshed_at = datetime('now') WHERE id = ?");
  const update = db.prepare(
    `UPDATE media
        SET title = COALESCE(NULLIF(?, ''), title),
            original_title = COALESCE(NULLIF(?, ''), original_title),
            literal_title = COALESCE(?, literal_title),
            year = COALESCE(?, year),
            overview_ro = COALESCE(NULLIF(?, ''), overview_ro),
            genres = COALESCE(?, genres),
            poster_path = COALESCE(NULLIF(?, ''), poster_path),
            imdb_id = COALESCE(imdb_id, ?),
            meta_refreshed_at = datetime('now')
      WHERE id = ?`,
  );

  const { getTmdbDetailsInternal } = await import("../tmdb/tmdb.functions");
  let refreshed = 0;
  for (const [tmdbId, ids] of byTmdb) {
    // getTmdbDetailsInternal nu aruncă la o eroare TMDB: întoarce un obiect
    // cu titlul gol. Tratat ca eșec — nimic de scris.
    const details = await getTmdbDetailsInternal(tmdbId, "movie").catch(() => null);
    if (!details?.title) {
      for (const id of ids) touch.run(id);
      continue;
    }
    const year = details.releaseDate ? Number(details.releaseDate.slice(0, 4)) : null;
    const genres = (details.genres ?? []).length > 0 ? JSON.stringify(details.genres) : null;
    for (const id of ids) {
      update.run(
        details.title,
        details.originalTitle,
        details.literalTitle ?? null,
        Number.isFinite(year) ? year : null,
        details.overview ?? null,
        genres,
        details.posterUrl ?? null,
        details.imdbId ?? null,
        id,
      );
    }
    refreshed++;
  }
  if (refreshed > 0)
    console.log(`[movie-metadata] Metadate reîmprospătate pentru ${refreshed} filme`);
  return refreshed;
}
