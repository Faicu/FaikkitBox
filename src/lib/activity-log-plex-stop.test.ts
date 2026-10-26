import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Bază SQLite reală și temporară — calea se setează ÎNAINTE de orice import al
// lui db.ts (vezi season-pack-link.test.ts).
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-test-"));
const dbFile = join(dir, "test.db");
process.env.FAIKKITBOX_DB_PATH = dbFile;

// Notificările push nu ies din test.
vi.mock("./notifications/push", () => ({ sendPushToAll: vi.fn() }));

type ActivityModule = typeof import("./activity-log");
let activity: ActivityModule;
let db: ReturnType<typeof import("./db").getDb>;

const session = { user: "ana", title: "Dune", viewOffsetMs: 120_000, durationMs: 9_000_000 };
const events = () =>
  (
    db
      .prepare("SELECT type FROM activity WHERE type LIKE 'plex_watch_%' ORDER BY rowid")
      .all() as Array<{ type: string }>
  ).map((r) => r.type);

beforeAll(async () => {
  db = (await import("./db")).getDb();
  if (db.location() !== dbFile) {
    throw new Error(`Testul a deschis altă bază decât cea temporară: ${db.location()}`);
  }
  activity = await import("./activity-log");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("trackPlexSessions — oprirea confirmată la două verificări", () => {
  it("o sesiune care lipsește o singură dată nu e oprită", async () => {
    await activity.trackPlexSessions([session]);
    expect(events()).toEqual(["plex_watch_start"]);

    // Plex a „pierdut-o” o clipă (derulare) — apoi reapare.
    await activity.trackPlexSessions([]);
    await activity.trackPlexSessions([session]);
    expect(events()).toEqual(["plex_watch_start"]);
  });

  it("o sesiune care lipsește de două ori la rând e oprită", async () => {
    await activity.trackPlexSessions([]);
    expect(events()).toEqual(["plex_watch_start"]);
    await activity.trackPlexSessions([]);
    expect(events()).toEqual(["plex_watch_start", "plex_watch_stop"]);
  });
});
