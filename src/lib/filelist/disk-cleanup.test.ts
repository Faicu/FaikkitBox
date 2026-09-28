import { describe, expect, it } from "vitest";

import { torrentRootPath } from "../qbit-client";
import { isInsideMediaRoot, sidecarSubtitleNames } from "./disk-cleanup";

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

describe("isInsideMediaRoot", () => {
  const roots = ["/media/ssd2tb/Filme", "/media/ssd2tb/Seriale/"];
  it("acceptă doar căi strict în interiorul bibliotecii", () => {
    expect(isInsideMediaRoot("/media/ssd2tb/Filme/Film-GRP", roots)).toBe(true);
    expect(isInsideMediaRoot("/media/ssd2tb/Seriale/Show.S01/E01.mkv", roots)).toBe(true);
    expect(isInsideMediaRoot("/media/ssd2tb/Filme", roots)).toBe(false);
    expect(isInsideMediaRoot("/media/ssd2tb/Filme/", roots)).toBe(false);
    expect(isInsideMediaRoot("/media/ssd2tb/FilmeAltele/x", roots)).toBe(false);
    expect(isInsideMediaRoot("/media/ssd2tb/Filme/../Seriale", roots)).toBe(false);
    expect(isInsideMediaRoot("/", roots)).toBe(false);
  });
});

describe("torrentRootPath", () => {
  const save = "/media/ssd2tb/Filme/";
  it("fișier unic în rădăcina bibliotecii: fișierul", () => {
    expect(torrentRootPath(save, `${save}Film-GRP.mkv`, ["Film-GRP.mkv"])).toBe(
      `${save}Film-GRP.mkv`,
    );
  });
  it("fișier unic într-un folder propriu: folderul, nu fișierul", () => {
    expect(torrentRootPath(save, `${save}Film-GRP/Film-GRP.mkv`, ["Film-GRP/Film-GRP.mkv"])).toBe(
      "/media/ssd2tb/Filme/Film-GRP",
    );
  });
  it("pachet: folderul comun", () => {
    expect(
      torrentRootPath(save, `${save}Show.S01`, ["Show.S01/E01.mkv", "Show.S01/Subs/E01.srt"]),
    ).toBe("/media/ssd2tb/Filme/Show.S01");
  });
  it("fără folder comun: content_path (refuzat apoi de gardă)", () => {
    expect(torrentRootPath(save, "/media/ssd2tb/Filme", ["Film.mkv", "Subs/Film.srt"])).toBe(
      "/media/ssd2tb/Filme",
    );
  });
});
