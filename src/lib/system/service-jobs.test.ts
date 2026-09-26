import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Acțiunile pe servicii, pe o bază SQLite reală și temporară, cu procesele
// simulate. Calea bazei se setează ÎNAINTE de orice import al lui db.ts (vezi
// media/season-pack-link.test.ts).
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-test-"));
const dbFile = join(dir, "test.db");
process.env.FAIKKITBOX_DB_PATH = dbFile;

// Fiecare proces „pornit” răspunde cu ieșirea și codul din `nextExit`.
const spawned: string[][] = [];
let nextExit = 0;
vi.mock("node:child_process", async (orig) => ({
  ...(await orig<typeof import("node:child_process")>()),
  spawn: vi.fn((cmd: string, args: string[]) => {
    spawned.push([cmd, ...args]);
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    setTimeout(() => {
      child.stdout.emit("data", Buffer.from("12 upgraded, 0 newly installed\n"));
      child.emit("close", nextExit);
    }, 1);
    return child;
  }),
}));
vi.mock("../notifications/push", () => ({ sendPushToAll: vi.fn() }));

let jobs: typeof import("./service-jobs");
let db: ReturnType<typeof import("../db").getDb>;

beforeAll(async () => {
  db = (await import("../db")).getDb();
  if (db.location() !== dbFile) {
    throw new Error(`Testul a deschis altă bază decât cea temporară: ${db.location()}`);
  }
  jobs = await import("./service-jobs");
});

beforeEach(() => {
  db.exec("DELETE FROM service_jobs; DELETE FROM activity");
  spawned.length = 0;
  nextExit = 0;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const journal = () =>
  db.prepare("SELECT type, message FROM activity").all() as Array<{
    type: string;
    message: string;
  }>;

// Gata = starea finală scrisă ȘI intrarea din jurnal (scrisă imediat după).
async function finished(id: number) {
  for (let i = 0; i < 400; i++) {
    const r = db.prepare("SELECT status FROM service_jobs WHERE id = ?").get(id) as {
      status: string;
    };
    if (r.status !== "running" && journal().length > 0) return;
    await new Promise((res) => setTimeout(res, 10));
  }
  throw new Error("acțiunea n-a terminat");
}

describe("acțiunile pe servicii", () => {
  it("update Immich: pull întâi (cu serviciul pornit), apoi up -d; jurnal scris de server", async () => {
    const id = await jobs.startServiceJob("immich", "update");
    await finished(id);

    // [sudo, -n, docker-compose, -f, fișier, ...comanda]
    expect(spawned.map((a) => a.slice(5).join(" "))).toEqual(["pull", "up -d"]);
    expect(journal()).toEqual([{ type: "service_update", message: "Immich a fost actualizat" }]);
  });

  it("update Ubuntu: fără întrebări interactive, numărul de pachete în jurnal", async () => {
    const id = await jobs.startServiceJob("ubuntu", "update");
    await finished(id);

    expect(spawned[1]).toContain("Dpkg::Options::=--force-confold");
    expect(journal()).toEqual([
      { type: "ubuntu_update", message: "Ubuntu actualizat: 12 pachete" },
    ]);
  });

  it("un pas eșuat oprește restul și apare în jurnal ca EȘUAT", async () => {
    nextExit = 1;
    const id = await jobs.startServiceJob("plex", "update");
    await finished(id);

    expect(spawned).toHaveLength(1);
    expect(journal()[0].message).toBe("Plex a fost actualizat — EȘUAT (exit 1)");
  });

  it("restart qBittorrent: golește și cache-ul DNS; tipul din jurnal e restart, nu Ubuntu", async () => {
    const id = await jobs.startServiceJob("qbit", "restart");
    await finished(id);

    expect(spawned.map((a) => a[2])).toEqual(["/usr/bin/resolvectl", "/usr/bin/systemctl"]);
    expect(journal()).toEqual([
      { type: "service_restart", message: "qBittorrent a fost repornit (cache DNS curățat)" },
    ]);
  });

  it("qBittorrent nu se actualizează niciodată", async () => {
    await expect(jobs.startServiceJob("qbit", "update")).rejects.toThrow("nu există");
  });

  it("o singură acțiune odată, pe toate serviciile", async () => {
    db.prepare(
      "INSERT INTO service_jobs (service, kind, status, started_at) VALUES ('ubuntu', 'update', 'running', ?)",
    ).run(new Date().toISOString());

    await expect(jobs.startServiceJob("plex", "restart")).rejects.toThrow(
      "Rulează deja: Update Ubuntu",
    );
  });

  it("la pornire, o acțiune rămasă în curs devine „întreruptă” și deblochează butoanele", async () => {
    db.prepare(
      "INSERT INTO service_jobs (service, kind, status, started_at) VALUES ('immich', 'update', 'running', ?)",
    ).run(new Date().toISOString());

    await jobs.markInterruptedJobs();

    expect(jobs.runningJob()).toBeNull();
    expect(journal()[0].message).toBe("Update Immich — întrerupt de o repornire a aplicației");
  });
});
