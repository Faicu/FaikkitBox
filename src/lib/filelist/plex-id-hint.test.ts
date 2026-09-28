import { describe, expect, it } from "vitest";

import { planPlexIdRenames } from "./plex-id-hint";

describe("planPlexIdRenames", () => {
  it("film dintr-un singur fișier", () => {
    expect(
      planPlexIdRenames(["Runner.2026.1080p.AMZN.WEB-DL.DD+5.1.H.264-playWEB.mkv"], "tt31349844"),
    ).toEqual([
      {
        oldPath: "Runner.2026.1080p.AMZN.WEB-DL.DD+5.1.H.264-playWEB.mkv",
        newPath: "Runner.2026.1080p.AMZN.WEB-DL.DD+5.1.H.264-playWEB {imdb-tt31349844}.mkv",
      },
    ]);
  });

  it("pachet de sezon: fiecare episod, folderul rămâne neschimbat", () => {
    const renames = planPlexIdRenames(
      [
        "Show.S01.1080p-GRP/Show.S01E01.1080p-GRP.mkv",
        "Show.S01.1080p-GRP/Show.S01E02.1080p-GRP.mkv",
        "Show.S01.1080p-GRP/Show.S01.nfo",
      ],
      "tt0903747",
    );
    expect(renames).toEqual([
      {
        oldPath: "Show.S01.1080p-GRP/Show.S01E01.1080p-GRP.mkv",
        newPath: "Show.S01.1080p-GRP/Show.S01E01.1080p-GRP {imdb-tt0903747}.mkv",
      },
      {
        oldPath: "Show.S01.1080p-GRP/Show.S01E02.1080p-GRP.mkv",
        newPath: "Show.S01.1080p-GRP/Show.S01E02.1080p-GRP {imdb-tt0903747}.mkv",
      },
    ]);
  });

  it("fișierele cu numele video-ului se mută odată cu el", () => {
    const renames = planPlexIdRenames(
      ["Dir/Film-GRP.mkv", "Dir/Film-GRP.en.srt", "Dir/Film-GRP.srt", "Dir/Subs/English.srt"],
      "tt1",
    );
    expect(renames.map((r) => r.newPath)).toEqual([
      "Dir/Film-GRP {imdb-tt1}.mkv",
      "Dir/Film-GRP {imdb-tt1}.en.srt",
      "Dir/Film-GRP {imdb-tt1}.srt",
    ]);
  });

  it("idempotent: fișierele care au deja ID-ul sunt sărite", () => {
    expect(
      planPlexIdRenames(["Film-GRP {imdb-tt1}.mkv", "Film-GRP {imdb-tt1}.ro.srt"], "tt1"),
    ).toEqual([]);
  });

  it("fără ID valid sau pentru mostre, nimic", () => {
    expect(planPlexIdRenames(["Film-GRP.mkv"], "")).toEqual([]);
    expect(planPlexIdRenames(["Film-GRP.mkv"], "12345")).toEqual([]);
    expect(planPlexIdRenames(["Dir/Sample/film-grp-sample.mkv"], "tt1")).toEqual([]);
  });
});
