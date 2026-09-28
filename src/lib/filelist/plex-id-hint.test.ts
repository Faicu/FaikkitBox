import { describe, expect, it } from "vitest";

import { planPlexIdRenames } from "./plex-id-hint";
import { pickBestByRelease, releaseNameOf } from "./release-scoring";
import { sidecarSubtitleNames } from "./sidecar-files";

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

describe("releaseNameOf / scorarea subtitrărilor", () => {
  it("scoate folderul, extensia, limba și ID-ul Plex", () => {
    expect(releaseNameOf("Show.S01/Show.S01E01.1080p.WEB-DL.H.264-playWEB {imdb-tt1}.mkv")).toBe(
      "Show.S01E01.1080p.WEB-DL.H.264-playWEB",
    );
    expect(releaseNameOf("Show.S01E01.1080p.WEB-DL.H.264-playWEB.ro.srt")).toBe(
      "Show.S01E01.1080p.WEB-DL.H.264-playWEB",
    );
    expect(releaseNameOf("Film.2026.1080p.AMZN.WEB-DL-GRP")).toBe(
      "Film.2026.1080p.AMZN.WEB-DL-GRP",
    );
  });

  it("grupul se potrivește și când ținta e un fișier redenumit", () => {
    const best = pickBestByRelease(
      ["Show.S01E01.1080p.AMZN.WEB-DL.H.264-OTHER", "Show.S01E01.1080p.AMZN.WEB-DL.H.264-playWEB"],
      (r) => r,
      () => 0,
      "Show.S01/Show.S01E01.1080p.AMZN.WEB-DL.H.264-playWEB {imdb-tt1}.mkv",
    );
    expect(best?.candidate).toBe("Show.S01E01.1080p.AMZN.WEB-DL.H.264-playWEB");
    expect(best?.matchedCriteria).toBe(best?.maxCriteria);
  });
});

describe("sidecarSubtitleNames", () => {
  it("găsește doar subtitrările fișierului video", () => {
    expect(
      sidecarSubtitleNames("Film-GRP {imdb-tt1}.mkv", [
        "Film-GRP {imdb-tt1}.mkv",
        "Film-GRP {imdb-tt1}.ro.srt",
        "Film-GRP {imdb-tt1}.srt",
        "Film-GRP {imdb-tt1}.nfo",
        "Film-GRP.Extended {imdb-tt1}.ro.srt",
        "Alt.Film-GRP.ro.srt",
      ]),
    ).toEqual(["Film-GRP {imdb-tt1}.ro.srt", "Film-GRP {imdb-tt1}.srt"]);
  });
});
