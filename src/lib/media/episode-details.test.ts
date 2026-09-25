import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Detaliile episoadelor (nume, descriere, imagine, posterul sezonului), pe o
// bază SQLite reală și temporară, cu TMDB simulat. Calea bazei se setează
// ÎNAINTE de orice import al lui db.ts (vezi season-pack-link.test.ts).
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-test-"));
const dbFile = join(dir, "test.db");
process.env.FAIKKITBOX_DB_PATH = dbFile;

vi.mock("../tmdb/tmdb.functions", () => ({ getTmdbAllSeasonsInternal: vi.fn() }));

let watch: typeof import("./show-watch");
let db: ReturnType<typeof import("../db").getDb>;
let seasons: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  db = (await import("../db")).getDb();
  if (db.location() !== dbFile) {
    throw new Error(`Testul a deschis altă bază decât cea temporară: ${db.location()}`);
  }
  watch = await import("./show-watch");
  seasons = vi.mocked((await import("../tmdb/tmdb.functions")).getTmdbAllSeasonsInternal);
});

beforeEach(() => {
  db.exec("DELETE FROM media");
  vi.resetAllMocks();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SHOW_POSTER = "https://image.tmdb.org/t/p/w342/serial.jpg";
const SEASON_POSTER = "https://image.tmdb.org/t/p/w342/sezon1-ro.jpg";
const STILL = "https://image.tmdb.org/t/p/w300/cadru.jpg";

function show(tmdbId = 95350): number {
  return Number(
    db
      .prepare(`INSERT INTO media (media_type, title, tmdb_id) VALUES ('tv_show', 'Lanterns', ?)`)
      .run(tmdbId).lastInsertRowid,
  );
}

function episode(parentId: number, ep: number, title: string | null = null): number {
  return Number(
    db
      .prepare(
        `INSERT INTO media (media_type, parent_id, title, season, episode, episode_title,
                            overview_ro, poster_path)
         VALUES ('episode', ?, 'Lanterns', 1, ?, ?, 'Descrierea serialului', ?)`,
      )
      .run(parentId, ep, title, SHOW_POSTER).lastInsertRowid,
  );
}

// Sezonul 1 după TMDB: `eps` = [număr, titlu, descriere, imagine, dată].
function tmdbSeason1(
  eps: Array<[number, string, string | null, string | null, string?]>,
  posterUrl: string | null = SEASON_POSTER,
): void {
  seasons.mockResolvedValue([
    {
      seasonNumber: 1,
      posterUrl,
      episodes: eps.map(([n, title, overview, stillUrl, airDate]) => ({
        episodeNum: n,
        title,
        overview,
        stillUrl,
        airDate: airDate ?? "2026-08-16",
        aired: true,
      })),
    },
  ]);
}

const get = (id: number) =>
  db
    .prepare(
      `SELECT episode_title, episode_overview, episode_still, poster_path, overview_ro
         FROM media WHERE id = ?`,
    )
    .get(id) as Record<string, string | null>;

describe("syncEpisodeDetails", () => {
  it("completează numele, descrierea, imaginea și posterul sezonului", async () => {
    const parent = show();
    const e = episode(parent, 5);
    tmdbSeason1([[5, "Stingerea", "Descrierea episodului", STILL]]);

    await watch.syncEpisodeDetails({ parentId: parent });

    expect(get(e)).toEqual({
      episode_title: "Stingerea",
      episode_overview: "Descrierea episodului",
      episode_still: STILL,
      poster_path: SEASON_POSTER,
      // Descrierea serialului rămâne neatinsă — e rezerva din UI.
      overview_ro: "Descrierea serialului",
    });
    expect(seasons).toHaveBeenCalledWith(95350, [1], { details: true });
  });

  it("la reîmprospătare, numele în engleză e înlocuit cu cel românesc (Lanterns)", async () => {
    const parent = show();
    const e = episode(parent, 5, "Lights Out");
    tmdbSeason1([[5, "Stingerea", null, null]]);

    await watch.syncEpisodeDetails({ parentId: parent, all: true });

    expect(get(e).episode_title).toBe("Stingerea");
  });

  it("un „Episodul N” nu înlocuiește un nume existent", async () => {
    const parent = show();
    const e = episode(parent, 1, "Soul of a Rebel");
    tmdbSeason1([[1, "Episodul 1", null, null]]);

    await watch.syncEpisodeDetails({ parentId: parent, all: true });

    expect(get(e).episode_title).toBe("Soul of a Rebel");
  });

  it("ce lipsește la TMDB nu șterge ce avem", async () => {
    const parent = show();
    const e = episode(parent, 2, "Nume");
    db.prepare("UPDATE media SET episode_overview = 'Veche', episode_still = ? WHERE id = ?").run(
      STILL,
      e,
    );
    tmdbSeason1([[2, "Nume", null, null]], null);

    await watch.syncEpisodeDetails({ parentId: parent, all: true });

    expect(get(e)).toMatchObject({
      episode_overview: "Veche",
      episode_still: STILL,
      poster_path: SHOW_POSTER,
    });
  });

  it("plugin-ul (fără parentId) ia doar episoadele fără nume", async () => {
    const parent = show();
    const named = episode(parent, 1, "Are nume");
    const unnamed = episode(parent, 2);
    tmdbSeason1([
      [1, "Alt nume", "d1", STILL],
      [2, "Nume nou", "d2", STILL],
    ]);

    await watch.syncEpisodeDetails();

    expect(get(named).episode_title).toBe("Are nume");
    expect(get(named).episode_overview).toBeNull();
    expect(get(unnamed).episode_title).toBe("Nume nou");
  });

  it("după o descărcare (parentId), completează și episoadele fără descriere", async () => {
    const parent = show();
    const e = episode(parent, 1, "Are nume");
    tmdbSeason1([[1, "Are nume", "Descriere nouă", STILL]]);

    await watch.syncEpisodeDetails({ parentId: parent });

    expect(get(e).episode_overview).toBe("Descriere nouă");
  });

  it("parentId atinge doar serialul acela", async () => {
    const a = show(1);
    const b = show(2);
    const ea = episode(a, 1);
    const eb = episode(b, 1);
    tmdbSeason1([[1, "Pilot", null, null]]);

    await watch.syncEpisodeDetails({ parentId: a });

    expect(get(ea).episode_title).toBe("Pilot");
    expect(get(eb).episode_title).toBeNull();
  });

  it("placeholder la un episod abia difuzat: încă așteaptă numele real", async () => {
    const parent = show();
    const e = episode(parent, 7);
    tmdbSeason1([[7, "Episodul 7", null, null, new Date().toISOString().slice(0, 10)]]);

    await watch.syncEpisodeDetails({ parentId: parent });

    expect(get(e).episode_title).toBeNull();
  });

  it("placeholder la un episod difuzat demult: e acceptat, ca să nu reîncerce la nesfârșit", async () => {
    const parent = show();
    const e = episode(parent, 1);
    tmdbSeason1([[1, "Episodul 1", null, null, "2025-01-01"]]);

    await watch.syncEpisodeDetails();

    expect(get(e).episode_title).toBe("Episodul 1");
  });
});
