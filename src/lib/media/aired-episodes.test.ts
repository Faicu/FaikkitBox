import { describe, it, expect } from "vitest";
import { airedEpisodeKeys } from "./aired-episodes";

const TODAY = "2026-09-25";

// Schema TMDB a sezonului 2 din MobLand, pe 25 sept. 2026: E01 difuzat pe 21,
// E02 azi, E03 săptămâna viitoare. `aired` e calculat de TMDB strict
// (`airDate < azi`), ca în tmdb.functions.ts.
const schema = [
  {
    seasonNumber: 2,
    episodes: [
      { episodeNum: 1, airDate: "2026-09-21", aired: true },
      { episodeNum: 2, airDate: "2026-09-25", aired: false },
      { episodeNum: 3, airDate: "2026-10-02", aired: false },
      { episodeNum: 4, airDate: null, aired: false },
    ],
  },
];

describe("airedEpisodeKeys", () => {
  it("pentru descărcare, episodul lansat azi contează ca apărut (MobLand S02E02)", () => {
    expect(airedEpisodeKeys(schema, { includeToday: true, today: TODAY })).toEqual([
      { season: 2, episode: 1 },
      { season: 2, episode: 2 },
    ]);
  });

  it("pentru poziția de start rămâne regula strictă, ca episodul de azi să nu fie sărit", () => {
    expect(airedEpisodeKeys(schema, { includeToday: false, today: TODAY })).toEqual([
      { season: 2, episode: 1 },
    ]);
  });

  it("episoadele viitoare și cele fără dată nu apar niciodată", () => {
    const keys = airedEpisodeKeys(schema, { includeToday: true, today: TODAY });
    expect(keys.map((k) => k.episode)).not.toContain(3);
    expect(keys.map((k) => k.episode)).not.toContain(4);
  });
});
