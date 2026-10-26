import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Bază SQLite reală și temporară — calea se setează ÎNAINTE de orice import al
// lui db.ts (vezi season-pack-link.test.ts).
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-test-"));
const dbFile = join(dir, "test.db");
process.env.FAIKKITBOX_DB_PATH = dbFile;

// Sarcini false, controlate din test: fiecare rulare așteaptă până o
// terminăm noi, ca să putem vedea ce se întâmplă cât timp „rulează”.
const pending = new Map<string, Array<(v: string | null) => void>>();
const calls: Array<{ id: string; manual: boolean }> = [];
let clockHint = () => Date.now() + 14 * 3_600_000;
function fake(id: string, delayMs: number, everyMs: number | null) {
  return {
    id,
    label: id,
    delayMs,
    everyMs,
    controllable: everyMs !== null,
    run: ({ manual }: { manual: boolean }) => {
      calls.push({ id, manual });
      return new Promise<string | null>((res) => {
        pending.set(id, [...(pending.get(id) ?? []), res]);
      });
    },
  };
}
vi.mock("./tasks", () => ({
  WATCHER_TASKS: [
    fake("once", 0, null),
    fake("fast", 10_000, 30_000),
    fake("big", 45_000, 600_000),
    {
      id: "boom",
      label: "boom",
      delayMs: 5_000_000,
      everyMs: 60_000,
      controllable: true,
      run: () => Promise.reject(new Error("Plex nu răspunde")),
    },
    // Sarcină cu ceas propriu (ca backup-ul): își cere singură ora următoare.
    {
      id: "clock",
      label: "clock",
      delayMs: 6_000_000,
      everyMs: 3_600_000,
      controllable: true,
      run: async () => {
        calls.push({ id: "clock", manual: false });
        return { summary: null, nextAt: clockHint() };
      },
    },
  ],
}));

type RunnerModule = typeof import("./runner");
let runner: RunnerModule;
let db: ReturnType<typeof import("../db").getDb>;

const T0 = new Date("2026-10-26T12:00:00Z").getTime();
const flush = () => new Promise((r) => setImmediate(r));
const at = (ms: number) => vi.setSystemTime(T0 + ms);
function finish(id: string, summary: string | null = null) {
  const list = pending.get(id) ?? [];
  list.shift()?.(summary);
  pending.set(id, list);
}
const row = (id: string) =>
  db.prepare("SELECT * FROM watcher_tasks WHERE id = ?").get(id) as Record<string, unknown>;
const runs = (id: string) =>
  db.prepare("SELECT * FROM watcher_runs WHERE task_id = ? ORDER BY id").all(id) as Array<
    Record<string, unknown>
  >;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  db = (await import("../db")).getDb();
  if (db.location() !== dbFile) {
    throw new Error(`Testul a deschis altă bază decât cea temporară: ${db.location()}`);
  }
  runner = await import("./runner");
});

afterAll(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  calls.length = 0;
});

describe("Watcher", () => {
  it("la pornire, fiecare sarcină primește ora primei rulări", () => {
    // O rulare rămasă „în curs” de la procesul anterior.
    db.prepare("INSERT INTO watcher_tasks (id, running_since) VALUES ('fast', ?)").run(T0 - 5000);
    // Și o sarcină dispărută din registru.
    db.prepare("INSERT INTO watcher_tasks (id) VALUES ('veche')").run();
    // O oră cerută de sarcină (backup-ul, peste 14h) rămâne peste un deploy,
    // chiar dacă e mai departe decât intervalul ei (1h).
    db.prepare("INSERT INTO watcher_tasks (id, next_run_at) VALUES ('clock', ?)").run(
      T0 + 14 * 3_600_000,
    );
    at(0);
    runner.boot(Date.now());

    expect(row("once").next_run_at).toBe(T0);
    expect(row("fast").next_run_at).toBe(T0 + 10_000);
    expect(row("veche")).toBeUndefined();
    expect(row("clock").next_run_at).toBe(T0 + 14 * 3_600_000);
    // Rularea întreruptă e în istoric, ca eroare.
    expect(row("fast").running_since).toBeNull();
    expect(row("fast").last_ok).toBe(0);
    expect(runs("fast")).toHaveLength(1);
    expect(runs("fast")[0].error).toMatch(/întreruptă/);
  });

  it("pornește doar ce e scadent, iar următoarea rulare se numără de la terminare", async () => {
    at(0);
    runner.tick();
    expect(calls).toEqual([{ id: "once", manual: false }]);
    finish("once");
    await flush();
    // O singură dată: fără oră următoare.
    expect(row("once").next_run_at).toBeNull();

    at(10_000);
    runner.tick();
    expect(calls.map((c) => c.id)).toEqual(["once", "fast"]);
    // Cât rulează, tactul n-o mai pornește încă o dată.
    at(50_000);
    runner.tick();
    expect(calls.filter((c) => c.id === "fast")).toHaveLength(1);
    finish("fast");
    await flush();
    expect(row("fast").next_run_at).toBe(T0 + 50_000 + 30_000);
    // Sarcină deasă, fără nimic făcut: nu intră în istoric (doar întreruperea de dinainte).
    expect(runs("fast")).toHaveLength(1);
  });

  it("o rulare cu rezumat intră în istoric", async () => {
    // big (45s) a pornit la tactul de la 50s.
    expect(row("big").running_since).not.toBeNull();
    finish("big", "2 seriale împrospătate");
    await flush();
    expect(runs("big")).toHaveLength(1);
    expect(runs("big")[0].summary).toBe("2 seriale împrospătate");
  });

  it("pauza oprește rulările automate, dar nu și „Rulează acum”", async () => {
    db.prepare("UPDATE watcher_tasks SET paused = 1 WHERE id = 'fast'").run();
    at(400_000);
    runner.tick();
    expect(calls.map((c) => c.id)).not.toContain("fast");
    db.prepare("UPDATE watcher_tasks SET run_requested_at = ? WHERE id = 'fast'").run(Date.now());
    runner.tick();
    expect(calls).toContainEqual({ id: "fast", manual: true });
    expect(row("fast").run_requested_at).toBeNull();
    finish("fast");
    await flush();
    // Rămâne pe pauză; rularea manuală intră în istoric chiar fără rezumat.
    expect(row("fast").paused).toBe(1);
    expect(runs("fast").at(-1)?.manual).toBe(1);
  });

  it("o eroare e păstrată în stare și în istoric, iar ritmul continuă", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    at(5_000_000);
    runner.tick();
    await flush();
    expect(row("boom").last_ok).toBe(0);
    expect(row("boom").last_error).toBe("Plex nu răspunde");
    expect(row("boom").next_run_at).toBe(T0 + 5_000_000 + 60_000);
    expect(runs("boom")).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);

    // Aceeași eroare la rularea următoare: nici log, nici rând nou în istoric.
    at(5_060_000);
    runner.tick();
    await flush();
    expect(row("boom").last_finished_at).toBe(T0 + 5_060_000);
    expect(runs("boom")).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("o sarcină cu ceas propriu rulează la ora cerută, nu la interval", async () => {
    // Ora salvată înainte de pornire (14h), nu întârzierea de pornire.
    at(6_000_000);
    runner.tick();
    expect(calls.map((c) => c.id)).not.toContain("clock");
    at(50_400_000);
    runner.tick();
    await flush();
    expect(row("clock").next_run_at).toBe(T0 + 50_400_000 + 14 * 3_600_000);
    // Fără nimic de făcut: nu intră în istoric.
    expect(runs("clock")).toHaveLength(0);

    // O oră cerută în trecut nu duce la rulări în buclă: cel puțin un minut.
    clockHint = () => Date.now() - 1000;
    db.prepare("UPDATE watcher_tasks SET run_requested_at = ? WHERE id = 'clock'").run(Date.now());
    runner.tick();
    await flush();
    expect(row("clock").next_run_at).toBe(T0 + 50_400_000 + 60_000);
  });

  it("poke pornește sarcina la tactul următor", async () => {
    clockHint = () => Date.now() + 14 * 3_600_000;
    at(50_410_000);
    runner.tick();
    await flush();
    calls.length = 0;
    at(50_420_000);
    runner.tick();
    expect(calls.map((c) => c.id)).not.toContain("clock");
    runner.poke("clock");
    runner.tick();
    await flush();
    expect(calls).toContainEqual({ id: "clock", manual: false });
  });

  it("poke cu întârziere aduce rularea, dar nu o amână niciodată", async () => {
    at(50_430_000);
    // Următoarea era peste 14h; cerută peste 65s.
    runner.poke("clock", 65_000);
    expect(row("clock").next_run_at).toBe(T0 + 50_430_000 + 65_000);
    // O cerere mai târzie nu mută ora deja mai apropiată.
    runner.poke("clock", 600_000);
    expect(row("clock").next_run_at).toBe(T0 + 50_430_000 + 65_000);
    calls.length = 0;
    at(50_430_000 + 65_000);
    runner.tick();
    await flush();
    expect(calls).toContainEqual({ id: "clock", manual: false });
  });
});
