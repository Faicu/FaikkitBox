import { describe, expect, it } from "vitest";

import { extractEpisodeKey, osResultMatchesEpisode } from "./subtitle-checks";

describe("osResultMatchesEpisode", () => {
  it("folosește sezon/episod din metadatele API-ului", () => {
    expect(
      osResultMatchesEpisode({ release: "orice", seasonNumber: 1, episodeNumber: 2 }, "S01E02"),
    ).toBe(true);
    expect(
      osResultMatchesEpisode(
        { release: "Show.S01E02", seasonNumber: 1, episodeNumber: 1 },
        "S01E02",
      ),
    ).toBe(false);
  });

  it("fără metadate, cade pe SxxExx din release", () => {
    expect(osResultMatchesEpisode({ release: "Show.S01E02.1080p.WEB" }, "S01E02")).toBe(true);
    expect(osResultMatchesEpisode({ release: "Show.S01E01.1080p.WEB" }, "S01E02")).toBe(false);
  });

  it("respinge candidații fără niciun reper de episod", () => {
    expect(osResultMatchesEpisode({ release: "Show.S01.1080p.WEB" }, "S01E02")).toBe(false);
  });
});

describe("extractEpisodeKey pe release-uri subs.ro (folder + fișier)", () => {
  // Cazul real: arhiva sezonului avea doar E01, iar E02 l-a primit (2 oct 2026).
  it("ia episodul din fișier, nu sezonul din folder", () => {
    expect(
      extractEpisodeKey("S.W.A.T.Exiles.S01.WEB-DL S.W.A.T.Exiles.S01E01.1080p.WEB.H264-CAKES"),
    ).toBe("S01E01");
  });
});
