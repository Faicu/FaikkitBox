import { describe, expect, it } from "vitest";

import { rankSubtitleCandidates } from "./subtitle-sources";

const target = "MobLand.S02E03.Bonzo.Goes.to.Bitburg.1080p.AMZN.WEB-DL.DDP5.1.H.264-playWEB";
const os = (release: string, fileId = 1) => ({
  fileId,
  release,
  downloadCount: 100,
  rating: 0,
  seasonNumber: 2,
  episodeNumber: 3,
});
const RO = "1\n00:00:01,000 --> 00:00:02,000\nȘi ăsta e băiatul nostru, ți-am spus că știe.\n";
const EN = "1\n00:00:01,000 --> 00:00:02,000\nThat's our boy, I told you he knows.\n";
const subsro = (fileName: string, text = RO) => ({
  release: `MobLand.S02.1080p.AMZN.WEB-DL.DDP5.1.H.264-playWEB ${fileName}`,
  fileName,
  content: Buffer.from(text),
});

describe("rankSubtitleCandidates", () => {
  it("la potrivire egală câștigă subs.ro (MobLand S02E03, 9 oct.)", async () => {
    const r = await rankSubtitleCandidates(target, "S02E03", [os(target)], async () => [
      subsro(target),
    ]);
    expect(r[0]?.source).toBe("subsro");
  });

  it("OpenSubtitles câștigă doar cu un release strict mai apropiat", async () => {
    const r = await rankSubtitleCandidates(target, "S02E03", [os(target)], async () => [
      subsro("MobLand.S02E03.Bonzo.Goes.to.Bitburg.2160p.ATV.WEB-DL.DD+5.1.H.265-playWEB"),
    ]);
    expect(r[0]?.source).toBe("opensubtitles");
  });

  it("candidații altui episod nu intră în comparație", async () => {
    const r = await rankSubtitleCandidates(target, "S02E03", [], async () => [
      subsro("MobLand.S02E01.I.Wanna.Be.Your.Dog.1080p.AMZN.WEB-DL.DDP5.1.H.264-playWEB"),
    ]);
    expect(r).toEqual([]);
  });

  it("un fișier subs.ro în engleză nu câștigă, oricât de bine s-ar potrivi numele (Fall 2, „R.”)", async () => {
    const en = await rankSubtitleCandidates(target, "S02E03", [], async () => [subsro(target, EN)]);
    expect(en).toEqual([]);
    const r = await rankSubtitleCandidates(target, "S02E03", [], async () => [
      subsro(target, EN),
      subsro("MobLand.S02E03.Bonzo.Goes.to.Bitburg.2160p.ATV.WEB-DL.DD+5.1.H.265-playWEB"),
    ]);
    expect(r.map((c) => c.release)).toEqual([expect.stringContaining("2160p")]);
  });

  it("toate variantele subs.ro, cel mult 3 de pe OpenSubtitles, identicele o singură dată", async () => {
    const r = await rankSubtitleCandidates(
      target,
      "S02E03",
      [1, 2, 3, 4, 5].map((i) => os(target, i)),
      async () => [
        subsro(target),
        subsro("MobLand.S02E03.Bonzo.Goes.to.Bitburg.2160p.ATV.WEB-DL.DD+5.1.H.265-playWEB"),
        subsro(
          "MobLand.S02E03.720p.AMZN.WEB-DL",
          RO + "\n2\n00:00:03,000 --> 00:00:04,000\nAlta.\n",
        ),
      ],
    );
    expect(r.map((c) => c.source)).toEqual([
      "subsro",
      "opensubtitles",
      "opensubtitles",
      "opensubtitles",
      "subsro",
    ]);
  });
});
