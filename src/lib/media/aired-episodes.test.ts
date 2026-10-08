import { describe, it, expect } from "vitest";
import { airedEpisodeKeys } from "./aired-episodes";

const TODAY = "2026-09-25";

// Schema sezonului 2 din MobLand, pe 25 sept. 2026 (datele lui E03–E04
// mutate pentru test): E01 difuzat pe 21, E02 azi, E03 mâine, E04 săptămâna
// viitoare. `aired` e calculat de TMDB strict
// (`airDate < azi`), ca în tmdb.functions.ts.
const schema = [
  {
    seasonNumber: 2,
    episodes: [
      { episodeNum: 1, airDate: "2026-09-21", aired: true },
      { episodeNum: 2, airDate: "2026-09-25", aired: false },
      { episodeNum: 3, airDate: "2026-09-26", aired: false },
      { episodeNum: 4, airDate: "2026-10-02", aired: false },
      { episodeNum: 5, airDate: null, aired: false },
    ],
  },
];

describe("airedEpisodeKeys", () => {
  it("pentru descărcare, episodul lansat azi contează ca apărut (MobLand S02E02)", () => {
    expect(airedEpisodeKeys(schema, { includeUpcoming: true, today: TODAY })).toEqual([
      { season: 2, episode: 1 },
      { season: 2, episode: 2 },
      { season: 2, episode: 3 },
    ]);
  });

  it("episodul de mâine intră și el — Amazon îl publică cu o zi înainte (MobLand S02E04)", () => {
    expect(
      airedEpisodeKeys(schema, { includeUpcoming: true, today: "2026-09-30" }).map((k) => k.episode),
    ).toEqual([1, 2, 3]);
    // Trecerea peste sfârșit de lună.
    expect(
      airedEpisodeKeys(schema, { includeUpcoming: true, today: "2026-10-01" }).map((k) => k.episode),
    ).toEqual([1, 2, 3, 4]);
  });

  it("pentru poziția de start rămâne regula strictă, ca episodul de azi să nu fie sărit", () => {
    expect(airedEpisodeKeys(schema, { includeUpcoming: false, today: TODAY })).toEqual([
      { season: 2, episode: 1 },
    ]);
  });

  it("episoadele de peste mâine și cele fără dată nu apar niciodată", () => {
    const keys = airedEpisodeKeys(schema, { includeUpcoming: true, today: TODAY });
    expect(keys.map((k) => k.episode)).not.toContain(4);
    expect(keys.map((k) => k.episode)).not.toContain(5);
  });
});
