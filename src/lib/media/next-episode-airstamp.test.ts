import { describe, it, expect } from "vitest";
import { matchingAirstamp, pickAirstamp } from "./next-episode-airstamp";

describe("matchingAirstamp", () => {
  it("respinge ora altui episod (Insula Iubirii: TVmaze 26 sept., TMDB 3 oct.)", () => {
    expect(matchingAirstamp("2026-09-26T17:30:00+00:00", "2026-10-03")).toBeNull();
  });

  it("păstrează ora din aceeași zi", () => {
    const s = "2026-10-03T17:30:00+00:00";
    expect(matchingAirstamp(s, "2026-10-03")).toBe(s);
  });

  it("tolerează o zi, pentru fusul orar (seara în SUA = a doua zi în UTC)", () => {
    const s = "2026-10-04T01:00:00+00:00";
    expect(matchingAirstamp(s, "2026-10-03")).toBe(s);
    const before = "2026-10-02T22:00:00+00:00";
    expect(matchingAirstamp(before, "2026-10-03")).toBe(before);
  });

  it("respinge la două zile distanță", () => {
    expect(matchingAirstamp("2026-10-05T01:00:00+00:00", "2026-10-03")).toBeNull();
  });

  it("fără dată TMDB, ora TVmaze rămâne", () => {
    const s = "2026-10-03T17:30:00+00:00";
    expect(matchingAirstamp(s, null)).toBe(s);
  });

  it("fără oră TVmaze, nimic", () => {
    expect(matchingAirstamp(null, "2026-10-03")).toBeNull();
  });
});

describe("pickAirstamp", () => {
  const stamps = [
    { seasonNumber: 10, episodeNum: 18, airstamp: "2026-10-31T18:30:00+00:00" },
    { seasonNumber: 10, episodeNum: 19, airstamp: "2026-11-06T18:30:00+00:00" },
    { seasonNumber: 10, episodeNum: 20, airstamp: "2026-11-07T18:30:00+00:00" },
  ];

  it("numerotare diferită: ia episodul după dată (TMDB S10E18 = TVmaze S10E20)", () => {
    expect(
      pickAirstamp(stamps, { seasonNumber: 10, episodeNumber: 18, airDate: "2026-11-07" }),
    ).toBe("2026-11-07T18:30:00+00:00");
  });

  it("același număr și dată: neschimbat", () => {
    expect(
      pickAirstamp(stamps, { seasonNumber: 10, episodeNumber: 19, airDate: "2026-11-06" }),
    ).toBe("2026-11-06T18:30:00+00:00");
  });

  it("alt sezon sau nicio dată apropiată: nimic", () => {
    expect(
      pickAirstamp(stamps, { seasonNumber: 9, episodeNumber: 18, airDate: "2026-11-07" }),
    ).toBeNull();
    expect(
      pickAirstamp(stamps, { seasonNumber: 10, episodeNumber: 18, airDate: "2026-12-01" }),
    ).toBeNull();
  });
});
