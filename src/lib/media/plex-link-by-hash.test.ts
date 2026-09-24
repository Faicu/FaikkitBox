import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlexItemLink } from "../services/plex-library";

// Bază SQLite reală și temporară — calea se setează ÎNAINTE de orice import al
// lui db.ts (vezi season-pack-link.test.ts).
const dir = mkdtempSync(join(tmpdir(), "faikkitbox-test-"));
const dbFile = join(dir, "test.db");
process.env.FAIKKITBOX_DB_PATH = dbFile;
// contentPathForTorrent cere calea din qBittorrent doar cu credențiale; le
// dăm ca să ajungă la mock, care oricum nu iese în rețea.
process.env.QBIT_USERNAME = "test";
process.env.QBIT_PASSWORD = "test";

vi.mock("../services/plex-library", () => ({
  findPlexMovieLink: vi.fn(),
  findPlexEpisodeLink: vi.fn(),
}));
vi.mock("../qbit-client", () => ({ qbitContentPath: vi.fn() }));

type MediaModule = typeof import("./media");
type DbModule = typeof import("../db");

let media: MediaModule;
let db: ReturnType<DbModule["getDb"]>;
let findPlexMovieLink: ReturnType<typeof vi.fn>;
let findPlexEpisodeLink: ReturnType<typeof vi.fn>;
let qbitContentPath: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  db = (await import("../db")).getDb();
  if (db.location() !== dbFile) {
    throw new Error(`Testul a deschis altă bază decât cea temporară: ${db.location()}`);
  }
  media = await import("./media");
  const plex = await import("../services/plex-library");
  findPlexMovieLink = vi.mocked(plex.findPlexMovieLink);
  findPlexEpisodeLink = vi.mocked(plex.findPlexEpisodeLink);
  qbitContentPath = vi.mocked((await import("../qbit-client")).qbitContentPath);
});

beforeEach(() => {
  db.exec("DELETE FROM media");
  vi.resetAllMocks();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const LINK: PlexItemLink = {
  ratingKey: "rk-42",
  quality: "2160p HDR",
  durationMs: 9_000_000,
  addedAt: 1_700_000_000,
};

function insertRow(row: {
  mediaType: "movie" | "episode";
  hash: string;
  title?: string;
  originalTitle?: string | null;
  season?: number | null;
  episode?: number | null;
  isSeasonPack?: boolean;
  plexKey?: string | null;
}): number {
  return Number(
    db
      .prepare(
        `INSERT INTO media (media_type, title, original_title, season, episode, is_season_pack,
                            plex_rating_key, torrent_name, torrent_hash, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        row.mediaType,
        row.title ?? "Dune",
        row.originalTitle ?? null,
        row.season ?? null,
        row.episode ?? null,
        row.isSeasonPack ? 1 : 0,
        row.plexKey ?? null,
        "Dune.Part.Two.2024.2160p",
        row.hash,
      ).lastInsertRowid,
  );
}

function getRow(id: number) {
  return db
    .prepare(`SELECT plex_rating_key, quality, duration_ms, plex_added_at FROM media WHERE id = ?`)
    .get(id) as Record<string, unknown>;
}

describe("resolveMediaPlexLinkByTorrentHash", () => {
  it("leagă un film și scrie ce știe Plex despre versiunea noastră", async () => {
    const id = insertRow({ mediaType: "movie", hash: "h1", originalTitle: "Dune: Part Two" });
    qbitContentPath.mockResolvedValue("/media/Dune.Part.Two.2024.2160p.mkv");
    findPlexMovieLink.mockResolvedValue(LINK);

    expect(await media.resolveMediaPlexLinkByTorrentHash("h1")).toBe(true);

    // Calea de pe disk și numele torrentului ajung la Plex — din ele se alege
    // versiunea noastră când filmul există în mai multe calități.
    expect(findPlexMovieLink).toHaveBeenCalledWith(
      "Dune",
      "Dune: Part Two",
      "/media/Dune.Part.Two.2024.2160p.mkv",
      "Dune.Part.Two.2024.2160p",
    );
    expect(getRow(id)).toEqual({
      plex_rating_key: "rk-42",
      quality: "2160p HDR",
      duration_ms: 9_000_000,
      plex_added_at: 1_700_000_000,
    });
  });

  it("fără titlu original caută tot după titlu", async () => {
    insertRow({ mediaType: "movie", hash: "h1" });
    qbitContentPath.mockResolvedValue(null);
    findPlexMovieLink.mockResolvedValue(LINK);

    await media.resolveMediaPlexLinkByTorrentHash("h1");

    expect(findPlexMovieLink).toHaveBeenCalledWith("Dune", "Dune", null, expect.anything());
  });

  it("leagă un episod după serial, sezon și episod", async () => {
    const id = insertRow({
      mediaType: "episode",
      hash: "h1",
      title: "Severance",
      season: 2,
      episode: 5,
    });
    findPlexEpisodeLink.mockResolvedValue(LINK);

    expect(await media.resolveMediaPlexLinkByTorrentHash("h1")).toBe(true);
    expect(findPlexEpisodeLink).toHaveBeenCalledWith("Severance", 2, 5);
    expect(getRow(id).plex_rating_key).toBe("rk-42");
  });

  it("dacă Plex nu-l are încă, întoarce false și lasă rândul neatins", async () => {
    const id = insertRow({ mediaType: "movie", hash: "h1" });
    findPlexMovieLink.mockResolvedValue(null);

    expect(await media.resolveMediaPlexLinkByTorrentHash("h1")).toBe(false);
    expect(getRow(id).plex_rating_key).toBeNull();
  });

  it("dacă totul e deja legat, spune «gata» fără să întrebe Plex", async () => {
    insertRow({ mediaType: "movie", hash: "h1", plexKey: "rk-1" });

    expect(await media.resolveMediaPlexLinkByTorrentHash("h1")).toBe(true);
    expect(findPlexMovieLink).not.toHaveBeenCalled();
  });

  it("un rând deja legat nu maschează rândul-pachet care încă are treabă", async () => {
    // Episodul extras deja din pachet are id-ul mai mic și e legat; dacă s-ar
    // alege el, funcția ar raporta „gata" și ar opri reîncercările pentru
    // restul pachetului.
    insertRow({ mediaType: "episode", hash: "h1", season: 2, episode: 1, plexKey: "rk-1" });
    insertRow({ mediaType: "episode", hash: "h1", season: 2, episode: null, isSeasonPack: true });

    expect(await media.resolveMediaPlexLinkByTorrentHash("h1")).toBe(false);
    // Rândul-pachet n-are episod — nu e treaba funcției ăsteia să-l lege
    // (resolveSeasonPackPlexLinks), deci nici nu întreabă Plex.
    expect(findPlexEpisodeLink).not.toHaveBeenCalled();
  });

  it("dintre mai multe rânduri pe același hash, leagă pe cel nelegat", async () => {
    const linked = insertRow({ mediaType: "movie", hash: "h1", plexKey: "rk-old" });
    const unlinked = insertRow({ mediaType: "movie", hash: "h1" });
    findPlexMovieLink.mockResolvedValue(LINK);

    expect(await media.resolveMediaPlexLinkByTorrentHash("h1")).toBe(true);
    expect(getRow(unlinked).plex_rating_key).toBe("rk-42");
    expect(getRow(linked).plex_rating_key).toBe("rk-old");
  });

  it("un hash necunoscut întoarce false", async () => {
    expect(await media.resolveMediaPlexLinkByTorrentHash("nu-exista")).toBe(false);
  });
});
