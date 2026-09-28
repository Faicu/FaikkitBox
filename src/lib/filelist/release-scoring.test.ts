import { describe, expect, it } from "vitest";

import { pickBestByRelease, releaseNameOf } from "./release-scoring";

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
    expect(releaseNameOf("Film.2026.1080p.WEB.srt")).toBe("Film.2026.1080p.WEB");
    expect(releaseNameOf("Film.2026.1080p.WEB-GRP / Film.2026.720p.WEB-GRP")).toBe(
      "Film.2026.1080p.WEB-GRP / Film.2026.720p.WEB-GRP",
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
