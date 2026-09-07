import { describe, it, expect } from "vitest";

import { parseSeasonEpisodeFromName } from "./torrent-name-parse";

// Distincția episod individual ↔ pachet de sezon e cea care contează aici:
// dacă un pachet de sezon e citit ca episod, se salvează ca un singur episod
// și restul sezonului apare permanent lipsă; invers, un episod citit ca
// pachet ar bloca descărcarea celorlalte episoade din sezon.
describe("parseSeasonEpisodeFromName", () => {
  it("citește sezonul și episodul dintr-un nume de episod", () => {
    expect(parseSeasonEpisodeFromName("Show.Name.S03E07.1080p.WEB-DL.x264")).toEqual({
      season: 3,
      episode: 7,
    });
  });

  it("acceptă și varianta cu litere mici", () => {
    expect(parseSeasonEpisodeFromName("show.name.s03e07.1080p")).toEqual({
      season: 3,
      episode: 7,
    });
  });

  it("întoarce episode null pentru un pachet de sezon", () => {
    expect(parseSeasonEpisodeFromName("Show.Name.S03.COMPLETE.1080p.WEB-DL")).toEqual({
      season: 3,
      episode: null,
    });
  });

  it("nu confundă anul din titlu cu sezonul", () => {
    expect(parseSeasonEpisodeFromName("Show.Name.2024.S02E05.1080p")).toEqual({
      season: 2,
      episode: 5,
    });
  });

  it("întoarce null pentru un film, fără sezon în nume", () => {
    expect(parseSeasonEpisodeFromName("Some.Movie.2019.1080p.BluRay.x264")).toBeNull();
  });

  // Garda (?!\d) din regex-ul de pachet: fără ea, "S123" ar fi citit ca
  // sezonul 12, adică un sezon inventat dintr-un nume care nu e nici episod,
  // nici pachet.
  it("nu citește un sezon dintr-un număr mai lung de două cifre", () => {
    expect(parseSeasonEpisodeFromName("Release.S123.Group")).toBeNull();
  });

  // Episodul are prioritate față de pachet: numele conține și "S04", dar
  // prezența lui "E02" înseamnă că e un episod, nu sezonul întreg.
  it("preferă episodul când numele conține și sezon, și episod", () => {
    expect(parseSeasonEpisodeFromName("Show.S04E02.720p")).toEqual({ season: 4, episode: 2 });
  });
});
