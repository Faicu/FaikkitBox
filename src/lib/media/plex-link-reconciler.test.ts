import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Bază SQLite reală și temporară — calea se setează ÎNAINTE de orice import al
// lui db.ts (vezi season-pack-link.test.ts).
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-test-"));
const dbFile = join(dir, "test.db");
process.env.FAIKKITBOX_DB_PATH = dbFile;

// Legarea propriu-zisă are testele ei (plex-link-by-hash, season-pack-link).
// Aici contează doar CE alege reconcilierul să reîncerce și cum trece peste
// erori, deci funcțiile de legare sunt simulate.
vi.mock("./media", () => ({
  resolveMediaPlexLinkByTorrentHash: vi.fn(),
  resolveSeasonPackPlexLinks: vi.fn(),
  repairLinkedMovieQuality: vi.fn(),
}));

type ReconcilerModule = typeof import("./plex-link-reconciler");
type DbModule = typeof import("../db");

let reconciler: ReconcilerModule;
let db: ReturnType<DbModule["getDb"]>;
let resolveOne: ReturnType<typeof vi.fn>;
let resolvePack: ReturnType<typeof vi.fn>;
let repairQuality: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  db = (await import("../db")).getDb();
  if (db.location() !== dbFile) {
    throw new Error(`Testul a deschis altă bază decât cea temporară: ${db.location()}`);
  }
  reconciler = await import("./plex-link-reconciler");
  const media = await import("./media");
  resolveOne = vi.mocked(media.resolveMediaPlexLinkByTorrentHash);
  resolvePack = vi.mocked(media.resolveSeasonPackPlexLinks);
  repairQuality = vi.mocked(media.repairLinkedMovieQuality);
});

beforeEach(() => {
  db.exec("DELETE FROM media");
  vi.resetAllMocks();
  resolveOne.mockResolvedValue(false);
  resolvePack.mockResolvedValue(false);
  repairQuality.mockResolvedValue(0);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function insertRow(row: {
  hash: string | null;
  completedAgo?: string | null;
  plexKey?: string | null;
}): void {
  db.prepare(
    `INSERT INTO media (media_type, title, torrent_hash, plex_rating_key, completed_at)
     VALUES ('movie', 'Dune', ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', ?) END)`,
  ).run(
    row.hash,
    row.plexKey ?? null,
    row.completedAgo === undefined ? "-1 hours" : row.completedAgo,
    row.completedAgo === undefined ? "-1 hours" : row.completedAgo,
  );
}

const triedHashes = () => resolveOne.mock.calls.map((c) => c[0]);

describe("reconcilePlexLinks", () => {
  it("reîncearcă doar ce s-a terminat recent și n-a fost legat", async () => {
    insertRow({ hash: "de-legat" });
    insertRow({ hash: "deja-legat", plexKey: "rk-1" });
    insertRow({ hash: "inca-se-descarca", completedAgo: null });
    insertRow({ hash: "prea-vechi", completedAgo: "-73 hours" });
    insertRow({ hash: null });

    const result = await reconciler.reconcilePlexLinks();

    expect(triedHashes()).toEqual(["de-legat"]);
    expect(result).toEqual({ checked: 1, linked: 0 });
  });

  it("încă reîncearcă la limita ferestrei de 72 de ore", async () => {
    insertRow({ hash: "aproape-expirat", completedAgo: "-71 hours" });

    await reconciler.reconcilePlexLinks();

    expect(triedHashes()).toEqual(["aproape-expirat"]);
  });

  it("un hash cu mai multe rânduri (pachet de sezon) e încercat o singură dată", async () => {
    insertRow({ hash: "pachet" });
    insertRow({ hash: "pachet" });
    insertRow({ hash: "pachet" });

    const result = await reconciler.reconcilePlexLinks();

    expect(triedHashes()).toEqual(["pachet"]);
    expect(result.checked).toBe(1);
  });

  it("încearcă pachetul doar când legarea obișnuită n-a reușit", async () => {
    insertRow({ hash: "film" });
    insertRow({ hash: "pachet" });
    resolveOne.mockImplementation(async (h: string) => h === "film");
    resolvePack.mockResolvedValue(true);

    const result = await reconciler.reconcilePlexLinks();

    expect(resolvePack.mock.calls.map((c) => c[0])).toEqual(["pachet"]);
    expect(result).toEqual({ checked: 2, linked: 2 });
  });

  it("o eroare la un hash nu-i oprește pe ceilalți", async () => {
    insertRow({ hash: "strica" });
    insertRow({ hash: "merge" });
    resolveOne.mockImplementation(async (h: string) => {
      if (h === "strica") throw new Error("Plex a căzut la mijloc");
      return true;
    });

    const result = await reconciler.reconcilePlexLinks();

    expect(triedHashes().sort()).toEqual(["merge", "strica"]);
    expect(result).toEqual({ checked: 2, linked: 1 });
  });

  it("o eroare la completarea calităților nu oprește legarea", async () => {
    insertRow({ hash: "de-legat" });
    repairQuality.mockRejectedValue(new Error("qBittorrent indisponibil"));

    const result = await reconciler.reconcilePlexLinks();

    expect(triedHashes()).toEqual(["de-legat"]);
    expect(result.checked).toBe(1);
  });

  it("completarea calităților rulează pe aceeași fereastră, chiar fără nimic de legat", async () => {
    const result = await reconciler.reconcilePlexLinks();

    expect(repairQuality).toHaveBeenCalledWith(72);
    expect(result).toEqual({ checked: 0, linked: 0 });
    expect(resolveOne).not.toHaveBeenCalled();
  });
});
