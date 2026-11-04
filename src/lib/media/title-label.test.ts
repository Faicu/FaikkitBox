import { describe, it, expect } from "vitest";
import {
  clipKindOf,
  episodeLine,
  hasRomanianTitle,
  isLatinTitle,
  mediaLabel,
  secondaryTitle,
  watchLabel,
} from "./title-label";

describe("mediaLabel", () => {
  it("film cu an, episod, pachet", () => {
    expect(mediaLabel({ title: "Halloween", year: 2018 })).toBe("Halloween (2018)");
    expect(mediaLabel({ title: "Elita", season: 6, episode: 4 })).toBe("Elita — S06E04");
    expect(mediaLabel({ title: "Elita", season: 6, episode: 4, isSeasonPack: true })).toBe(
      "Elita — Sezonul 6",
    );
    expect(mediaLabel({ title: "Elita", season: 6, episode: null })).toBe("Elita — Sezonul 6");
  });
});

describe("secondaryTitle", () => {
  it("originalul, engleza doar la alt alfabet", () => {
    expect(secondaryTitle("Primii vampiri", "The Originals", null)).toBe("The Originals");
    expect(secondaryTitle("Hope: Atacul final", "호프", "Hope")).toBe("Hope");
    expect(secondaryTitle("Apocalipsa Z", "Apocalipsis Z", "Apocalypse Z")).toBe("Apocalipsis Z");
    expect(secondaryTitle("Verity", "Verity", null)).toBeNull();
    // Fără engleză rămâne originalul.
    expect(secondaryTitle("Hope", "호프", null)).toBe("호프");
  });

  it("isLatinTitle", () => {
    expect(isLatinTitle("Băiat de milioane")).toBe(true);
    expect(isLatinTitle("Drive – The Pretenders")).toBe(true);
    expect(isLatinTitle("ゴジラ-0.0")).toBe(false);
    expect(isLatinTitle("ग़ज़ब रात")).toBe(false);
  });
});

describe("hasRomanianTitle", () => {
  it("identic cu originalul = fără traducere, mai puțin la românești", () => {
    expect(hasRomanianTitle("Imperiul Mafiei", "MobLand", "en")).toBe(true);
    expect(hasRomanianTitle("ゴジラ-0.0", "ゴジラ-0.0", "ja")).toBe(false);
    expect(hasRomanianTitle("Băiat de milioane", "Băiat de milioane", "ro")).toBe(true);
  });
});

describe("watchLabel / episodeLine", () => {
  it("film, episod, trailer", () => {
    expect(watchLabel({ title: "Liga Dreptății", year: 2017 })).toBe("Liga Dreptății (2017)");
    expect(watchLabel({ show: "Elita", title: "Toxic", season: 5, episode: 7 })).toBe(
      "Elita — S05E07 · Toxic",
    );
    // „Episodul 9” ar repeta codul.
    expect(
      watchLabel({ show: "Insula Iubirii", title: "Episodul 9", season: 10, episode: 9 }),
    ).toBe("Insula Iubirii — S10E09");
    expect(watchLabel({ show: "Elita", title: "Toxic" })).toBe("Elita — Toxic");
    expect(watchLabel({ clip: "trailer", title: "Hokum" })).toBe("Trailer: Hokum");
    expect(watchLabel({ clip: "extra", title: "Rescue" })).toBe("Extra: Rescue");
  });

  it("episodeLine și clipKindOf", () => {
    expect(episodeLine(5, 7, "Toxic")).toBe("S05E07 · Toxic");
    expect(episodeLine(10, 9, "Episodul 9")).toBe("S10E09");
    expect(clipKindOf("clip", "trailer")).toBe("trailer");
    expect(clipKindOf("clip", "behindTheScenes")).toBe("extra");
    expect(clipKindOf("movie", undefined)).toBeNull();
  });
});
