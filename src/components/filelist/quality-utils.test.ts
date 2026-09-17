import { describe, it, expect } from "vitest";

import { detectQuality } from "./quality-utils";
import { detectTorrentQuality } from "@/lib/media/torrent-quality";

// Numele reale care au scos la iveală problema: fișierele erau HDR, dar
// ajungeau etichetate „1080p" simplu, fiindcă marcajul HDR de 1080p nu exista.
const AVATAR_1080_HDR =
  "Avatar.Fire.and.Ash.2025.Hybrid.1080p.UHD.BluRay.DDP7.1.Atmos.DoVi.HDR.x265-HiDt";
const HOUSEMAID_1080_HDR =
  "The Housemaid 2025 Hybrid 1080p UHD BluRay DDP7.1 Atmos DV HDR10P x265-HiDt";
const PLAIN_1080 = "Some.Movie.2024.1080p.BluRay.x264-GROUP";

describe("detectQuality — 1080p HDR", () => {
  it("recunoaște marcajele HDR pe 1080p", () => {
    expect(detectQuality(AVATAR_1080_HDR).is1080pHdr).toBe(true);
    expect(detectQuality(HOUSEMAID_1080_HDR).is1080pHdr).toBe(true);
  });

  it("nu confundă un 1080p obișnuit cu unul HDR", () => {
    expect(detectQuality(PLAIN_1080).is1080pHdr).toBe(false);
    expect(detectQuality(PLAIN_1080).is1080p).toBe(true);
  });

  it("categoriile sunt exclusive, ca la 4K", () => {
    // O lansare HDR NU trebuie să apară și la „1080p": altfel alegerea
    // „1080p" ți-ar aduce un fișier HDR, care pe un TV fără HDR arată spălăcit.
    const q = detectQuality(AVATAR_1080_HDR);
    expect(q.is1080p).toBe(false);
    expect(q.is1080pHdr).toBe(true);
  });

  it("prinde Dolby Vision marcat doar „DV”", () => {
    expect(detectQuality("Film.2025.1080p.BluRay.DV.x265-GRP").is1080pHdr).toBe(true);
  });

  it("nu ia „dv” din interiorul unui cuvânt drept Dolby Vision", () => {
    expect(detectQuality("Advent.2025.1080p.WEB-DL.x264").is1080pHdr).toBe(false);
    expect(detectQuality("Advent.2025.1080p.WEB-DL.x264").is1080p).toBe(true);
  });

  it("nu atinge clasificarea 4K", () => {
    expect(detectQuality("Film.2025.2160p.HDR.WEB-DL").is4kHdr).toBe(true);
    expect(detectQuality("Film.2025.2160p.WEB-DL").is4k).toBe(true);
  });
});

describe("detectTorrentQuality — 1080p HDR", () => {
  it("dă eticheta separată pentru lansările HDR de 1080p", () => {
    expect(detectTorrentQuality(AVATAR_1080_HDR)).toBe("1080p HDR");
    expect(detectTorrentQuality(HOUSEMAID_1080_HDR)).toBe("1080p HDR");
  });

  it("păstrează etichetele existente neschimbate", () => {
    expect(detectTorrentQuality(PLAIN_1080)).toBe("1080p");
    expect(detectTorrentQuality("Film.2025.2160p.HDR.WEB-DL")).toBe("4K HDR");
    expect(detectTorrentQuality("Film.2025.2160p.WEB-DL")).toBe("4K");
    expect(detectTorrentQuality("Film.2025.720p.WEB")).toBe("720p");
    expect(detectTorrentQuality("Film.2025.DVDRip")).toBe("SD");
  });
});
