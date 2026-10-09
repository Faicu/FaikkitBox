import { describe, expect, it } from "vitest";

import { agreedEpisodeKey, extractEpisodeKey, osResultMatchesEpisode } from "./subtitle-checks";
import { subsRoEntryEpisodeKey, subsRoItemMatchesSeason } from "./subsro-client";

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

describe("agreedEpisodeKey", () => {
  it("toate reperele cu SxxExx trebuie să spună același episod", () => {
    expect(agreedEpisodeKey(["S02E04", "MobLand.S02E04.1080p", undefined])).toBe("S02E04");
    expect(agreedEpisodeKey(["S02E04", "MobLand.S02E01.1080p"])).toBeNull();
    expect(agreedEpisodeKey(["MobLand.S02.1080p", null])).toBeNull();
  });
});

describe("osResultMatchesEpisode — numele fișierului contează și el", () => {
  it("respinge un upload etichetat S02E04 cu fișierul altui episod", () => {
    expect(
      osResultMatchesEpisode(
        {
          release: "MobLand.S02.1080p.AMZN",
          seasonNumber: 2,
          episodeNumber: 4,
          fileName: "MobLand.S02E01.I.Wanna.Be.Your.Dog.srt",
        },
        "S02E04",
      ),
    ).toBe(false);
  });
});

describe("subsRoEntryEpisodeKey", () => {
  // Arhiva subs.ro pe care MobLand S02E02/E03 o primiseră greșit.
  const e01 = {
    release:
      "MobLand.S02.1080p.AMZN.WEB-DL.DDP5.1.H.264-playWEB MobLand.S02E01.I.Wanna.Be.Your.Dog.1080p.AMZN.WEB-DL.DDP5.1.H.264-playWEB",
    fileName: "MobLand.S02E01.I.Wanna.Be.Your.Dog.1080p.AMZN.WEB-DL.DDP5.1.H.264-playWEB",
  };

  it("episodul vine din numele fișierului", () => {
    expect(subsRoEntryEpisodeKey(e01)).toBe("S02E01");
  });

  it("folderul contează doar dacă fișierul n-are SxxExx", () => {
    expect(
      subsRoEntryEpisodeKey({ release: "Show.S01E03.1080p Episode.rum", fileName: "Episode.rum" }),
    ).toBe("S01E03");
    expect(
      subsRoEntryEpisodeKey({
        release: "Show.S01E01-E04 Show.S01E02.1080p",
        fileName: "Show.S01E02.1080p",
      }),
    ).toBe("S01E02");
  });
});

describe("subsRoItemMatchesSeason", () => {
  const it_ = (title: string) => ({
    id: 1,
    title,
    description: "",
    translator: "",
    language: "ro",
  });
  it("acceptă „Sezonul N” și „S0NE0M”", () => {
    expect(subsRoItemMatchesSeason(it_("MobLand - Sezonul 2"), 2)).toBe(true);
    expect(subsRoItemMatchesSeason(it_("MobLand S02E04"), 2)).toBe(true);
    expect(subsRoItemMatchesSeason(it_("MobLand S01E04"), 2)).toBe(false);
    expect(subsRoItemMatchesSeason(it_("MobLand (2025)"), 2)).toBe(false);
  });
});
