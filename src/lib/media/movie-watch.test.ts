import { describe, it, expect } from "vitest";

import { hasReleased, pickCandidates } from "./movie-watch";
import { detectTorrentQuality } from "./torrent-quality";

// Poarta pe data de lansare economisește căutări sigur inutile, dar dacă e
// prea strictă blochează urmărirea la nesfârșit — de-aia lipsa datei și o dată
// invalidă trebuie să lase căutarea să meargă mai departe.
describe("hasReleased", () => {
  const now = new Date("2026-09-07T12:00:00");

  it("consideră lansat un film cu data în trecut", () => {
    expect(hasReleased("2025-12-25", now)).toBe(true);
  });

  it("consideră nelansat un film cu data în viitor", () => {
    expect(hasReleased("2026-12-25", now)).toBe(false);
  });

  // Ziua premierei se caută: un film lansat azi poate apărea azi.
  it("consideră lansat un film care apare chiar azi", () => {
    expect(hasReleased("2026-09-07", now)).toBe(true);
  });

  // O dată lipsă nu e o dovadă că filmul n-a apărut. A refuza căutarea ar
  // însemna o urmărire care nu caută niciodată — cel mai prost eșec posibil,
  // fiindcă e tăcut.
  it("caută oricum când TMDB n-are data de lansare", () => {
    expect(hasReleased(null, now)).toBe(true);
  });

  it("caută oricum când data e nefolosibilă", () => {
    expect(hasReleased("necunoscută", now)).toBe(true);
  });
});

// Torrentele de test seamănă cu ce întoarce Filelist: nume de lansare reale,
// seederi, și steagul de potrivire pe IMDb.
function t(name: string, seeders: number, matchedByImdb = true) {
  return { name, seeders, matchedByImdb };
}

describe("pickCandidates", () => {
  it("păstrează doar calitatea cerută exact", () => {
    const found = pickCandidates(
      [
        t("The.Odyssey.2026.2160p.WEB-DL.x265", 50),
        t("The.Odyssey.2026.1080p.WEB-DL.x264", 10),
        t("The.Odyssey.2026.720p.HDTV.x264", 99),
      ],
      "1080p",
      detectTorrentQuality,
    );
    expect(found.map((x) => x.name)).toEqual(["The.Odyssey.2026.1080p.WEB-DL.x264"]);
  });

  it("sortează descrescător după seederi", () => {
    const found = pickCandidates(
      [t("Film.1080p.A", 5), t("Film.1080p.B", 80), t("Film.1080p.C", 30)],
      "1080p",
      detectTorrentQuality,
    );
    expect(found.map((x) => x.seeders)).toEqual([80, 30, 5]);
  });

  // Căutarea pe Filelist e strict pe IMDb; un rezultat nepotrivit așa n-are ce
  // căuta într-o descărcare automată, unde nimeni nu confirmă manual.
  it("ignoră torrentele nepotrivite pe IMDb", () => {
    const found = pickCandidates(
      [t("Alt.Film.1080p", 100, false), t("The.Odyssey.2026.1080p", 1)],
      "1080p",
      detectTorrentQuality,
    );
    expect(found.map((x) => x.name)).toEqual(["The.Odyssey.2026.1080p"]);
  });

  // Cazul normal pentru un film abia urmărit: există lansări, dar niciuna la
  // calitatea cerută. Rezultatul gol e ce ține urmărirea în viață.
  it("întoarce gol când nimic nu e la calitatea cerută", () => {
    const found = pickCandidates(
      [t("The.Odyssey.2026.720p.CAM", 3), t("The.Odyssey.2026.DVDRip.XviD", 7)],
      "1080p",
      detectTorrentQuality,
    );
    expect(found).toEqual([]);
  });

  it("întoarce gol când Filelist n-a găsit nimic", () => {
    expect(pickCandidates([], "1080p", detectTorrentQuality)).toEqual([]);
  });

  // 4K și 4K HDR sunt etichete distincte: cine a cerut 4K simplu nu trebuie să
  // primească varianta HDR, care e alt fișier și altă mărime.
  it("nu confundă 4K cu 4K HDR", () => {
    const torrents = [t("Film.2160p.HDR10.x265", 40), t("Film.2160p.x265", 20)];
    expect(pickCandidates(torrents, "4K", detectTorrentQuality).map((x) => x.name)).toEqual([
      "Film.2160p.x265",
    ]);
    expect(pickCandidates(torrents, "4K HDR", detectTorrentQuality).map((x) => x.name)).toEqual([
      "Film.2160p.HDR10.x265",
    ]);
  });
});
