import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Bază SQLite reală și temporară — calea se setează ÎNAINTE de orice import al
// lui db.ts (vezi season-pack-link.test.ts).
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-test-"));
const dbFile = join(dir, "test.db");
process.env.FAIKKITBOX_DB_PATH = dbFile;

vi.mock("../tmdb/tmdb.functions", () => ({ getTmdbAllSeasonsInternal: vi.fn() }));

let watch: typeof import("./show-watch");
let db: ReturnType<typeof import("../db").getDb>;
let getTmdbAllSeasonsInternal: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  db = (await import("../db")).getDb();
  if (db.location() !== dbFile) {
    throw new Error(`Testul a deschis altă bază decât cea temporară: ${db.location()}`);
  }
  watch = await import("./show-watch");
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

function show(tmdbId: number): number {
  return Number(
    db
      .prepare(`INSERT INTO media (media_type, title, tmdb_id) VALUES ('tv_show', 'S', ?)`)
      .run(tmdbId).lastInsertRowid,
  );
}

function episode(parentId: number, ep: number): number {
  return Number(
    db
      .prepare(
        `INSERT INTO media (media_type, parent_id, title, season, episode)
         VALUES ('episode', ?, 'S', 2, ?)`,
      )
      .run(parentId, ep).lastInsertRowid,
  );
}

const titleOf = (id: number) =>
  (db.prepare("SELECT episode_title FROM media WHERE id = ?").get(id) as { episode_title: string })
    .episode_title;

describe("fillMissingEpisodeTitles", () => {
  it("cu parentId completează doar episoadele acelui serial", async () => {
    const mobland = show(247718);
    const other = show(1);
    const e2 = episode(mobland, 2);
    const foreign = episode(other, 1);
    getTmdbAllSeasonsInternal.mockResolvedValue([
      { seasonNumber: 2, episodes: [{ episodeNum: 2, title: "Song 2", airDate: "2026-09-25" }] },
    ]);

    await watch.fillMissingEpisodeTitles({ parentId: mobland });

    expect(titleOf(e2)).toBe("Song 2");
    expect(titleOf(foreign)).toBeNull();
    expect(getTmdbAllSeasonsInternal).toHaveBeenCalledTimes(1);
    expect(getTmdbAllSeasonsInternal).toHaveBeenCalledWith(247718, [2]);
  });

  it("fără parentId le ia pe toate, ca plugin-ul", async () => {
    const a = episode(show(10), 1);
    const b = episode(show(20), 1);
    getTmdbAllSeasonsInternal.mockResolvedValue([
      { seasonNumber: 2, episodes: [{ episodeNum: 1, title: "Pilot", airDate: "2026-01-01" }] },
    ]);

    await watch.fillMissingEpisodeTitles();

    expect([titleOf(a), titleOf(b)]).toEqual(["Pilot", "Pilot"]);
  });
});
