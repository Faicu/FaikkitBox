import { describe, it, expect } from "vitest";

import {
  bestOf,
  sortBySeeders,
  matchesForQuality,
  qualityRank,
  pickFromSet,
  tvStatusLabel,
  ONGOING_TV_STATUSES,
} from "./selection";
import type { FilelistTorrent } from "@/lib/filelist.functions";

// Doar câmpurile care contează pentru funcțiile testate — restul structurii
// de torrent Filelist e irelevantă aici.
function t(name: string, seeders: number, id = seeders): FilelistTorrent {
  return { id, name, seeders } as unknown as FilelistTorrent;
}

describe("bestOf / sortBySeeders", () => {
  it("alege torrentul cu cei mai mulți seederi", () => {
    expect(bestOf([t("a", 3), t("b", 10), t("c", 7)])?.name).toBe("b");
  });

  it("întoarce null pentru o listă goală", () => {
    expect(bestOf([])).toBeNull();
  });

  it("nu modifică lista primită", () => {
    // Sortarea se face pe o copie: lista vine din `checkResult.torrents`, iar
    // o sortare pe loc ar rearanja starea componentei pe sub picioarele
    // randării care tocmai o citește.
    const list = [t("a", 1), t("b", 9)];
    sortBySeeders(list);
    expect(list.map((x) => x.name)).toEqual(["a", "b"]);
  });
});

describe("qualityRank", () => {
  it("ordonează calitățile cunoscute crescător", () => {
    expect(qualityRank("720p")).toBeLessThan(qualityRank("1080p"));
    expect(qualityRank("1080p")).toBeLessThan(qualityRank("4K"));
    expect(qualityRank("4K")).toBeLessThan(qualityRank("4K HDR"));
  });

  it("dă 0 pentru necunoscut sau absent", () => {
    // Contează pentru upgrade-ul filmelor: un rang necunoscut nu trebuie să
    // pară niciodată „mai bun decât" ceva, ca să nu propunem o a doua
    // descărcare pe baza unei ghiceli.
    expect(qualityRank(null)).toBe(0);
    expect(qualityRank("480")).toBe(0);
    expect(qualityRank("SD")).toBe(0);
  });

  it("nu declară upgrade la calitate egală", () => {
    expect(qualityRank("1080p") > qualityRank("1080p")).toBe(false);
  });
});

describe("matchesForQuality", () => {
  const torrents = [
    t("Film.2024.1080p.BluRay.x264", 5),
    t("Film.2024.2160p.HDR.WEB-DL", 20),
    t("Film.2024.720p.WEB", 8),
    t("Film.2024.1080p.WEB-DL", 50),
  ];

  it("întoarce doar potrivirile de calitatea cerută, cele mai bune primele", () => {
    const res = matchesForQuality(torrents, "1080p");
    expect(res.map((x) => x.seeders)).toEqual([50, 5]);
  });

  it("nu amestecă 4K cu 1080p", () => {
    expect(matchesForQuality(torrents, "1080p").some((x) => x.name.includes("2160p"))).toBe(false);
  });

  it("întoarce listă goală când nu există nimic la calitatea cerută", () => {
    expect(matchesForQuality([t("Film.2024.720p.WEB", 3)], "4K HDR")).toEqual([]);
  });
});

describe("pickFromSet", () => {
  it("scoate lista corespunzătoare fiecărei calități", () => {
    const set = {
      t720: [t("720", 1)],
      t1080: [t("1080", 2)],
      t4k: [t("4k", 3)],
      t4kHdr: [t("hdr", 4)],
    };
    expect(pickFromSet(set, "720p")[0].name).toBe("720");
    expect(pickFromSet(set, "1080p")[0].name).toBe("1080");
    expect(pickFromSet(set, "4K")[0].name).toBe("4k");
    expect(pickFromSet(set, "4K HDR")[0].name).toBe("hdr");
  });
});

describe("statusuri de serial", () => {
  it("recunoaște ca 'în curs' doar serialele care mai pot primi episoade", () => {
    // De asta depinde dacă ți se oferă butonul de urmărire: un serial
    // încheiat n-are ce aștepta.
    expect(ONGOING_TV_STATUSES.has("Returning Series")).toBe(true);
    expect(ONGOING_TV_STATUSES.has("In Production")).toBe(true);
    expect(ONGOING_TV_STATUSES.has("Ended")).toBe(false);
    expect(ONGOING_TV_STATUSES.has("Canceled")).toBe(false);
  });

  it("traduce statusurile cunoscute și lasă neatinse pe cele necunoscute", () => {
    expect(tvStatusLabel("Returning Series")).toBe("va reveni cu sezoane noi");
    expect(tvStatusLabel("Ceva Nou La TMDB")).toBe("Ceva Nou La TMDB");
  });
});
