import { describe, expect, it } from "vitest";

import { isExcludedTorrent, rankTorrents, type RankableTorrent } from "./torrent-rank";

const t = (name: string, extra: Partial<RankableTorrent> = {}): RankableTorrent => ({
  name,
  seeders: 20,
  ...extra,
});
const names = (list: RankableTorrent[]) => list.map((x) => x.name);

describe("excluse", () => {
  it("fără seederi", () => {
    expect(isExcludedTorrent(t("Film.2024.1080p.WEB-DL-GRP", { seeders: 0 }))).toBe(true);
  });

  it("CAM / TS / TELESYNC / HDCAM", () => {
    for (const n of [
      "Film.2024.CAM.x264-GRP",
      "Film.2024.1080p.HDCAM.x264-GRP",
      "Film.2024.TS.x264-GRP",
      "Film.2024.1080p.TELESYNC.x264-GRP",
    ]) {
      expect(isExcludedTorrent(t(n))).toBe(true);
    }
    // „DTS" nu e TS.
    expect(isExcludedTorrent(t("Film.2024.1080p.BluRay.DTS-HD.MA.5.1.x264-GRP"))).toBe(false);
  });

  it("doar Dolby Vision, dar nu DV cu HDR10", () => {
    expect(isExcludedTorrent(t("Film.2024.2160p.WEB-DL.DDP5.1.DV.H.265-GRP"))).toBe(true);
    expect(isExcludedTorrent(t("Film.2024.2160p.WEB-DL.DoVi.x265-GRP"))).toBe(true);
    expect(
      isExcludedTorrent(t("Wednesday.S02.2160p.NF.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-WADU")),
    ).toBe(false);
    expect(isExcludedTorrent(t("Film.2024.2160p.BluRay.Atmos.DV.HDR10P.x265-HiDt"))).toBe(false);
    expect(isExcludedTorrent(t("Film.2024.2160p.WEB-DL.HDR10.H.265-GRP"))).toBe(false);
  });

  it("Dolby Vision de pe Blu-ray rămâne (profil 7, bază HDR10)", () => {
    expect(
      isExcludedTorrent(t("Dune.Part.Two.2024.2160p.UHD.Remux.HEVC.DoVi.TrueHD.Atmos.7.1-playBD")),
    ).toBe(false);
  });

  it("discurile Blu-ray complete", () => {
    expect(isExcludedTorrent(t("Oppenheimer.2023.1080p.Blu-ray.AVC.DTS-HD.MA.5.1-ESiR"))).toBe(
      true,
    );
    expect(
      isExcludedTorrent(t("Oppenheimer.2023.2160p.EUR.UHD.Blu-ray.HEVC.HDR.DTS-HD.MA.5.1-ESiR")),
    ).toBe(true);
    expect(isExcludedTorrent(t("Oppenheimer.2023.1080p.Remux.AVC.DTS-HD.MA.5.1-playBD"))).toBe(
      false,
    );
    expect(isExcludedTorrent(t("Film.2024.1080p.BluRay.x264-GRP"))).toBe(false);
    expect(isExcludedTorrent(t("Film.2024.COMPLETE.BLURAY-GRP"))).toBe(true);
    // Encode-uri care scriu codecul, nu encoderul.
    expect(isExcludedTorrent(t("Film.2023.2160p.BluRay.HEVC.10bit.HDR.DDP5.1-GRP"))).toBe(false);
    expect(isExcludedTorrent(t("Film.2023.1080p.Blu-ray.AVC.H.264.DD5.1-GRP"))).toBe(false);
    expect(isExcludedTorrent(t("Film.2023.1080p.Blu-ray.AVC.BDRemux.DTS-HD-GRP"))).toBe(false);
  });

  it("discurile UHD scene, ISO/BDMV și „BluRay.AVC” fără cratimă", () => {
    for (const n of [
      "Film.2019.COMPLETE.UHD.BLURAY-GRP",
      "Film.2019.MULTi.COMPLETE.UHD.BLURAY-GRP",
      "Film.2019.1080p.BluRay.ISO-GRP",
      "Film.2019.1080p.BDMV.DTS-HD-GRP",
      "Film 2019 1080p BluRay AVC DTS-HD MA 5.1-GRP",
      "Film.2019.1080p.BluRay.VC-1.DTS-HD.MA.5.1-GRP",
    ]) {
      expect(isExcludedTorrent(t(n)), n).toBe(true);
    }
  });

  it("cuvintele din titlu nu exclud — doar cele de după an/sezon", () => {
    for (const n of [
      "Toy.Story.3D.Adventure.2024.1080p.WEB-DL.x264-GRP",
      "Cam.Girl.2018.1080p.WEB-DL.x264-GRP",
      "TS.Eliot.Wasteland.2019.1080p.BluRay.x264-GRP",
      "Show.TS.S01E02.1080p.WEB-DL.x264-GRP",
      "2012.2009.1080p.BluRay.x264-GRP",
    ]) {
      expect(isExcludedTorrent(t(n)), n).toBe(false);
    }
    for (const n of [
      "Film.2024.TS.x264-GRP",
      "Film 2024 HDCAM x264",
      "Show.S01E02.1080p.3D.HSBS.x264-GRP",
      "Film.TS.fara.an.x264-GRP",
    ]) {
      expect(isExcludedTorrent(t(n)), n).toBe(true);
    }
  });

  it("BDRemux e tot REMUX — ultimul", () => {
    const list = [t("Film.2023.1080p.BDRemux.AVC.DTS-HD-A"), t("Film.2023.1080p.BluRay.x264-B")];
    expect(names(rankTorrents(list, "movie"))[0]).toBe("Film.2023.1080p.BluRay.x264-B");
  });

  it("lansările 3D", () => {
    for (const n of [
      "Transformers.The.Last.Knight.2017.REPACK.3D.H-SBS.1080p.BluRay.x264-PSYCHD",
      "Film.2024.1080p.3D.HOU.BluRay.x264-GRP",
      "Film.2024.1080p.Half-SBS.BluRay.x264-GRP",
      "Film 2024 1080p 3D BluRay Half-OU x264-GRP",
    ]) {
      expect(isExcludedTorrent(t(n))).toBe(true);
    }
    expect(
      isExcludedTorrent(t("Transformers.The.Last.Knight.2017.1080p.BluRay.DD5.1.x264-Geek")),
    ).toBe(false);
  });

  it("rankTorrents le scoate din listă", () => {
    expect(
      names(rankTorrents([t("Film.2024.CAM-GRP"), t("Film.2024.1080p.WEB-DL-GRP")], "movie")),
    ).toEqual(["Film.2024.1080p.WEB-DL-GRP"]);
  });
});

describe("ordinea", () => {
  it("REMUX ultimul, chiar și intern", () => {
    const list = [
      t("Oppenheimer.2023.2160p.UHD.Remux.HEVC.HDR.DTS-HD.MA.5.1-playBD", { internal: true }),
      t("Oppenheimer.2023.2160p.MA.WEB-DL.DTS-HD.MA.5.1.DoVi.HDR.H.265-FLUX"),
    ];
    expect(names(rankTorrents(list, "movie"))[0]).toBe(
      "Oppenheimer.2023.2160p.MA.WEB-DL.DTS-HD.MA.5.1.DoVi.HDR.H.265-FLUX",
    );
  });

  it("internul bate sursa și seederii", () => {
    const list = [
      t("Film.2024.1080p.WEB-DL-EXT", { seeders: 300, freeleech: true }),
      t("Film.2024.1080p.WEBRip-playWEB", { internal: true, seeders: 2 }),
    ];
    expect(names(rankTorrents(list, "movie"))[0]).toBe("Film.2024.1080p.WEBRip-playWEB");
  });

  it("seriale: WEB-DL > BluRay > WEBRip > altele > REMUX", () => {
    const list = [
      t("Show.S01.1080p.BluRay.REMUX.AVC-A"),
      t("Show.S01.1080p.HDTV.x264-B"),
      t("Show.S01.1080p.WEBRip.x264-C"),
      t("Show.S01.1080p.BluRay.x264-D"),
      t("Show.S01.1080p.NF.WEB-DL.H.264-E"),
    ];
    expect(names(rankTorrents(list, "tv")).map((n) => n.slice(-1))).toEqual([
      "E",
      "D",
      "C",
      "B",
      "A",
    ]);
  });

  it("filme: WEB-DL egal cu BluRay — decid criteriile următoare", () => {
    const list = [
      t("Film.2024.1080p.WEB-DL-A", { seeders: 3 }),
      t("Film.2024.1080p.BluRay.x264-B", { seeders: 40 }),
    ];
    expect(names(rankTorrents(list, "movie"))[0]).toBe("Film.2024.1080p.BluRay.x264-B");
    // La seriale, WEB-DL câștigă chiar cu mai puțini seederi.
    expect(names(rankTorrents(list, "tv"))[0]).toBe("Film.2024.1080p.WEB-DL-A");
  });

  it("„WEB” simplu (scene) contează ca WEB-DL", () => {
    const list = [t("Show.S01E01.1080p.BluRay.x264-A"), t("Show.S01E01.1080p.WEB.h264-B")];
    expect(names(rankTorrents(list, "tv"))[0]).toBe("Show.S01E01.1080p.WEB.h264-B");
  });

  it("REPACK înaintea originalului, apoi freeleech", () => {
    const list = [
      t("Film.2024.1080p.WEB-DL-A", { freeleech: true }),
      t("Film.2024.REPACK.1080p.WEB-DL-A"),
    ];
    expect(names(rankTorrents(list, "movie"))[0]).toBe("Film.2024.REPACK.1080p.WEB-DL-A");
    const fl = [t("Film.2024.1080p.WEB-DL-A"), t("Film.2024.1080p.WEB-DL-B", { freeleech: true })];
    expect(names(rankTorrents(fl, "movie"))[0]).toBe("Film.2024.1080p.WEB-DL-B");
  });

  it("seederi: de la 5 în sus contează la fel, apoi decide data", () => {
    const list = [
      t("Film.2024.1080p.WEB-DL-OLD", { seeders: 200, upload_date: "2024-01-01 10:00:00" }),
      t("Film.2024.1080p.WEB-DL-NEW", { seeders: 5, upload_date: "2025-06-01 10:00:00" }),
      t("Film.2024.1080p.WEB-DL-FEW", { seeders: 4, upload_date: "2026-01-01 10:00:00" }),
    ];
    expect(names(rankTorrents(list, "movie"))).toEqual([
      "Film.2024.1080p.WEB-DL-NEW",
      "Film.2024.1080p.WEB-DL-OLD",
      "Film.2024.1080p.WEB-DL-FEW",
    ]);
  });

  it("nu modifică lista primită", () => {
    const list = [t("Film.2024.1080p.WEBRip-A"), t("Film.2024.1080p.WEB-DL-B")];
    rankTorrents(list, "movie");
    expect(names(list)).toEqual(["Film.2024.1080p.WEBRip-A", "Film.2024.1080p.WEB-DL-B"]);
  });
});
