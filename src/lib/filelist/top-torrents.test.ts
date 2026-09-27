import { describe, expect, it } from "vitest";

import type { TmdbBasicInfo } from "../tmdb/tmdb-title-lookup";
import { parseSeasonEpisodeFromName } from "../media/torrent-name-parse";
import { groupTopTorrents, normalizeImdbId } from "./top-torrents";
import type { FilelistTorrent } from "./types";

function torrent(name: string, imdb: string | undefined, seeders: number, leechers = 0) {
  return {
    id: Math.floor(Math.random() * 1e9),
    name,
    size: 0,
    seeders,
    leechers,
    times_completed: 0,
    category: 4,
    categoryName: "Filme HD",
    freeleech: false,
    internal: false,
    upload_date: "",
    imdb,
  } satisfies FilelistTorrent;
}

function info(id: number, mediaType: "movie" | "tv", title = `T${id}`): TmdbBasicInfo {
  return {
    id,
    mediaType,
    title,
    originalTitle: title,
    year: "2026",
    posterPath: null,
    voteAverage: null,
  };
}

const group = (ts: FilelistTorrent[], map: Record<string, TmdbBasicInfo | null>, max = 60) =>
  groupTopTorrents(ts, new Map(Object.entries(map)), parseSeasonEpisodeFromName, max);

describe("normalizeImdbId", () => {
  it("acceptă variațiile de scriere", () => {
    expect(normalizeImdbId("tt0066950")).toBe("tt0066950");
    expect(normalizeImdbId(" TT0066950 ")).toBe("tt0066950");
    expect(normalizeImdbId("0066950")).toBe("tt0066950");
    expect(normalizeImdbId("tt28504410")).toBe("tt28504410");
  });
  it("respinge ce nu arată a IMDb id", () => {
    expect(normalizeImdbId(undefined)).toBeNull();
    expect(normalizeImdbId("")).toBeNull();
    expect(normalizeImdbId("tt12")).toBeNull();
    expect(normalizeImdbId("https://imdb.com/title/tt0066950")).toBeNull();
  });
});

describe("groupTopTorrents", () => {
  it("comasează release-urile aceluiași film și însumează seederii/leecherii", () => {
    const r = group(
      [
        torrent("Il.corsaro.nero.1971.720p.BluRay.x264-playHD", "tt0066950", 81, 1),
        torrent("Il.corsaro.nero.1971.1080p.BluRay.x264-playHD", "tt0066950", 75, 3),
        torrent("Il.corsaro.nero.1971.2160p.UHD.x265", "TT0066950", 10),
      ],
      { tt0066950: info(1, "movie") },
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 1, seeders: 166, leechers: 4, episodeLabel: null });
  });

  it("comasează IMDb id-uri diferite care duc la același titlu TMDB", () => {
    const r = group(
      [torrent("Show.S01E02.1080p", "tt1000001", 10), torrent("Show.S01E02.720p", "tt1000002", 5)],
      { tt1000001: info(7, "tv"), tt1000002: info(7, "tv") },
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 7, seeders: 15, episodeLabel: "S01E02" });
  });

  it("separă episoadele și pachetul de sezon ale aceluiași serial", () => {
    const r = group(
      [
        torrent("Show.S10E07.1080p.WEB-DL", "tt1000001", 100),
        torrent("Show.s10e07.720p.WEB-DL", "tt1000001", 20),
        torrent("Show.S10E06.1080p.WEB-DL", "tt1000001", 50),
        torrent("Show.S10.1080p.WEB-DL", "tt1000001", 5),
      ],
      { tt1000001: info(7, "tv") },
    );
    expect(r.map((g) => [g.episodeLabel, g.seeders])).toEqual([
      ["S10E07", 120],
      ["S10E06", 50],
      ["S10", 5],
    ]);
    expect(new Set(r.map((g) => g.key)).size).toBe(3);
  });

  it("nu pune etichetă de episod pe un titlu pe care TMDB îl are ca film", () => {
    const r = group(
      [
        torrent("Miniserie.S01.1080p", "tt1000003", 4),
        torrent("Miniserie.S01.720p", "tt1000003", 2),
      ],
      { tt1000003: info(9, "movie") },
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ mediaType: "movie", episodeLabel: null, seeders: 6 });
  });

  it("exclude torrentele fără IMDb id sau nerezolvate pe TMDB", () => {
    const r = group(
      [torrent("A.2026.1080p", undefined, 999), torrent("B.2026.1080p", "tt1000004", 999)],
      { tt1000004: null },
    );
    expect(r).toEqual([]);
  });

  it("ordonează după seederi + leecheri", () => {
    const r = group(
      [torrent("A.2026", "tt1000001", 10, 0), torrent("B.2026", "tt1000002", 2, 20)],
      { tt1000001: info(1, "movie"), tt1000002: info(2, "movie") },
    );
    expect(r.map((g) => g.id)).toEqual([2, 1]);
  });

  it("aplică plafonul separat pe filme și seriale", () => {
    const ts = [
      torrent("S.S01E01", "tt2000001", 100),
      torrent("S.S01E02", "tt2000001", 90),
      torrent("S.S01E03", "tt2000001", 80),
      torrent("M.2026", "tt2000002", 1),
    ];
    const r = group(ts, { tt2000001: info(1, "tv"), tt2000002: info(2, "movie") }, 2);
    expect(r.filter((g) => g.mediaType === "tv")).toHaveLength(2);
    expect(r.filter((g) => g.mediaType === "movie")).toHaveLength(1);
  });
});
