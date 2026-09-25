import { describe, it, expect } from "vitest";
import { advancedWatchFrom, type EpisodeKey } from "./watch-position";

const e = (season: number, episode: number): EpisodeKey => ({ season, episode });
const s2 = (...eps: number[]) => eps.map((n) => e(2, n));

describe("advancedWatchFrom", () => {
  it("avansează la episodul tocmai descărcat (MobLand: E01 → E02)", () => {
    expect(
      advancedWatchFrom({
        from: e(2, 1),
        aired: s2(1, 2),
        covered: s2(1, 2),
        downloadedNow: s2(2),
      }),
    ).toEqual(e(2, 2));
  });

  it("nu sare peste un episod care încă lipsește (E03 lipsă, E04 descărcat)", () => {
    expect(
      advancedWatchFrom({
        from: e(2, 2),
        aired: s2(1, 2, 3, 4),
        covered: s2(1, 2, 4),
        downloadedNow: s2(4),
      }),
    ).toEqual(e(2, 2));
  });

  it("avansează peste mai multe episoade descărcate în aceeași verificare", () => {
    expect(
      advancedWatchFrom({
        from: e(2, 2),
        aired: s2(1, 2, 3, 4, 5),
        covered: s2(1, 2, 3, 4, 5),
        downloadedNow: s2(3, 4, 5),
      }),
    ).toEqual(e(2, 5));
  });

  it("se oprește la primul gol, chiar dacă după el a mai descărcat ceva", () => {
    expect(
      advancedWatchFrom({
        from: e(2, 2),
        aired: s2(1, 2, 3, 4, 5),
        covered: s2(1, 2, 3, 5),
        downloadedNow: s2(3, 5),
      }),
    ).toEqual(e(2, 3));
  });

  it("nu trece de ultimul episod descărcat de urmărire", () => {
    // E04 e deținut (descărcat altfel), dar urmărirea a adus doar E03.
    expect(
      advancedWatchFrom({
        from: e(2, 2),
        aired: s2(1, 2, 3, 4),
        covered: s2(1, 2, 3, 4),
        downloadedNow: s2(3),
      }),
    ).toEqual(e(2, 3));
  });

  it("trece granița dintre sezoane", () => {
    expect(
      advancedWatchFrom({
        from: e(1, 10),
        aired: [e(1, 9), e(1, 10), e(2, 1), e(2, 2)],
        covered: [e(1, 9), e(1, 10), e(2, 1), e(2, 2)],
        downloadedNow: [e(2, 1), e(2, 2)],
      }),
    ).toEqual(e(2, 2));
  });

  it("fără descărcări în verificarea asta, poziția rămâne neatinsă", () => {
    expect(
      advancedWatchFrom({ from: e(2, 1), aired: s2(1, 2), covered: s2(1, 2), downloadedNow: [] }),
    ).toEqual(e(2, 1));
  });

  it("urmărire de la început (from null): avansează de la primul episod", () => {
    expect(
      advancedWatchFrom({
        from: null,
        aired: [e(1, 1), e(1, 2), e(1, 3)],
        covered: [e(1, 1), e(1, 2)],
        downloadedNow: [e(1, 1), e(1, 2)],
      }),
    ).toEqual(e(1, 2));
  });

  it("from null și primul episod lipsă: rămâne null", () => {
    expect(
      advancedWatchFrom({
        from: null,
        aired: [e(1, 1), e(1, 2)],
        covered: [e(1, 2)],
        downloadedNow: [e(1, 2)],
      }),
    ).toBeNull();
  });
});
