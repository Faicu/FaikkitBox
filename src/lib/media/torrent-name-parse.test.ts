import { describe, it, expect } from "vitest";
import { parseSeasonEpisodeFromName } from "./torrent-name-parse";

// De aici pornește forma rândului din `media`: `episode: null` îl face pachet
// de sezon (desfăcut apoi de resolveSeasonPackPlexLinks), un număr îl face
// episod legat direct. O citire greșită nu se mai corectează mai târziu —
// rândul rămâne cu forma greșită până la ștergere.
describe("parseSeasonEpisodeFromName", () => {
  it("citește un episod", () => {
    expect(parseSeasonEpisodeFromName("Severance.S02E05.1080p.WEB-DL.DDP5.1.H.264-NTb")).toEqual({
      season: 2,
      episode: 5,
    });
  });

  it("citește un pachet de sezon ca episode null", () => {
    expect(parseSeasonEpisodeFromName("Severance.S02.1080p.ATVP.WEB-DL.DDP5.1-FLUX")).toEqual({
      season: 2,
      episode: null,
    });
  });

  it("nu depinde de majuscule", () => {
    expect(parseSeasonEpisodeFromName("show.s01e03.720p")).toEqual({ season: 1, episode: 3 });
    expect(parseSeasonEpisodeFromName("show.s01.720p")).toEqual({ season: 1, episode: null });
  });

  it("întoarce null pentru un film", () => {
    expect(parseSeasonEpisodeFromName("Dune.Part.Two.2024.2160p.UHD.BluRay.x265-GROUP")).toBeNull();
  });

  it("nu ia un număr mai lung drept sezon", () => {
    // `(?!\d)` din regex: „S012" nu e sezonul 1.
    expect(parseSeasonEpisodeFromName("Title.S012.1080p")).toBeNull();
  });

  it("găsește marcajul și când nu e delimitat de puncte", () => {
    expect(parseSeasonEpisodeFromName("Show S03E10 1080p")).toEqual({ season: 3, episode: 10 });
  });

  // Limite cunoscute ale parserului, lăsate intenționat așa (decizia userului,
  // 24 sept. 2026): nu apar în practică — în istoric nu există niciun torrent
  // cu mai multe episoade sau sezoane, iar urmărirea nu le alege. Testele
  // rămân ca documentație. `it.fails` trece cât timp comportamentul e cel de
  // acum; dacă parserul se schimbă vreodată, testul pică și trebuie trecut pe `it`.
  it.fails("un fișier cu mai multe episoade (S01E01E02) nu e doar episodul 1", () => {
    expect(parseSeasonEpisodeFromName("Show.S01E01E02.1080p")).not.toEqual({
      season: 1,
      episode: 1,
    });
  });

  it.fails("un pachet cu mai multe sezoane (S01-S03) nu e doar sezonul 1", () => {
    expect(parseSeasonEpisodeFromName("Show.S01-S03.1080p")).not.toEqual({
      season: 1,
      episode: null,
    });
  });
});
