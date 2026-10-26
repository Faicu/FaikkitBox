import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Bază SQLite reală și temporară — calea se setează ÎNAINTE de orice import al
// lui db.ts (vezi season-pack-link.test.ts).
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-test-"));
const dbFile = join(dir, "test.db");
process.env.FAIKKITBOX_DB_PATH = dbFile;
process.env.QBIT_URL = "http://qbit.test";
process.env.QBIT_USERNAME = "test";
process.env.QBIT_PASSWORD = "test";

// qBittorrent fals: o singură cerere, cu starea fiecărui torrent.
const qbitTorrents: Array<{ hash: string; progress: number; state: string }> = [];
const qbitGet = vi.fn(async (_url: string, path: string) => {
  const wanted = new URLSearchParams(path.split("?")[1]).get("hashes")?.split("|") ?? [];
  return new Response(JSON.stringify(qbitTorrents.filter((t) => wanted.includes(t.hash))));
});
vi.mock("../qbit-client", () => ({ qbitGet }));

// Finalizarea propriu-zisă (fișiere, subtitrări, Plex) nu iese din test; o
// ținem „în curs” până o eliberăm noi. Contor propriu, nu vi.fn: configurația
// vitest golește mock-urile între teste.
let releaseFinalize: () => void = () => {};
const finalized: string[] = [];
const finalizeDownload = (t: { torrentHash: string }) => {
  finalized.push(t.torrentHash);
  return new Promise<void>((res) => {
    releaseFinalize = res;
  });
};
vi.mock("./download", async () => ({
  finalizeDownload,
  isTorrentComplete: (progress: number, state: string) => progress >= 1 && state.includes("UP"),
}));

type TrackerModule = typeof import("./download-tracker");
let tracker: TrackerModule;
let db: ReturnType<typeof import("../db").getDb>;

function insertMedia(row: { hash: string; completedAt?: string; plexKey?: string }) {
  db.prepare(
    `INSERT INTO media (media_type, title, torrent_name, torrent_hash, category,
                        completed_at, plex_rating_key, added_at)
     VALUES ('movie', ?, ?, ?, 1, ?, ?, datetime('now'))`,
  ).run(row.hash, row.hash, row.hash, row.completedAt ?? null, row.plexKey ?? null);
}

beforeAll(async () => {
  db = (await import("../db")).getDb();
  if (db.location() !== dbFile) {
    throw new Error(`Testul a deschis altă bază decât cea temporară: ${db.location()}`);
  }
  tracker = await import("./download-tracker");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("trackDownloads", () => {
  it("finalizează doar torrentele terminate, dintr-o singură cerere", async () => {
    insertMedia({ hash: "done1" });
    insertMedia({ hash: "busy1" });
    insertMedia({ hash: "gone1" }); // șters din qBittorrent
    qbitTorrents.push(
      { hash: "done1", progress: 1, state: "stalledUP" },
      { hash: "busy1", progress: 0.4, state: "downloading" },
    );

    const summary = await tracker.trackDownloads();
    expect(qbitGet).toHaveBeenCalledTimes(1);
    expect(finalized).toEqual(["done1"]);
    expect(summary).toBe("terminat: done1");
    expect(tracker.finalizingHashes().has("done1")).toBe(true);
  });

  it("nu pornește a doua finalizare cât prima e în curs", async () => {
    await tracker.trackDownloads();
    expect(finalized).toEqual(["done1"]);

    releaseFinalize();
    await new Promise((r) => setImmediate(r));
    expect(tracker.finalizingHashes().has("done1")).toBe(false);
  });

  it("fără nimic neterminat, nu întreabă qBittorrent", async () => {
    db.prepare("UPDATE media SET completed_at = datetime('now', '-3 hours')").run();
    // Terminate de peste 30 de minute: nici legarea nu mai e treaba sarcinii.
    expect(await tracker.trackDownloads()).toBeNull();
    expect(qbitGet).not.toHaveBeenCalled();
  });
});
