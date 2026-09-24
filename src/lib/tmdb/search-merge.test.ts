import { describe, it, expect } from "vitest";
import { interleaveSearchResults } from "./search-merge";

type Hit = { id: number; media_type: string; lang?: string };
const tv = (id: number, lang = "ro"): Hit => ({ id, media_type: "tv", lang });
const movie = (id: number, lang = "ro"): Hit => ({ id, media_type: "movie", lang });
const person = (id: number): Hit => ({ id, media_type: "person" });
const ids = (hits: Hit[]) => hits.map((h) => h.id);

describe("interleaveSearchResults", () => {
  // Cazul real din 24 sept. 2026: „elita" pe en-US dă doar Elita (2024), pe
  // ro-RO pune Élite (2018) primul.
  it("un titlu găsit doar în română apare primul (elita → Élite)", () => {
    const ro = [tv(76669), movie(49021), tv(310199)];
    const en = [person(1), tv(310199, "en")];

    expect(ids(interleaveSearchResults(ro, en))).toEqual([76669, 310199, 49021]);
  });

  it("primul rezultat din fiecare limbă ajunge în primele două", () => {
    const ro = [tv(1), tv(2), tv(3)];
    const en = [tv(9, "en"), tv(8, "en")];

    expect(ids(interleaveSearchResults(ro, en)).slice(0, 2)).toEqual([1, 9]);
  });

  it("fără duplicate, iar varianta păstrată e cea en-US", () => {
    const merged = interleaveSearchResults([tv(5), tv(6)], [tv(5, "en"), tv(7, "en")]);

    expect(ids(merged)).toEqual([5, 6, 7]);
    expect(merged[0].lang).toBe("en");
  });

  it("același id la film și serial nu e duplicat", () => {
    expect(ids(interleaveSearchResults([tv(5)], [movie(5, "en")]))).toEqual([5, 5]);
  });

  it("scoate persoanele", () => {
    expect(ids(interleaveSearchResults([person(1), tv(2)], [person(3)]))).toEqual([2]);
  });

  it("fără rezultate în română (cererea ro-RO a eșuat) rămâne lista en-US", () => {
    expect(ids(interleaveSearchResults([], [tv(1, "en"), movie(2, "en")]))).toEqual([1, 2]);
  });
});
