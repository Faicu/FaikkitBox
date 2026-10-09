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

  it("sursa contează mai mult decât rezoluția (The Invite, 9 oct. 2026)", () => {
    const best = pickBestByRelease(
      [
        "BluRay The.Invite.2026.1080p.BluRay.x265.10bit.EAC3.5.1-Ghost",
        "WEB-DL The.Invite.2026.2160p.4K.WEB-DL.x265.10bit.AAC5.1",
      ],
      (r) => r,
      () => 0,
      "The.Invite.2026.1080p.AMZN.WEB-DL.DDP5.1.H.264-BYNDR.mkv",
    );
    expect(best?.candidate).toContain("WEB-DL The.Invite");
  });
});
