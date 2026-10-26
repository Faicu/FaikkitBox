import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Bază SQLite reală și temporară — calea se setează ÎNAINTE de orice import al
// lui db.ts (vezi season-pack-link.test.ts).
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-test-"));
const dbFile = join(dir, "test.db");
process.env.FAIKKITBOX_DB_PATH = dbFile;

// Execuția propriu-zisă (qBittorrent, Plex, disc) nu iese din test.
vi.mock("../qbit-client", () => ({
  qbitLogin: vi.fn().mockResolvedValue("SID=x"),
  qbitTorrentRootPath: vi.fn().mockResolvedValue(null),
}));
vi.mock("../plex-refresh", () => ({
  refreshPlexLibraryAndEmptyTrash: vi.fn(),
  refreshPlexLibrariesAndEmptyTrash: vi.fn(),
}));
vi.mock("../activity-log", () => ({ logActivity: vi.fn() }));

type SchedModule = typeof import("./scheduled-delete");
type DeleteModule = typeof import("../filelist/delete-title");
type DbModule = typeof import("../db");

let sched: SchedModule;
let del: DeleteModule;
let db: ReturnType<DbModule["getDb"]>;
let logActivity: ReturnType<typeof vi.fn>;

const HOUR = 60 * 60 * 1000;
const ADDED = "2026-10-26 10:00:00";
const addedMs = new Date("2026-10-26T10:00:00Z").getTime();

beforeAll(async () => {
  db = (await import("../db")).getDb();
  if (db.location() !== dbFile) {
    throw new Error(`Testul a deschis altă bază decât cea temporară: ${db.location()}`);
  }
  sched = await import("./scheduled-delete");
  del = await import("../filelist/delete-title");
  logActivity = vi.mocked((await import("../activity-log")).logActivity);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

beforeEach(() => {
  db.exec("DELETE FROM media");
  db.exec("DELETE FROM users");
  logActivity.mockClear();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function insertRow(hash: string, opts: { episode?: number; owner?: number } = {}): number {
  return Number(
    db
      .prepare(
        `INSERT INTO media (media_type, title, season, episode, is_season_pack, torrent_hash,
                            requested_by_user_id, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        opts.episode != null ? "episode" : "movie",
        "Dune",
        opts.episode != null ? 1 : null,
        opts.episode ?? null,
        0,
        hash,
        opts.owner ?? null,
        ADDED,
      ).lastInsertRowid,
  );
}

function addUser(id: number, username: string) {
  db.prepare("INSERT INTO users (id, username, password_hash) VALUES (?, ?, 'x')").run(
    id,
    username,
  );
}

describe("deleteDelayedUntil", () => {
  it("în primele 24 h întoarce termenul — ștergerea se programează", () => {
    insertRow("h1");
    expect(sched.deleteDelayedUntil("h1", addedMs + 23 * HOUR + 59 * 60_000)).toBe(
      "2026-10-27 10:00:00",
    );
  });

  it("după 24 h și un minut întoarce null — ștergerea e instantă", () => {
    insertRow("h1");
    expect(sched.deleteDelayedUntil("h1", addedMs + 24 * HOUR + 60_000)).toBeNull();
  });
});

describe("programare și renunțare", () => {
  it("programarea se scrie pe toate rândurile torrentului (pachet de sezon)", () => {
    insertRow("pack", { episode: 1 });
    insertRow("pack", { episode: 2 });
    sched.scheduleDeletion("pack", "2026-10-27 10:00:00", 7);
    const rows = db
      .prepare("SELECT delete_scheduled_at, delete_scheduled_by FROM media WHERE torrent_hash = ?")
      .all("pack");
    expect(rows).toEqual([
      { delete_scheduled_at: "2026-10-27 10:00:00", delete_scheduled_by: 7 },
      { delete_scheduled_at: "2026-10-27 10:00:00", delete_scheduled_by: 7 },
    ]);
    // A doua cerere nu suprascrie cine a programat.
    expect(sched.scheduleDeletion("pack", "2026-10-27 10:00:00", 9).byUserId).toBe(7);
  });

  it("cine renunță devine proprietarul titlului", () => {
    insertRow("h1", { owner: 1 });
    sched.scheduleDeletion("h1", "2026-10-27 10:00:00", 1);
    expect(sched.cancelScheduledDeletion("h1", 2)).toBe(true);
    const row = db
      .prepare("SELECT delete_scheduled_at, requested_by_user_id FROM media WHERE torrent_hash = ?")
      .get("h1");
    expect(row).toEqual({ delete_scheduled_at: null, requested_by_user_id: 2 });
    expect(sched.scheduledDeletion("h1")).toBeNull();
  });

  it("renunțarea la ceva neprogramat nu schimbă proprietarul", () => {
    insertRow("h1", { owner: 1 });
    expect(sched.cancelScheduledDeletion("h1", 2)).toBe(false);
    const row = db.prepare("SELECT requested_by_user_id FROM media").get() as {
      requested_by_user_id: number;
    };
    expect(row.requested_by_user_id).toBe(1);
  });
});

describe("runDueDeletions (sarcina din Watcher)", () => {
  it("șterge doar torrentele cu termenul atins și scrie în jurnal", async () => {
    addUser(7, "ana");
    insertRow("due", { episode: 1 });
    insertRow("due", { episode: 2 });
    insertRow("later");
    insertRow("none");
    sched.scheduleDeletion("due", "2026-10-27 10:00:00", 7);
    sched.scheduleDeletion("later", "2026-10-27 12:00:00", 7);

    const done = await del.runDueDeletions(new Date("2026-10-27T10:00:30Z").getTime());

    expect(done).toBe(1);
    const left = db.prepare("SELECT DISTINCT torrent_hash AS h FROM media ORDER BY h").all();
    expect(left).toEqual([{ h: "later" }, { h: "none" }]);
    expect(logActivity).toHaveBeenCalledWith(
      "title_delete",
      "Șters la termen: Dune S01E01 (programat de ana)",
      expect.objectContaining({ torrentHash: "due", action: "deleted_scheduled" }),
    );
  });

  it("nu atinge o ștergere la care s-a renunțat", async () => {
    insertRow("h1");
    sched.scheduleDeletion("h1", "2026-10-27 10:00:00", null);
    sched.cancelScheduledDeletion("h1", 3);
    expect(await del.runDueDeletions(new Date("2026-10-28T00:00:00Z").getTime())).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM media").get()).toEqual({ n: 1 });
  });
});
