import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServiceVersion } from "./versions";

// Verificarea zilnică a actualizărilor, pe o bază SQLite reală și temporară.
// Calea bazei se setează ÎNAINTE de orice import al lui db.ts (vezi
// media/season-pack-link.test.ts).
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-test-"));
const dbFile = join(dir, "test.db");
process.env.FAIKKITBOX_DB_PATH = dbFile;

vi.mock("../notifications/push", () => ({ sendPushToAll: vi.fn() }));

let check: typeof import("./update-check");
let db: ReturnType<typeof import("../db").getDb>;

beforeAll(async () => {
  db = (await import("../db")).getDb();
  if (db.location() !== dbFile) {
    throw new Error(`Testul a deschis altă bază decât cea temporară: ${db.location()}`);
  }
  check = await import("./update-check");
});

beforeEach(() => {
  db.exec("DELETE FROM update_check; DELETE FROM activity");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const upToDate = (name: ServiceVersion["name"]): ServiceVersion => ({
  name,
  current: "1.0",
  latest: "1.0",
  upToDate: true,
});
const versions =
  (over: Partial<Record<"plex" | "immich" | "ubuntu", ServiceVersion>> = {}) =>
  async () => ({
    plex: upToDate("Plex"),
    immich: upToDate("Immich"),
    ubuntu: { name: "Ubuntu" as const, pending: 0, rebootRequired: false, upToDate: true },
    ...over,
  });

const journal = () =>
  db.prepare("SELECT type, message FROM activity").all() as Array<{
    type: string;
    message: string;
  }>;

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-09-26T10:00:00Z");

describe("checkForUpdates", () => {
  it("anunță tot ce e disponibil într-o singură intrare", async () => {
    const r = await check.checkForUpdates({
      now: T0,
      readVersions: versions({
        immich: { name: "Immich", current: "3.2.2", latest: "v3.2.3", upToDate: false },
        ubuntu: { name: "Ubuntu", pending: 12, rebootRequired: true, upToDate: false },
      }),
    });

    expect(r).toBe("notified");
    expect(journal()).toEqual([
      {
        type: "update_available",
        message:
          "Actualizări disponibile: Immich 3.2.2 → 3.2.3 · Ubuntu: 12 pachete · Ubuntu cere repornire",
      },
    ]);
  });

  it("nimic disponibil: nicio intrare", async () => {
    expect(await check.checkForUpdates({ now: T0, readVersions: versions() })).toBe("nothing");
    expect(journal()).toEqual([]);
  });

  it("o dată la 24 de ore, orice ar face repornirile între timp", async () => {
    const plexNew = versions({
      plex: { name: "Plex", current: "1.43.4", latest: "1.43.5", upToDate: false },
    });
    await check.checkForUpdates({ now: T0, readVersions: plexNew });
    expect(await check.checkForUpdates({ now: T0 + DAY - 60_000, readVersions: plexNew })).toBe(
      "skipped",
    );

    // Reamintire zilnică: tot neinstalat a doua zi → anunțat din nou.
    expect(await check.checkForUpdates({ now: T0 + DAY, readVersions: plexNew })).toBe("notified");
    expect(journal()).toHaveLength(2);
  });

  it("fără rețea (toate verificările căzute): nu se marchează, se reîncearcă", async () => {
    const down = async () => ({
      plex: { name: "Plex" as const, error: "x" },
      immich: { name: "Immich" as const, error: "x" },
      ubuntu: { name: "Ubuntu" as const, error: "x" },
    });
    expect(await check.checkForUpdates({ now: T0, readVersions: down })).toBe("failed");
    expect(await check.checkForUpdates({ now: T0 + 60_000, readVersions: versions() })).toBe(
      "nothing",
    );
  });
});

describe("summarizeUpdates", () => {
  it("un singur serviciu: notificarea duce la pagina lui", () => {
    expect(
      check.summarizeUpdates({
        immich: { name: "Immich", current: "3.2.2", latest: "3.2.3", upToDate: false },
      }).url,
    ).toBe("/immich");
  });
});
