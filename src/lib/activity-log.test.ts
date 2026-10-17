import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Citirea jurnalului pe bucăți (doar intrările noi), pe o bază SQLite reală și
// temporară. Calea bazei se setează ÎNAINTE de orice import al lui db.ts.
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-test-"));
const dbFile = join(dir, "test.db");
process.env.FAIKKITBOX_DB_PATH = dbFile;

vi.mock("./notifications/push", () => ({ sendPushToAll: vi.fn() }));

let log: typeof import("./activity-log");
let db: ReturnType<typeof import("./db").getDb>;

beforeAll(async () => {
  db = (await import("./db")).getDb();
  if (db.location() !== dbFile) {
    throw new Error(`Testul a deschis altă bază decât cea temporară: ${db.location()}`);
  }
  log = await import("./activity-log");
  db.exec("DELETE FROM activity");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const insert = (id: string, timestamp: string) =>
  db
    .prepare("INSERT INTO activity (id, timestamp, type, message) VALUES (?, ?, 'server_start', ?)")
    .run(id, timestamp, id);

describe("readActivityLog", () => {
  it("după cursor dă doar intrările scrise de atunci, inclusiv cele cu ora din trecut", async () => {
    insert("a", "2026-10-17T10:00:00.000Z");
    insert("b", "2026-10-17T11:00:00.000Z");
    const full = await log.readActivityLog();
    expect(full.entries.map((e) => e.id)).toEqual(["b", "a"]);

    insert("c", "2026-10-17T12:00:00.000Z");
    // Scrisă acum, dar datată înaintea lui „b" (ca oprirea unei vizionări).
    insert("d", "2026-10-17T10:30:00.000Z");
    const next = await log.readActivityLog(full.cursor);
    expect(next.entries.map((e) => e.id)).toEqual(["c", "d"]);
    expect(next.cursor).toBeGreaterThan(full.cursor);

    const none = await log.readActivityLog(next.cursor);
    expect(none.entries).toEqual([]);
    expect(none.cursor).toBe(next.cursor);
  });
});
