import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Reîmprospătarea detaliilor (filme și seriale), pe o bază SQLite reală și
// temporară, cu TMDB simulat. Calea bazei se setează ÎNAINTE de orice import
// al lui db.ts (vezi season-pack-link.test.ts).
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-test-"));
const dbFile = join(dir, "test.db");
process.env.FAIKKITBOX_DB_PATH = dbFile;

vi.mock("../tmdb/tmdb.functions", () => ({
  getTmdbDetailsInternal: vi.fn(),
  getTmdbAllSeasonsInternal: vi.fn(),
}));
vi.mock("../tvmaze/tvmaze.functions", () => ({ getTvmazeAirstampsInternal: vi.fn() }));

let movies: typeof import("./movie-metadata");
let shows: typeof import("./show-watch");
let db: ReturnType<typeof import("../db").getDb>;
let details: ReturnType<typeof vi.fn>;
let seasons: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  db = (await import("../db")).getDb();
  if (db.location() !== dbFile) {
    throw new Error(`Testul a deschis altă bază decât cea temporară: ${db.location()}`);
  }
  movies = await import("./movie-metadata");
  shows = await import("./show-watch");
  details = vi.mocked((await import("../tmdb/tmdb.functions")).getTmdbDetailsInternal);
  seasons = vi.mocked((await import("../tmdb/tmdb.functions")).getTmdbAllSeasonsInternal);
});

beforeEach(async () => {
  db.exec("DELETE FROM media");
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  const tv = await import("../tvmaze/tvmaze.functions");
  vi.mocked(tv.getTvmazeAirstampsInternal).mockResolvedValue([]);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const POSTER_EN = "https://image.tmdb.org/t/p/w342/pu2Vx.jpg";
const POSTER_RO = "https://image.tmdb.org/t/p/w342/nyLj6.jpg";

// Filmul „Mutiny", așa cum fusese salvat la adăugare, înainte ca TMDB să aibă
// traducerea românească.
function mutiny(opts: { refreshedAgo?: string } = {}): number {
  return Number(
    db
      .prepare(
        `INSERT INTO media (media_type, title, original_title, tmdb_id, imdb_id, year,
                            overview_ro, genres, poster_path, meta_refreshed_at)
         VALUES ('movie', 'Mutiny', 'Mutiny', 1288445, 'tt32338669', 2026,
                 'English overview', '["Action"]', ?,
                 CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', ?) END)`,
      )
      .run(POSTER_EN, opts.refreshedAgo ?? null, opts.refreshedAgo ?? null).lastInsertRowid,
  );
}

function tmdbMovie(over: Record<string, unknown> = {}) {
  return {
    id: 1288445,
    mediaType: "movie",
    title: "Trădare la nivel înalt",
    originalTitle: "Mutiny",
    literalTitle: null,
    imdbId: "tt32338669",
    releaseDate: "2026-01-09",
    tvStatus: null,
    nextEpisode: null,
    seasons: [],
    overview: "Descriere în română",
    genres: ["Acțiune", "Thriller"],
    posterUrl: POSTER_RO,
    ...over,
  };
}

const row = (id: number) =>
  db
    .prepare(
      `SELECT title, original_title, year, overview_ro, genres, poster_path, meta_refreshed_at
         FROM media WHERE id = ?`,
    )
    .get(id) as Record<string, unknown>;

describe("refreshMovieMetadata", () => {
  it("aduce toate detaliile în română (Mutiny → Trădare la nivel înalt)", async () => {
    const id = mutiny();
    details.mockResolvedValue(tmdbMovie());

    expect(await movies.refreshMovieMetadata()).toBe(1);

    expect(row(id)).toMatchObject({
      title: "Trădare la nivel înalt",
      original_title: "Mutiny",
      year: 2026,
      overview_ro: "Descriere în română",
      genres: '["Acțiune","Thriller"]',
      poster_path: POSTER_RO,
    });
    expect(row(id).meta_refreshed_at).not.toBeNull();
  });

  it("schimbă doar ce s-a schimbat: un câmp gol la TMDB nu șterge ce avem", async () => {
    const id = mutiny();
    details.mockResolvedValue(tmdbMovie({ overview: null, genres: [], posterUrl: null }));

    await movies.refreshMovieMetadata();

    expect(row(id)).toMatchObject({
      title: "Trădare la nivel înalt",
      overview_ro: "English overview",
      genres: '["Action"]',
      poster_path: POSTER_EN,
    });
  });

  it("dacă TMDB nu răspunde, nu atinge nimic, dar marchează încercarea", async () => {
    const id = mutiny();
    details.mockResolvedValue(tmdbMovie({ title: "", originalTitle: "", genres: [] }));

    expect(await movies.refreshMovieMetadata()).toBe(0);

    expect(row(id)).toMatchObject({ title: "Mutiny", poster_path: POSTER_EN });
    expect(row(id).meta_refreshed_at).not.toBeNull();
  });

  it("nu cere din nou ce a fost reîmprospătat în ultimele 12 ore", async () => {
    mutiny({ refreshedAgo: "-11 hours" });

    await movies.refreshMovieMetadata();

    expect(details).not.toHaveBeenCalled();
  });

  it("cere din nou după 12 ore — așa ajunge româna, când apare pe TMDB", async () => {
    const id = mutiny({ refreshedAgo: "-13 hours" });
    details.mockResolvedValue(tmdbMovie());

    await movies.refreshMovieMetadata();

    expect(row(id).title).toBe("Trădare la nivel înalt");
  });

  it("fără limită pe rulare: toate filmele scadente într-o singură trecere", async () => {
    for (let i = 0; i < 12; i++) {
      db.prepare(`INSERT INTO media (media_type, title, tmdb_id) VALUES ('movie', 'F', ?)`).run(
        i + 1,
      );
    }
    details.mockImplementation(async (tmdbId: number) =>
      tmdbMovie({ id: tmdbId, title: `Film ${tmdbId}` }),
    );

    expect(await movies.refreshMovieMetadata()).toBe(12);
  });

  it("două versiuni ale aceluiași film: o singură cerere, ambele actualizate", async () => {
    const a = mutiny();
    const b = mutiny();
    details.mockResolvedValue(tmdbMovie());

    await movies.refreshMovieMetadata();

    expect(details).toHaveBeenCalledTimes(1);
    expect([row(a).title, row(b).title]).toEqual([
      "Trădare la nivel înalt",
      "Trădare la nivel înalt",
    ]);
  });
});

describe("refreshShowMetadata — toate detaliile", () => {
  function show(): { showId: number; episodeId: number } {
    const showId = Number(
      db
        .prepare(
          `INSERT INTO media (media_type, title, original_title, tmdb_id, imdb_id, overview_ro,
                              genres, poster_path, next_episode, tv_status)
           VALUES ('tv_show', 'Élite', 'Élite', 76669, 'tt7134908', 'English', '["Drama"]', ?,
                   'S09E01', 'Returning Series')`,
        )
        .run(POSTER_EN).lastInsertRowid,
    );
    const episodeId = Number(
      db
        .prepare(
          `INSERT INTO media (media_type, parent_id, title, season, episode, overview_ro, genres,
                              poster_path)
           VALUES ('episode', ?, 'Élite', 3, 1, 'English', '["Drama"]', ?)`,
        )
        .run(showId, POSTER_EN).lastInsertRowid,
    );
    return { showId, episodeId };
  }

  const tmdbShow = (over: Record<string, unknown> = {}) => ({
    id: 76669,
    mediaType: "tv",
    title: "Elita",
    originalTitle: "Élite",
    literalTitle: null,
    imdbId: "tt7134908",
    releaseDate: "2018-10-05",
    tvStatus: "Ended",
    nextEpisode: null,
    seasons: [],
    overview: "Descriere RO",
    genres: ["Dramă", "Crimă"],
    posterUrl: POSTER_RO,
    ...over,
  });

  it("serialul și episoadele lui primesc descrierea, genurile și posterele românești", async () => {
    const { showId, episodeId } = show();
    details.mockResolvedValue(tmdbShow());
    const SEASON3 = "https://image.tmdb.org/t/p/w342/sezon3.jpg";
    seasons.mockResolvedValue([
      {
        seasonNumber: 3,
        posterUrl: SEASON3,
        episodes: [
          {
            episodeNum: 1,
            title: "Carla",
            overview: "Episodul RO",
            stillUrl: null,
            airDate: "2020-03-13",
            aired: true,
          },
        ],
      },
    ]);

    await shows.refreshShowMetadata();

    expect(row(showId)).toMatchObject({
      title: "Elita",
      overview_ro: "Descriere RO",
      genres: '["Dramă","Crimă"]',
      poster_path: POSTER_RO,
    });
    // Episodul: aceeași descriere și aceleași genuri ale serialului (rezerva
    // din UI), dar posterul SEZONULUI, nu al serialului.
    expect(row(episodeId)).toMatchObject({
      title: "Elita",
      overview_ro: "Descriere RO",
      genres: '["Dramă","Crimă"]',
      poster_path: SEASON3,
    });
    // Episoadele se reîmprospătează odată cu serialul, toate.
    expect(seasons).toHaveBeenCalledWith(76669, [3], { details: true });
  });

  it("un TMDB căzut nu mai șterge următorul episod anunțat", async () => {
    const { showId } = show();
    details.mockResolvedValue(tmdbShow({ title: "", originalTitle: "", genres: [] }));

    await shows.refreshShowMetadata();

    const r = db
      .prepare("SELECT next_episode, title, meta_refreshed_at FROM media WHERE id = ?")
      .get(showId) as { next_episode: string; title: string; meta_refreshed_at: string | null };
    expect(r.next_episode).toBe("S09E01");
    expect(r.title).toBe("Élite");
    expect(r.meta_refreshed_at).not.toBeNull();
  });
});
