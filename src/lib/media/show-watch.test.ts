import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FilelistTorrent } from "../filelist/types";

// Urmărirea serialelor, cap-coadă: checkShow pe o bază SQLite reală și
// temporară, cu TMDB, TVmaze, Filelist și descărcarea simulate. Calea bazei se
// setează ÎNAINTE de orice import al lui db.ts (vezi season-pack-link.test.ts).
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-test-"));
const dbFile = join(dir, "test.db");
process.env.FAIKKITBOX_DB_PATH = dbFile;

vi.mock("../tmdb/tmdb.functions", () => ({
  getTmdbDetailsInternal: vi.fn(),
  getTmdbAllSeasonsInternal: vi.fn(),
}));
vi.mock("../tvmaze/tvmaze.functions", () => ({ getTvmazeAirstampsInternal: vi.fn() }));
vi.mock("../filelist/filelist-client", () => ({ checkFilelistForItemInternal: vi.fn() }));
vi.mock("../filelist/download", () => ({ downloadFilelistCore: vi.fn() }));

let watch: typeof import("./show-watch");
let db: ReturnType<typeof import("../db").getDb>;
let tmdb: { details: ReturnType<typeof vi.fn>; seasons: ReturnType<typeof vi.fn> };
let filelist: ReturnType<typeof vi.fn>;
let download: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  db = (await import("../db")).getDb();
  if (db.location() !== dbFile) {
    throw new Error(`Testul a deschis altă bază decât cea temporară: ${db.location()}`);
  }
  watch = await import("./show-watch");
  const t = await import("../tmdb/tmdb.functions");
  tmdb = {
    details: vi.mocked(t.getTmdbDetailsInternal),
    seasons: vi.mocked(t.getTmdbAllSeasonsInternal),
  };
  filelist = vi.mocked((await import("../filelist/filelist-client")).checkFilelistForItemInternal);
  download = vi.mocked((await import("../filelist/download")).downloadFilelistCore);
});

const TODAY = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

let showId: number;

beforeEach(async () => {
  db.exec("DELETE FROM media");
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const tv = await import("../tvmaze/tvmaze.functions");
  vi.mocked(tv.getTvmazeAirstampsInternal).mockResolvedValue([]);
  tmdb.details.mockResolvedValue({
    title: "Imperiul Mafiei",
    originalTitle: "MobLand",
    releaseDate: "2025-03-30",
    tvStatus: "Returning Series",
    nextEpisode: null,
    overview: null,
    genres: [],
    seasons: [{ seasonNumber: 2, episodeCount: 10, airDate: "2026-09-18" }],
  });
  // Descărcarea simulată scrie rândul episodului, ca upsertMediaEntry.
  download.mockImplementation(
    async (p: { torrentName: string; media: { season: number; episode: number | null } }) => {
      db.prepare(
        `INSERT INTO media (media_type, parent_id, title, season, episode, is_season_pack,
                            torrent_name, torrent_hash)
         VALUES ('episode', ?, 'Imperiul Mafiei', ?, ?, ?, ?, ?)`,
      ).run(
        showId,
        p.media.season,
        p.media.episode,
        p.media.episode == null ? 1 : 0,
        p.torrentName,
        `hash-${p.torrentName}`,
      );
      return { status: "ok" };
    },
  );
  showId = Number(
    db
      .prepare(
        `INSERT INTO media (media_type, title, imdb_id, tmdb_id, auto_download,
                            auto_download_quality, auto_download_from)
         VALUES ('tv_show', 'Imperiul Mafiei', 'tt31510819', 247718, 1, '1080p', 'S02E01')`,
      )
      .run().lastInsertRowid,
  );
  owned(2, 1);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function owned(season: number, episode: number): number {
  return Number(
    db
      .prepare(
        `INSERT INTO media (media_type, parent_id, title, season, episode, torrent_name)
         VALUES ('episode', ?, 'Imperiul Mafiei', ?, ?, ?)`,
      )
      .run(showId, season, episode, `owned-S${season}E${episode}`).lastInsertRowid,
  );
}

// Sezonul 2 după TMDB: episodul N are data dată de `dates[N-1]`.
function tmdbSeason2(...dates: string[]): void {
  tmdb.seasons.mockResolvedValue([
    {
      seasonNumber: 2,
      episodes: dates.map((d, i) => ({
        episodeNum: i + 1,
        title: `Ep ${i + 1}`,
        airDate: d,
        aired: d < TODAY,
      })),
    },
  ]);
}

let nextId = 1;
function release(name: string): FilelistTorrent {
  return {
    id: nextId++,
    name,
    size: 1,
    seeders: 10,
    leechers: 0,
    times_completed: 0,
    category: 21,
    categoryName: "Seriale HD",
    freeleech: false,
    internal: false,
    upload_date: TODAY,
    matchedByImdb: true,
  };
}

function onFilelist(...names: string[]): void {
  filelist.mockResolvedValue({ status: "ok", torrents: names.map(release) });
}

const from = () =>
  (db.prepare("SELECT auto_download_from f FROM media WHERE id = ?").get(showId) as { f: string })
    .f;
const downloadedNames = () => download.mock.calls.map((c) => c[0].torrentName);

describe("checkShow", () => {
  it("descarcă episodul lansat azi (MobLand S02E02, 25 sept.)", async () => {
    tmdbSeason2(daysAgo(7), TODAY, inDays(7));
    onFilelist("MobLand.S02E02.Song.2.1080p.AMZN.WEB-DL", "MobLand.S02E02.Song.2.720p.AMZN.WEB-DL");

    const out = await watch.checkShow(showId);

    expect(out.downloaded).toEqual(["S02E02"]);
    expect(downloadedNames()).toEqual(["MobLand.S02E02.Song.2.1080p.AMZN.WEB-DL"]);
  });

  it("caută pe Filelist direct, nu din cache-ul wizard-ului", async () => {
    tmdbSeason2(daysAgo(7), TODAY);
    onFilelist();

    await watch.checkShow(showId);

    expect(filelist.mock.calls[0][0].useCache).toBeFalsy();
  });

  it("nu caută episoade viitoare", async () => {
    tmdbSeason2(daysAgo(7), inDays(1));
    onFilelist("MobLand.S02E02.1080p.WEB-DL");

    const out = await watch.checkShow(showId);

    expect(out.missing).toEqual([]);
    expect(download).not.toHaveBeenCalled();
  });

  it("după descărcare, poziția de start avansează la episodul adus", async () => {
    tmdbSeason2(daysAgo(7), TODAY);
    onFilelist("MobLand.S02E02.1080p.WEB-DL");

    await watch.checkShow(showId);

    expect(from()).toBe("S02E02");
  });

  it("un episod adus de urmărire, apoi șters din Bibliotecă, nu mai e redescărcat", async () => {
    tmdbSeason2(daysAgo(7), TODAY);
    onFilelist("MobLand.S02E02.1080p.WEB-DL");
    await watch.checkShow(showId);

    // Văzut și șters: rândul dispare, ca în deleteMediaEntry.
    db.prepare("DELETE FROM media WHERE parent_id = ? AND episode = 2").run(showId);
    download.mockClear();
    await watch.checkShow(showId);

    expect(download).not.toHaveBeenCalled();
  });

  it("nu sare peste un episod lipsă: E03 lipsește, E04 descărcat → poziția rămâne", async () => {
    owned(2, 2);
    db.prepare("UPDATE media SET auto_download_from = 'S02E02' WHERE id = ?").run(showId);
    tmdbSeason2(daysAgo(21), daysAgo(14), daysAgo(7), TODAY);
    onFilelist("MobLand.S02E04.1080p.WEB-DL");

    const out = await watch.checkShow(showId);

    expect(out.downloaded).toEqual(["S02E04"]);
    expect(from()).toBe("S02E02");
  });

  it("fără descărcări, poziția de start rămâne neatinsă", async () => {
    tmdbSeason2(daysAgo(7), TODAY);
    onFilelist();

    await watch.checkShow(showId);

    expect(from()).toBe("S02E01");
  });

  it("nu descarcă a doua oară un torrent deja adus", async () => {
    tmdbSeason2(daysAgo(7), TODAY);
    onFilelist("MobLand.S02E02.1080p.WEB-DL");
    await watch.checkShow(showId);
    download.mockClear();

    await watch.checkShow(showId);

    expect(download).not.toHaveBeenCalled();
  });
});

describe("checkShow — calitatea de rezervă", () => {
  const seen = () =>
    (
      db.prepare("SELECT watch_fallback_seen s FROM media WHERE id = ?").get(showId) as {
        s: string | null;
      }
    ).s;
  // Mută notițele în trecut, ca și cum prima verificare ar fi fost acum `hours` ore.
  const ageSeen = (hours: number) => {
    const obj = JSON.parse(seen()!) as Record<string, string>;
    for (const k of Object.keys(obj)) {
      obj[k] = new Date(Date.now() - hours * 3_600_000).toISOString();
    }
    db.prepare("UPDATE media SET watch_fallback_seen = ? WHERE id = ?").run(
      JSON.stringify(obj),
      showId,
    );
  };
  const withFallback = (q: string | null) =>
    db.prepare("UPDATE media SET auto_download_fallback_quality = ? WHERE id = ?").run(q, showId);

  beforeEach(() => tmdbSeason2(daysAgo(7), TODAY));

  it("fără rezervă setată, un 720p singur nu se descarcă niciodată", async () => {
    onFilelist("MobLand.S02E02.720p.WEB-DL");

    const out = await watch.checkShow(showId);

    expect(download).not.toHaveBeenCalled();
    expect(out.skipped).toBe("niciun torrent 1080p pentru episoadele lipsă");
    expect(seen()).toBeNull();
  });

  it("prima dată când găsește doar rezerva: nu descarcă, notează și explică", async () => {
    withFallback("720p");
    onFilelist("MobLand.S02E02.720p.WEB-DL");

    const out = await watch.checkShow(showId);

    expect(download).not.toHaveBeenCalled();
    expect(Object.keys(JSON.parse(seen()!))).toEqual(["S02E02"]);
    expect(out.skipped).toContain("doar 720p pentru S02E02");
  });

  it("„Verifică acum” apăsat imediat după: încă nu descarcă", async () => {
    withFallback("720p");
    onFilelist("MobLand.S02E02.720p.WEB-DL");
    await watch.checkShow(showId);
    ageSeen(0.5);

    await watch.checkShow(showId);

    expect(download).not.toHaveBeenCalled();
  });

  it("la o verificare de peste 3 ore, cu principala tot lipsă: ia rezerva", async () => {
    withFallback("720p");
    onFilelist("MobLand.S02E02.720p.WEB-DL");
    await watch.checkShow(showId);
    ageSeen(3);

    const out = await watch.checkShow(showId);

    expect(downloadedNames()).toEqual(["MobLand.S02E02.720p.WEB-DL"]);
    expect(out.downloaded).toEqual(["S02E02 (720p, rezervă)"]);
    expect(seen()).toBeNull();
  });

  it("dacă între timp a apărut principala, ia principala", async () => {
    withFallback("720p");
    onFilelist("MobLand.S02E02.720p.WEB-DL");
    await watch.checkShow(showId);
    ageSeen(3);
    onFilelist("MobLand.S02E02.720p.WEB-DL", "MobLand.S02E02.1080p.WEB-DL");

    await watch.checkShow(showId);

    expect(downloadedNames()).toEqual(["MobLand.S02E02.1080p.WEB-DL"]);
    expect(seen()).toBeNull();
  });

  it("principala găsită din prima: rezerva nici nu e notată", async () => {
    withFallback("720p");
    onFilelist("MobLand.S02E02.720p.WEB-DL", "MobLand.S02E02.1080p.WEB-DL");

    await watch.checkShow(showId);

    expect(downloadedNames()).toEqual(["MobLand.S02E02.1080p.WEB-DL"]);
    expect(seen()).toBeNull();
  });

  it("un pachet în calitatea principală acoperă episodul: rezerva lui e ignorată", async () => {
    withFallback("720p");
    onFilelist("MobLand.S02E02.720p.WEB-DL", "MobLand.S02.1080p.WEB-DL");

    await watch.checkShow(showId);

    expect(downloadedNames()).toEqual(["MobLand.S02.1080p.WEB-DL"]);
    expect(seen()).toBeNull();
  });

  it("o rezervă gata care n-a putut porni rămâne gata la verificarea următoare", async () => {
    withFallback("720p");
    onFilelist("MobLand.S02E02.720p.WEB-DL");
    await watch.checkShow(showId);
    ageSeen(3);
    download.mockResolvedValueOnce({ status: "error", error: "qBittorrent indisponibil" });
    await watch.checkShow(showId);

    // Imediat după, fără nicio așteptare nouă.
    await watch.checkShow(showId);

    expect(download).toHaveBeenCalledTimes(2);
    expect(downloadedNames()[1]).toBe("MobLand.S02E02.720p.WEB-DL");
  });

  it("schimbarea calităților golește notițele", async () => {
    withFallback("720p");
    onFilelist("MobLand.S02E02.720p.WEB-DL");
    await watch.checkShow(showId);

    await watch.setShowWatchCore({
      mediaId: showId,
      enabled: true,
      quality: "1080p",
      fallbackQuality: "1080p HDR",
    });

    expect(seen()).toBeNull();
    expect(
      (
        db
          .prepare("SELECT auto_download_fallback_quality q FROM media WHERE id = ?")
          .get(showId) as { q: string }
      ).q,
    ).toBe("1080p HDR");
  });
});
