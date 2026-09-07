import { describe, it, expect } from "vitest";

import { detectTorrentQuality } from "./torrent-quality";

// Calitatea detectată aici decide ce torrent se descarcă automat pentru un
// serial urmărit (`auto_download_quality`, implicit 1080p). O detectare
// greșită nu dă eroare — aduce liniștit alt fișier decât cel cerut.
describe("detectTorrentQuality", () => {
  it("recunoaște 4K cu HDR ca etichetă separată", () => {
    expect(detectTorrentQuality("Movie.2019.2160p.HDR10.x265")).toBe("4K HDR");
    expect(detectTorrentQuality("Movie.2019.4K.DoVi.x265")).toBe("4K HDR");
  });

  it("recunoaște 4K fără HDR", () => {
    expect(detectTorrentQuality("Movie.2019.2160p.WEB-DL.x265")).toBe("4K");
  });

  it("recunoaște 1080p și 720p", () => {
    expect(detectTorrentQuality("Show.S01E01.1080p.WEB-DL")).toBe("1080p");
    expect(detectTorrentQuality("Show.S01E01.720p.HDTV")).toBe("720p");
  });

  it("cade pe SD când nu găsește nicio rezoluție cunoscută", () => {
    expect(detectTorrentQuality("Movie.1998.DVDRip.XviD")).toBe("SD");
  });

  // HDR fără 4K nu promovează lansarea: un 1080p cu HDR rămâne 1080p, altfel
  // n-ar mai fi luat de un serial urmărit la calitatea 1080p.
  it("nu promovează un 1080p HDR la 4K", () => {
    expect(detectTorrentQuality("Show.S01E01.1080p.HDR.WEB-DL")).toBe("1080p");
  });
});
