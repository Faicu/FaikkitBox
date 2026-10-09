import { describe, expect, it } from "vitest";

import { resolveBestSubtitle } from "./subtitle-sources";

const target = "MobLand.S02E03.Bonzo.Goes.to.Bitburg.1080p.AMZN.WEB-DL.DDP5.1.H.264-playWEB";
const os = (release: string, fileId = 1) => ({
  fileId,
  release,
  downloadCount: 100,
  rating: 0,
  seasonNumber: 2,
  episodeNumber: 3,
});
const subsro = (fileName: string) => ({
  release: `MobLand.S02.1080p.AMZN.WEB-DL.DDP5.1.H.264-playWEB ${fileName}`,
  fileName,
  content: Buffer.from("x"),
});

describe("resolveBestSubtitle", () => {
  it("la potrivire egală câștigă subs.ro (MobLand S02E03, 9 oct.)", async () => {
    const r = await resolveBestSubtitle(target, "S02E03", [os(target)], async () => [
      subsro(target),
    ]);
    expect(r?.winner.source).toBe("subsro");
  });

  it("OpenSubtitles câștigă doar cu un release strict mai apropiat", async () => {
    const r = await resolveBestSubtitle(target, "S02E03", [os(target)], async () => [
      subsro("MobLand.S02E03.Bonzo.Goes.to.Bitburg.2160p.ATV.WEB-DL.DD+5.1.H.265-playWEB"),
    ]);
    expect(r?.winner.source).toBe("opensubtitles");
  });

  it("candidații altui episod nu intră în comparație", async () => {
    const r = await resolveBestSubtitle(target, "S02E03", [], async () => [
      subsro("MobLand.S02E01.I.Wanna.Be.Your.Dog.1080p.AMZN.WEB-DL.DDP5.1.H.264-playWEB"),
    ]);
    expect(r).toBeNull();
  });
});
