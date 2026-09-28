import { describe, it, expect } from "vitest";
import { matchingAirstamp } from "./next-episode-airstamp";

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
