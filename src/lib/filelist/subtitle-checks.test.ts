import { describe, expect, it } from "vitest";

import {
  agreedEpisodeKey,
  extractEpisodeKey,
  osResultMatchesEpisode,
  pickRomanianSrt,
  srtLanguageTag,
} from "./subtitle-checks";
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

  it("acceptă pachete cu mai multe sezoane (interval sau listă)", () => {
    expect(subsRoItemMatchesSeason(it_("Ted - Sezoanele 1-2"), 1)).toBe(true);
    expect(subsRoItemMatchesSeason(it_("Ted - Sezoanele 1-2"), 2)).toBe(true);
    expect(subsRoItemMatchesSeason(it_("Ted - Sezoanele 1-2"), 3)).toBe(false);
    expect(subsRoItemMatchesSeason(it_("Show - Sezonul 1–3"), 2)).toBe(true);
    expect(subsRoItemMatchesSeason(it_("Show - Sezoanele 1, 2 și 4"), 4)).toBe(true);
    expect(subsRoItemMatchesSeason(it_("Show - Sezoanele 1, 2 și 4"), 3)).toBe(false);
  });

  it("la singular, virgula nu adaugă alt sezon", () => {
    const item = { ...it_("The Rookie - Sezonul 8"), description: "Sezonul 8, 18 episoade" };
    expect(subsRoItemMatchesSeason(item, 8)).toBe(true);
    expect(subsRoItemMatchesSeason(item, 18)).toBe(false);
  });
});

describe("srtLanguageTag", () => {
  it("recunoaște limba din sufix", () => {
    expect(srtLanguageTag("Film.2014.1080p.ENG.srt")).toBe("other");
    expect(srtLanguageTag("Film.2014.1080p.ro.srt")).toBe("ro");
    expect(srtLanguageTag("Subs/2_English.srt")).toBe("other");
    expect(srtLanguageTag("Film.eng.forced.srt")).toBe("other");
  });
  it("nu ia grupul release-ului drept limbă", () => {
    expect(srtLanguageTag("Film.2014.1080p.BluRay.x264-GRP.srt")).toBeNull();
    expect(srtLanguageTag("Film.2014.1080p.srt")).toBeNull();
  });
});

describe("pickRomanianSrt", () => {
  const f = (name: string, size = 100) => ({ name, size });
  it("alege .srt-ul român nemarcat, nu pe cel ENG", () => {
    const eng = f("Film.ENG.srt");
    const plain = f("Film.srt");
    expect(
      pickRomanianSrt([
        { file: eng, romanian: false },
        { file: plain, romanian: true },
      ]),
    ).toBe(plain);
  });
  it("între mai multe românești preferă marcarea ro, apoi pe cel mai mare", () => {
    const forced = f("Film.srt", 5);
    const full = f("Film.full.srt", 90);
    const ro = f("Film.ro.srt", 50);
    expect(
      pickRomanianSrt([
        { file: forced, romanian: true },
        { file: full, romanian: true },
      ]),
    ).toBe(full);
    expect(
      pickRomanianSrt([
        { file: full, romanian: true },
        { file: ro, romanian: true },
      ]),
    ).toBe(ro);
  });
  it("null când niciunul nu e român", () => {
    expect(pickRomanianSrt([{ file: f("Film.srt"), romanian: false }])).toBeNull();
  });
});
