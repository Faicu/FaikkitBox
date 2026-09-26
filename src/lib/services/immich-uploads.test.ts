import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Urmărirea încărcărilor Immich, pe o bază SQLite reală și temporară, cu
// Immich simulat. Calea bazei se setează ÎNAINTE de orice import al lui db.ts
// (vezi season-pack-link.test.ts).
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-test-"));
const dbFile = join(dir, "test.db");
process.env.FAIKKITBOX_DB_PATH = dbFile;
process.env.IMMICH_URL = "http://immich.test";
process.env.IMMICH_API_KEY = "cheie";

vi.mock("./shared", async (orig) => ({
  ...(await orig<typeof import("./shared")>()),
  fetchJson: vi.fn(),
}));
vi.mock("../notifications/push", () => ({ sendPushToAll: vi.fn() }));

let uploads: typeof import("./immich-uploads");
let db: ReturnType<typeof import("../db").getDb>;
let fetchJson: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  db = (await import("../db")).getDb();
  if (db.location() !== dbFile) {
    throw new Error(`Testul a deschis altă bază decât cea temporară: ${db.location()}`);
  }
  uploads = await import("./immich-uploads");
  fetchJson = vi.mocked((await import("./shared")).fetchJson);
});

beforeEach(() => {
  db.exec("DELETE FROM immich_upload_tracker; DELETE FROM activity");
  vi.resetAllMocks();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const OWNER = "f15f3594";
let n = 0;
const asset = (type: "IMAGE" | "VIDEO", createdAt: string, extra: object = {}) => ({
  id: `a${n++}`,
  ownerId: OWNER,
  type,
  createdAt,
  ...extra,
});

// Ce „găsește” Immich la următoarea verificare.
function immichHas(items: object[]): void {
  fetchJson.mockImplementation(async (url: string) =>
    url.endsWith("/api/server/statistics")
      ? { usageByUser: [{ userId: OWNER, userName: "Andrei" }] }
      : { assets: { items, nextPage: null } },
  );
}

const journal = () =>
  db.prepare("SELECT type, message FROM activity ORDER BY timestamp").all() as Array<{
    type: string;
    message: string;
  }>;

describe("checkImmichUploads", () => {
  it("prima rulare doar notează punctul de plecare, fără istoric în jurnal", async () => {
    immichHas([asset("IMAGE", "2026-09-26T10:00:00Z")]);

    await uploads.checkImmichUploads();

    expect(fetchJson).not.toHaveBeenCalled();
    expect(journal()).toEqual([]);
  });

  it("o încărcare = o intrare, scrisă când nu mai apare nimic nou", async () => {
    await uploads.checkImmichUploads(); // punctul de plecare

    immichHas([asset("IMAGE", "2026-09-26T11:05:00Z"), asset("IMAGE", "2026-09-26T11:06:00Z")]);
    await uploads.checkImmichUploads();
    expect(journal()).toEqual([]); // încă în desfășurare

    immichHas([asset("VIDEO", "2026-09-26T11:12:00Z")]);
    await uploads.checkImmichUploads();
    expect(journal()).toEqual([]);

    immichHas([]);
    await uploads.checkImmichUploads();
    expect(journal()).toEqual([
      {
        type: "immich_upload",
        message: "Andrei a încărcat 2 fotografii și 1 videoclip între 14:05 și 14:12",
      },
    ]);
  });

  it("Immich căzut: punctul de plecare nu se mută, deci nimic nu se pierde", async () => {
    await uploads.checkImmichUploads();
    const before = db.prepare("SELECT checked_until c FROM immich_upload_tracker").get() as {
      c: string;
    };
    fetchJson.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(uploads.checkImmichUploads()).rejects.toThrow();

    const after = db.prepare("SELECT checked_until c FROM immich_upload_tracker").get() as {
      c: string;
    };
    expect(after.c).toBe(before.c);
  });
});

describe("countVisible", () => {
  it("un Live Photo e numărat o dată, ca poză", () => {
    const video = asset("VIDEO", "2026-09-26T11:00:00Z");
    const photo = asset("IMAGE", "2026-09-26T11:00:00Z", { livePhotoVideoId: video.id });

    expect(uploads.countVisible([photo, video]).get(OWNER)).toEqual({ photos: 1, videos: 0 });
  });
});

describe("buildImmichUploadMessage", () => {
  it("în același minut: „la ora”, cu „de” de la 20 în sus", () => {
    expect(
      uploads.buildImmichUploadMessage("Andrei", {
        photos: 25,
        videos: 0,
        firstAt: "2026-09-26T11:05:10Z",
        lastAt: "2026-09-26T11:05:50Z",
      }),
    ).toBe("Andrei a încărcat 25 de fotografii la ora 14:05");
  });
});
