import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FilelistTorrent } from "../filelist/types";

// Urmărirea filmelor, cu accent pe calitatea de rezervă: checkMovie pe o bază
// SQLite reală și temporară, cu TMDB, Filelist și descărcarea simulate.
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-test-"));
const dbFile = join(dir, "test.db");
process.env.FAIKKITBOX_DB_PATH = dbFile;

vi.mock("../tmdb/tmdb.functions", () => ({ getTmdbDetailsInternal: vi.fn() }));
vi.mock("../filelist/filelist-client", () => ({ checkFilelistForItemInternal: vi.fn() }));
vi.mock("../filelist/download", () => ({ downloadFilelistCore: vi.fn() }));

let watch: typeof import("./movie-watch");
let db: ReturnType<typeof import("../db").getDb>;
let filelist: ReturnType<typeof vi.fn>;
let download: ReturnType<typeof vi.fn>;
let movieId: number;

beforeAll(async () => {
  db = (await import("../db")).getDb();
  if (db.location() !== dbFile) {
    throw new Error(`Testul a deschis altă bază decât cea temporară: ${db.location()}`);
  }
  watch = await import("./movie-watch");
  filelist = vi.mocked((await import("../filelist/filelist-client")).checkFilelistForItemInternal);
  download = vi.mocked((await import("../filelist/download")).downloadFilelistCore);
});

beforeEach(async () => {
  db.exec("DELETE FROM media");
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  const tmdb = await import("../tmdb/tmdb.functions");
  vi.mocked(tmdb.getTmdbDetailsInternal).mockResolvedValue({ releaseDate: "2026-01-01" } as never);
  download.mockResolvedValue({ status: "ok" });
  movieId = Number(
    db
      .prepare(
        `INSERT INTO media (media_type, title, imdb_id, tmdb_id, auto_download,
                            auto_download_quality, auto_download_fallback_quality)
         VALUES ('movie', 'Odiseea', 'tt33764258', 1, 1, '1080p', '720p')`,
      )
      .run().lastInsertRowid,
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

let nextId = 1;
function onFilelist(...names: string[]): void {
  filelist.mockResolvedValue({
    status: "ok",
    torrents: names.map((name): FilelistTorrent => ({
      id: nextId++,
      name,
      size: 1,
      seeders: 10,
      leechers: 0,
      times_completed: 0,
      category: 4,
      categoryName: "Filme HD",
      freeleech: false,
      internal: false,
      upload_date: "2026-09-25",
      matchedByImdb: true,
    })),
  });
}

const seen = () =>
  (
    db.prepare("SELECT watch_fallback_seen s FROM media WHERE id = ?").get(movieId) as
      { s: string | null } | undefined
  )?.s;
const ageSeen = (hours: number) =>
  db
    .prepare("UPDATE media SET watch_fallback_seen = ? WHERE id = ?")
    .run(JSON.stringify({ film: new Date(Date.now() - hours * 3_600_000).toISOString() }), movieId);

describe("checkMovie — calitatea de rezervă", () => {
  it("caută pe Filelist direct, nu din cache-ul wizard-ului", async () => {
    onFilelist();
    await watch.checkMovie(movieId);
    expect(filelist.mock.calls[0][0].useCache).toBeFalsy();
  });

  it("prima dată doar rezerva: nu descarcă, notează și explică", async () => {
    onFilelist("The.Odyssey.2026.720p.WEB-DL");

    const out = await watch.checkMovie(movieId);

    expect(download).not.toHaveBeenCalled();
    expect(Object.keys(JSON.parse(seen()!))).toEqual(["film"]);
    expect(out.skipped).toContain("doar 720p");
  });

  it("„Verifică acum” curând după: încă nu descarcă", async () => {
    onFilelist("The.Odyssey.2026.720p.WEB-DL");
    await watch.checkMovie(movieId);
    ageSeen(1);

    await watch.checkMovie(movieId);

    expect(download).not.toHaveBeenCalled();
  });

  it("la o verificare de peste 3 ore: ia rezerva", async () => {
    onFilelist("The.Odyssey.2026.720p.WEB-DL");
    await watch.checkMovie(movieId);
    ageSeen(12);

    const out = await watch.checkMovie(movieId);

    expect(download.mock.calls[0][0].torrentName).toBe("The.Odyssey.2026.720p.WEB-DL");
    expect(out.downloaded).toBe("The.Odyssey.2026.720p.WEB-DL (720p, rezervă)");
  });

  it("principala apărută între timp câștigă și golește notițele", async () => {
    onFilelist("The.Odyssey.2026.720p.WEB-DL");
    await watch.checkMovie(movieId);
    ageSeen(12);
    onFilelist("The.Odyssey.2026.720p.WEB-DL", "The.Odyssey.2026.1080p.WEB-DL");

    await watch.checkMovie(movieId);

    expect(download.mock.calls[0][0].torrentName).toBe("The.Odyssey.2026.1080p.WEB-DL");
  });

  it("dacă rezerva dispare de pe Filelist, notița se golește", async () => {
    onFilelist("The.Odyssey.2026.720p.WEB-DL");
    await watch.checkMovie(movieId);
    onFilelist();

    await watch.checkMovie(movieId);

    expect(seen()).toBeNull();
  });

  it("fără rezervă setată: 720p singur nu se descarcă", async () => {
    db.prepare("UPDATE media SET auto_download_fallback_quality = NULL WHERE id = ?").run(movieId);
    onFilelist("The.Odyssey.2026.720p.WEB-DL");

    const out = await watch.checkMovie(movieId);

    expect(download).not.toHaveBeenCalled();
    expect(out.skipped).toBe("încă niciun torrent 1080p");
    expect(seen()).toBeNull();
  });

  it("o descărcare eșuată a rezervei o lasă gata pentru verificarea următoare", async () => {
    onFilelist("The.Odyssey.2026.720p.WEB-DL");
    await watch.checkMovie(movieId);
    ageSeen(12);
    download.mockResolvedValueOnce({ status: "error", error: "qBittorrent indisponibil" });
    await watch.checkMovie(movieId);

    await watch.checkMovie(movieId);

    expect(download).toHaveBeenCalledTimes(2);
  });
});
