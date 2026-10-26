import { describe, expect, it } from "vitest";

import { pickBestByRelease, rankByRelease, releaseNameOf } from "./release-scoring";

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

  it("grupul lipit de codec și MA din DTS-HD MA (A Haunting in Venice, 26 oct. 2026)", () => {
    const target = "A.Haunting.in.Venice.2023.2160p.MA.WEB-DL.DDP5.1.Atmos.DoVi.HDR.H.265-FLUX";
    const ranked = rankByRelease(
      [
        "BluRay A.Haunting.in.Venice.2023.BluRay.1080p.DTS-HD.MA.7.1.x264-MTeam",
        "WEB-DL 2 variante A.Haunting.in.Venice.2023.2160p.AMZN.WEB-DL.DDP5.1.HDR.H.265-B00TiFUL",
        "WEB-DL 2 variante A.Haunting.in.Venice.2023.2160p.MA.WEBDL.DDP5.1.Atmos.DV.HDR.H.265FLUX",
      ],
      (r) => r,
      () => 0,
      target,
    );
    expect(ranked[0].candidate).toContain("H.265FLUX");
    expect(ranked[0].matchedCriteria).toBe(5);
    const bluray = ranked.find((r) => r.candidate.includes("MTeam"));
    expect(bluray?.matchedCriteria).toBe(0);
  });
});
