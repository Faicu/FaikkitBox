import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlexItemLink } from "../services/plex-library";

// Bază SQLite reală și temporară, ca în unfinished-torrents.test.ts: calea se
// setează ÎNAINTE de orice import al lui db.ts, altfel getDb() ar deschide
// baza de producție (e calea implicită).
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-test-"));
const dbFile = join(dir, "test.db");
process.env.FAIKKITBOX_DB_PATH = dbFile;

// Plex și TMDB sunt simulate: testul alege ce „a indexat Plex" și câte
// episoade „au fost difuzate", fără nicio cerere în rețea.
vi.mock("../services/plex-library", () => ({ findPlexSeasonLinks: vi.fn() }));
vi.mock("../tmdb/tmdb.functions", () => ({ getTmdbAllSeasonsInternal: vi.fn() }));

type MediaModule = typeof import("./media");
type DbModule = typeof import("../db");

let media: MediaModule;
let db: ReturnType<DbModule["getDb"]>;
let findPlexSeasonLinks: ReturnType<typeof vi.fn>;
let getTmdbAllSeasonsInternal: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  db = (await import("../db")).getDb();
  // Plasă: dacă vreodată ordinea importurilor se schimbă și se deschide altă
  // bază, oprim totul înainte de primul DELETE din beforeEach.
  if (db.location() !== dbFile) {
    throw new Error(`Testul a deschis altă bază decât cea temporară: ${db.location()}`);
  }
  media = await import("./media");
  findPlexSeasonLinks = vi.mocked((await import("../services/plex-library")).findPlexSeasonLinks);
  getTmdbAllSeasonsInternal = vi.mocked(
    (await import("../tmdb/tmdb.functions")).getTmdbAllSeasonsInternal,
  );
});

beforeEach(() => {
  db.exec("DELETE FROM media");
  vi.resetAllMocks();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const HASH = "packhash";

function insertShow(): number {
  return Number(
    db
      .prepare(
        `INSERT INTO media (media_type, title, tmdb_id) VALUES ('tv_show', 'Severance', 95396)`,
      )
      .run().lastInsertRowid,
  );
}

// Rândul-pachet, așa cum îl scrie upsertMediaEntry: episod fără număr,
// is_season_pack = 1, deja terminat de descărcat.
function insertPack(opts: {
  parentId: number | null;
  tmdbId?: number | null;
  completedAgo?: string;
}): number {
  return Number(
    db
      .prepare(
        `INSERT INTO media (media_type, parent_id, tmdb_id, title, season, episode, is_season_pack,
                            torrent_name, torrent_hash, completed_at, subtitle_source, size)
         VALUES ('episode', ?, ?, 'Severance', 2, NULL, 1, 'Severance.S02.1080p', ?,
                 datetime('now', ?), 'opensubtitles', 5000)`,
      )
      .run(
        opts.parentId,
        opts.tmdbId === undefined ? 95396 : opts.tmdbId,
        HASH,
        opts.completedAgo ?? "-1 minutes",
      ).lastInsertRowid,
  );
}

function insertEpisode(opts: {
  parentId: number | null;
  episode: number;
  plexKey?: string | null;
  hash?: string;
}): number {
  return Number(
    db
      .prepare(
        `INSERT INTO media (media_type, parent_id, title, season, episode, plex_rating_key,
                            torrent_hash, completed_at)
         VALUES ('episode', ?, 'Severance', 2, ?, ?, ?, datetime('now', '-2 days'))`,
      )
      .run(opts.parentId, opts.episode, opts.plexKey ?? null, opts.hash ?? "otherhash")
      .lastInsertRowid,
  );
}

function link(ep: number): PlexItemLink {
  return { ratingKey: `rk-${ep}`, quality: "1080p", durationMs: 3_000_000, addedAt: 1_700_000_000 };
}

// Ce „a indexat Plex" din sezonul 2 la trecerea curentă.
function plexHas(episodes: number[]): void {
  findPlexSeasonLinks.mockResolvedValue(new Map(episodes.map((e) => [e, link(e)])));
}

function tmdbAired(count: number): void {
  getTmdbAllSeasonsInternal.mockResolvedValue([
    {
      seasonNumber: 2,
      episodes: Array.from({ length: count }, (_, i) => ({ episodeNumber: i + 1, aired: true })),
    },
  ]);
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

type EpisodeRow = {
  id: number;
  episode: number | null;
  plex_rating_key: string | null;
  is_season_pack: number;
  parent_id: number | null;
  torrent_hash: string | null;
};

function episodeRows(): EpisodeRow[] {
  return db
    .prepare(
      `SELECT id, episode, plex_rating_key, is_season_pack, parent_id, torrent_hash
         FROM media WHERE media_type = 'episode' ORDER BY episode`,
    )
    .all() as EpisodeRow[];
}

const packRow = () => episodeRows().find((r) => r.is_season_pack === 1);

describe("resolveSeasonPackPlexLinks", () => {
  it("cu indexarea Plex în curs, creează episoadele găsite și păstrează pachetul", async () => {
    const parent = insertShow();
    insertPack({ parentId: parent });
    plexHas([1, 2, 3]);
    tmdbAired(10);

    expect(await media.resolveSeasonPackPlexLinks(HASH)).toBe(false);

    const eps = episodeRows().filter((r) => r.is_season_pack === 0);
    expect(eps.map((r) => r.episode)).toEqual([1, 2, 3]);
    expect(eps.map((r) => r.plex_rating_key)).toEqual(["rk-1", "rk-2", "rk-3"]);
    expect(eps.every((r) => r.parent_id === parent && r.torrent_hash === HASH)).toBe(true);
    // Pachetul rămâne marcaj de „încă se indexează" — de el depinde ca
    // reconcilierul să mai încerce și show-watch să nu redescarce episoadele.
    expect(packRow()).toBeDefined();
  });

  it("la trecerea completă nu dublează nimic și șterge pachetul", async () => {
    const parent = insertShow();
    insertPack({ parentId: parent });
    tmdbAired(10);

    plexHas([1, 2, 3]);
    await media.resolveSeasonPackPlexLinks(HASH);
    plexHas(range(1, 10));
    expect(await media.resolveSeasonPackPlexLinks(HASH)).toBe(true);

    const rows = episodeRows();
    expect(rows.map((r) => r.episode)).toEqual(range(1, 10));
    expect(packRow()).toBeUndefined();
  });

  it("episoadele create sunt episoade, nu pachete, și moștenesc datele pachetului", async () => {
    const parent = insertShow();
    insertPack({ parentId: parent });
    plexHas([1]);
    tmdbAired(1);

    await media.resolveSeasonPackPlexLinks(HASH);

    const row = db
      .prepare(
        `SELECT is_season_pack, tmdb_id, torrent_name, completed_at, subtitle_source, quality,
                duration_ms, plex_added_at, size
           FROM media WHERE episode = 1`,
      )
      .get() as Record<string, unknown>;
    expect(row).toMatchObject({
      is_season_pack: 0,
      tmdb_id: 95396,
      torrent_name: "Severance.S02.1080p",
      subtitle_source: "opensubtitles",
      quality: "1080p",
      duration_ms: 3_000_000,
      plex_added_at: 1_700_000_000,
      size: 5000,
    });
    expect(row.completed_at).not.toBeNull();
  });

  it("un pachet incomplet e acceptat după fereastra de grație, nu rămâne blocat", async () => {
    insertPack({ parentId: insertShow(), completedAgo: "-3 hours" });
    plexHas(range(1, 8));
    tmdbAired(10);

    expect(await media.resolveSeasonPackPlexLinks(HASH)).toBe(true);
    expect(episodeRows().map((r) => r.episode)).toEqual(range(1, 8));
  });

  it("în fereastra de grație, un pachet incomplet mai așteaptă", async () => {
    insertPack({ parentId: insertShow(), completedAgo: "-90 minutes" });
    plexHas(range(1, 8));
    tmdbAired(10);

    expect(await media.resolveSeasonPackPlexLinks(HASH)).toBe(false);
    expect(packRow()).toBeDefined();
  });

  it("cu TMDB indisponibil acceptă ce a găsit Plex, nu așteaptă la nesfârșit", async () => {
    insertPack({ parentId: insertShow() });
    plexHas([1, 2]);
    getTmdbAllSeasonsInternal.mockRejectedValue(new Error("TMDB down"));

    expect(await media.resolveSeasonPackPlexLinks(HASH)).toBe(true);
    expect(packRow()).toBeUndefined();
  });

  it("fără tmdb_id acceptă ce a găsit Plex, fără să întrebe TMDB", async () => {
    insertPack({ parentId: insertShow(), tmdbId: null });
    plexHas([1, 2]);

    expect(await media.resolveSeasonPackPlexLinks(HASH)).toBe(true);
    expect(getTmdbAllSeasonsInternal).not.toHaveBeenCalled();
  });

  it("un episod descărcat separat sub același serial e actualizat, nu dublat", async () => {
    const parent = insertShow();
    const separate = insertEpisode({ parentId: parent, episode: 4 });
    insertPack({ parentId: parent });
    plexHas(range(1, 5));
    tmdbAired(5);

    await media.resolveSeasonPackPlexLinks(HASH);

    const fours = episodeRows().filter((r) => r.episode === 4);
    expect(fours).toHaveLength(1);
    expect(fours[0]).toMatchObject({ id: separate, plex_rating_key: "rk-4" });
  });

  it("un episod deja legat sub alt părinte nu rupe bucla pe indexul unic", async () => {
    // Descărcat înainte ca placeholder-ul serialului să fie rezolvat: are
    // deja ratingKey-ul, dar alt parent_id decât pachetul.
    const orphan = insertEpisode({ parentId: null, episode: 2, plexKey: "rk-2" });
    insertPack({ parentId: insertShow() });
    plexHas([1, 2, 3]);
    tmdbAired(3);

    expect(await media.resolveSeasonPackPlexLinks(HASH)).toBe(true);

    const rows = episodeRows();
    expect(rows.map((r) => r.episode)).toEqual([1, 2, 3]);
    expect(rows.find((r) => r.episode === 2)?.id).toBe(orphan);
  });

  it("un pachet fără părinte nu reinserează episoadele la fiecare trecere", async () => {
    insertPack({ parentId: null });
    tmdbAired(10);

    plexHas([1, 2]);
    await media.resolveSeasonPackPlexLinks(HASH);
    plexHas([1, 2, 3]);
    await media.resolveSeasonPackPlexLinks(HASH);

    expect(
      episodeRows()
        .filter((r) => r.is_season_pack === 0)
        .map((r) => r.episode),
    ).toEqual([1, 2, 3]);
  });

  it("un pachet fără părinte regăsește și episodul separat încă nelegat", async () => {
    // Singurul caz în care contează `parent_id IS ?`: episodul n-are încă
    // ratingKey, deci plasa pe indexul unic nu-l poate găsi în locul lui.
    const separate = insertEpisode({ parentId: null, episode: 2 });
    insertPack({ parentId: null });
    plexHas([1, 2]);
    tmdbAired(2);

    await media.resolveSeasonPackPlexLinks(HASH);

    const twos = episodeRows().filter((r) => r.episode === 2);
    expect(twos).toHaveLength(1);
    expect(twos[0]).toMatchObject({ id: separate, plex_rating_key: "rk-2" });
  });

  it("dacă Plex nu găsește serialul, nu atinge nimic", async () => {
    insertPack({ parentId: insertShow() });
    findPlexSeasonLinks.mockResolvedValue(null);

    expect(await media.resolveSeasonPackPlexLinks(HASH)).toBe(false);
    expect(episodeRows()).toHaveLength(1);
    expect(packRow()).toBeDefined();
  });

  it("dacă Plex n-a indexat încă nimic din sezon, nu atinge nimic", async () => {
    insertPack({ parentId: insertShow() });
    plexHas([]);

    expect(await media.resolveSeasonPackPlexLinks(HASH)).toBe(false);
    expect(episodeRows()).toHaveLength(1);
  });

  it("un hash fără rând-pachet întoarce false fără să întrebe Plex", async () => {
    insertEpisode({ parentId: null, episode: 1, hash: HASH });

    expect(await media.resolveSeasonPackPlexLinks(HASH)).toBe(false);
    expect(findPlexSeasonLinks).not.toHaveBeenCalled();
  });
});
