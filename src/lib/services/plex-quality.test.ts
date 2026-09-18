import { describe, it, expect } from "vitest";

import {
  plexQualityFromMedia,
  plexQualitiesFromItem,
  plexMediaForPath,
  type PlexMedia,
} from "./plex-shared";

// Datele sunt cele întoarse chiar de Plex pentru „Avatar: Foc și cenușă" și
// „The Housemaid" — cazurile care au scos la iveală ambele defecte reparate:
// versiunea nepotrivită (deci calitate lipsă) și HDR-ul de 1080p neetichetat.

const V4K_HDR: PlexMedia = {
  videoResolution: "4k",
  Part: [
    {
      file: "/media/ssd2tb/Filme/Avatar.Fire.and.Ash.2025.2160p.MA.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-BYNDR/Avatar.Fire.and.Ash.2025.2160p.MA.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-BYNDR.mkv",
      Stream: [{ streamType: 1, displayTitle: "4K DoVi/HDR10", colorTrc: "smpte2084" }],
    },
  ],
};

const V1080_HDR: PlexMedia = {
  videoResolution: "1080",
  Part: [
    {
      file: "/media/ssd2tb/Filme/Avatar Fire and Ash 2025 Hybrid 1080p UHD BluRay DDP7.1 Atmos DV HDR10P x265-HiDt.mkv",
      Stream: [{ streamType: 1, displayTitle: "1080p DoVi/HDR10+", DOVIPresent: true }],
    },
  ],
};

const V1080_SDR: PlexMedia = {
  videoResolution: "1080",
  Part: [
    {
      file: "/media/ssd2tb/Filme/Some.Movie.2024.1080p.BluRay.x264-GROUP.mkv",
      Stream: [{ streamType: 1, displayTitle: "1080p (H.264)" }],
    },
  ],
};

describe("plexQualityFromMedia", () => {
  it("etichetează HDR-ul de 1080p separat", () => {
    expect(plexQualityFromMedia(V1080_HDR)).toBe("1080p HDR");
    expect(plexQualityFromMedia(V1080_SDR)).toBe("1080p");
  });

  it("păstrează etichetele de 4K", () => {
    expect(plexQualityFromMedia(V4K_HDR)).toBe("4K HDR");
    expect(
      plexQualityFromMedia({ videoResolution: "4k", Part: [{ file: "/x/Film.2160p.mkv" }] }),
    ).toBe("4K");
  });

  it("vede HDR-ul din stream chiar când numele fișierului nu-l spune", () => {
    // Cazul pentru care citim item-ul complet din Plex: „DV" în nume n-ar
    // conta, dar DOVIPresent e fără echivoc.
    const doarInStream: PlexMedia = {
      videoResolution: "1080",
      Part: [
        {
          file: "/x/Film.2025.1080p.BluRay.x265.mkv",
          Stream: [{ streamType: 1, DOVIPresent: true }],
        },
      ],
    };
    expect(plexQualityFromMedia(doarInStream)).toBe("1080p HDR");
  });

  it("întoarce null fără rezoluție", () => {
    expect(plexQualityFromMedia(undefined)).toBeNull();
    expect(plexQualityFromMedia({})).toBeNull();
  });
});

describe("plexQualitiesFromItem", () => {
  it("le dă pe toate, nu doar prima — de asta depinde ce oferă wizard-ul", () => {
    expect(plexQualitiesFromItem({ Media: [V4K_HDR, V1080_HDR] })).toEqual(["4K HDR", "1080p HDR"]);
  });

  it("elimină duplicatele și tratează item-ul gol", () => {
    expect(plexQualitiesFromItem({ Media: [V1080_SDR, V1080_SDR] })).toEqual(["1080p"]);
    expect(plexQualitiesFromItem(undefined)).toEqual([]);
  });
});

describe("plexMediaForPath", () => {
  const item = { Media: [V4K_HDR, V1080_HDR] };

  it("potrivește fișierul unic după calea exactă din qBittorrent", () => {
    const ours = plexMediaForPath(
      item,
      "/media/ssd2tb/Filme/Avatar Fire and Ash 2025 Hybrid 1080p UHD BluRay DDP7.1 Atmos DV HDR10P x265-HiDt.mkv",
      null,
    );
    expect(plexQualityFromMedia(ours)).toBe("1080p HDR");
  });

  it("potrivește torrentul-folder după prefix", () => {
    const ours = plexMediaForPath(
      item,
      "/media/ssd2tb/Filme/Avatar.Fire.and.Ash.2025.2160p.MA.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-BYNDR",
      null,
    );
    expect(plexQualityFromMedia(ours)).toBe("4K HDR");
  });

  it("nu ghicește când nu se potrivește nimic", () => {
    // Regula centrală: mai bine fără calitate decât cu a altei versiuni.
    expect(plexMediaForPath(item, "/media/ssd2tb/Filme/Alt.Film.mkv", null)).toBeUndefined();
    expect(plexMediaForPath(item, null, null)).toBeUndefined();
  });

  it("cade pe numele torrentului când qBittorrent nu mai are torrentul", () => {
    const ours = plexMediaForPath(item, null, "Avatar Fire and Ash 2025 Hybrid 1080p");
    expect(plexQualityFromMedia(ours)).toBe("1080p HDR");
  });

  it("cu o singură versiune, aia e a noastră fără nicio potrivire", () => {
    expect(plexMediaForPath({ Media: [V1080_SDR] }, null, null)).toBe(V1080_SDR);
  });
});
