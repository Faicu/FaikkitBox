import { describe, it, expect, vi, afterEach } from "vitest";

import type { PlexBrowseItem, ShowEpisodeEntry } from "@/lib/services/plex-browse";
import {
  episodeCode,
  displayEpisodeTitle,
  matchesQuery,
  isStaleUnwatched,
  sortItems,
  groupBySeason,
  nextEpisodeWhen,
} from "./utils";

const DAY = 24 * 60 * 60;

function item(over: Partial<PlexBrowseItem> = {}): PlexBrowseItem {
  return {
    mediaId: 1,
    ratingKey: null,
    title: "Titlu",
    type: "movie",
    show: null,
    thumbUrl: null,
    addedAt: 1_700_000_000,
    watchedByMe: false,
    watchedCount: 0,
    episodeCount: 0,
    seasonCount: 0,
    watchedEpisodes: 0,
    downloadingCount: 0,
    autoDownload: false,
    status: "in_library",
    progress: null,
    dlspeed: null,
    eta: null,
    ...over,
  };
}

function episode(over: Partial<ShowEpisodeEntry> = {}): ShowEpisodeEntry {
  return {
    mediaId: 1,
    season: 1,
    episode: 1,
    episodeTitle: null,
    addedAt: 0,
    status: "in_library",
    watchedByMe: false,
    isSeasonPack: false,
    ...over,
  };
}

describe("episodeCode", () => {
  it("formatează sezonul și episodul cu două cifre", () => {
    expect(episodeCode(1, 2)).toBe("S01E02");
  });

  // Un pachet de sezon are episode null; fără cod afișabil, UI-ul arată
  // altceva în loc de un "S03Enull".
  it("întoarce null dacă lipsește sezonul sau episodul", () => {
    expect(episodeCode(3, null)).toBeNull();
    expect(episodeCode(null, 5)).toBeNull();
  });
});

describe("displayEpisodeTitle", () => {
  // TMDB întoarce "Episodul 8" când episodul n-are nume propriu. Afișat
  // lângă "S10E08" ar spune de două ori același lucru.
  it("ascunde titlurile generice, în ambele limbi", () => {
    expect(displayEpisodeTitle("Episodul 8")).toBeNull();
    expect(displayEpisodeTitle("Episode 12")).toBeNull();
    expect(displayEpisodeTitle("  Episodul 3  ")).toBeNull();
  });

  it("păstrează un titlu real", () => {
    expect(displayEpisodeTitle("Vânătoarea")).toBe("Vânătoarea");
  });

  it("tratează lipsa titlului ca lipsă", () => {
    expect(displayEpisodeTitle(null)).toBeNull();
    expect(displayEpisodeTitle("")).toBeNull();
  });

  // "Episodul dispărut" începe cu același cuvânt, dar e un titlu real —
  // regex-ul e ancorat tocmai ca să nu-l piardă.
  it("nu confundă un titlu care începe cu „Episodul”", () => {
    expect(displayEpisodeTitle("Episodul dispărut")).toBe("Episodul dispărut");
  });
});

describe("matchesQuery", () => {
  it("caută fără să țină cont de majuscule", () => {
    expect(matchesQuery(item({ title: "Menajera" }), "menaj")).toBe(true);
  });

  // Biblioteca are titluri românești cu diacritice, dar tastatura de pe
  // telefon nu le scoate întotdeauna — căutarea "soapta" trebuie să
  // găsească "Omul Șoapta".
  it("ignoră diacriticele românești", () => {
    expect(matchesQuery(item({ title: "Omul Șoapta" }), "soapta")).toBe(true);
    expect(matchesQuery(item({ title: "Insula Iubirii" }), "iubiri")).toBe(true);
    expect(matchesQuery(item({ title: "Vânătoarea" }), "vanatoare")).toBe(true);
  });

  it("caută și în numele serialului, nu doar în titlu", () => {
    expect(matchesQuery(item({ title: "S01E01", show: "Lanterns" }), "lantern")).toBe(true);
  });

  it("acceptă tot când căutarea e goală", () => {
    expect(matchesQuery(item({ title: "Orice" }), "")).toBe(true);
  });

  it("respinge ce nu se potrivește", () => {
    expect(matchesQuery(item({ title: "Menajera" }), "supergirl")).toBe(false);
  });
});

describe("isStaleUnwatched", () => {
  const now = 1_800_000_000;

  it("marchează un titlu vechi pe care nu l-a văzut nimeni", () => {
    expect(isStaleUnwatched(item({ watchedCount: 0, addedAt: now - 100 * DAY }), now)).toBe(true);
  });

  // Un titlu vizionat nu e "uitat", oricât de vechi ar fi.
  it("nu marchează un titlu vizionat", () => {
    expect(isStaleUnwatched(item({ watchedCount: 2, addedAt: now - 100 * DAY }), now)).toBe(false);
  });

  // Adăugat acum o săptămână și nevăzut încă înseamnă doar că n-a apucat
  // nimeni, nu că e de șters.
  it("nu marchează un titlu adăugat recent", () => {
    expect(isStaleUnwatched(item({ watchedCount: 0, addedAt: now - 7 * DAY }), now)).toBe(false);
  });
});

describe("sortItems", () => {
  const a = item({ mediaId: 1, watchedCount: 0, addedAt: 300 });
  const b = item({ mediaId: 2, watchedCount: 5, addedAt: 100 });
  const c = item({ mediaId: 3, watchedCount: 5, addedAt: 200 });

  it("lasă ordinea de la server pentru „recent”", () => {
    expect(sortItems([a, b, c], "recent").map((i) => i.mediaId)).toEqual([1, 2, 3]);
  });

  it("sortează după vizionări, apoi după cel mai recent adăugat", () => {
    expect(sortItems([a, b, c], "mostWatched").map((i) => i.mediaId)).toEqual([3, 2, 1]);
  });

  it("păstrează doar nevizionatele pentru „unwatched”", () => {
    expect(sortItems([a, b, c], "unwatched").map((i) => i.mediaId)).toEqual([1]);
  });

  it("nu modifică lista primită", () => {
    const input = [a, b, c];
    sortItems(input, "mostWatched");
    expect(input.map((i) => i.mediaId)).toEqual([1, 2, 3]);
  });
});

describe("groupBySeason", () => {
  it("adună episoadele pe sezonul real, nu pe secvențe consecutive", () => {
    const groups = groupBySeason([
      episode({ mediaId: 1, season: 1, episode: 1 }),
      episode({ mediaId: 2, season: 2, episode: 1 }),
      episode({ mediaId: 3, season: 1, episode: 2 }),
    ]);
    expect(groups.map((g) => g.season)).toEqual([1, 2]);
    expect(groups[0].episodes.map((e) => e.mediaId)).toEqual([1, 3]);
  });

  it("pune sezoanele necunoscute la final", () => {
    const groups = groupBySeason([
      episode({ season: null }),
      episode({ season: 2 }),
      episode({ season: 1 }),
    ]);
    expect(groups.map((g) => g.season)).toEqual([1, 2, null]);
  });

  it("întoarce o listă goală pentru un serial fără episoade", () => {
    expect(groupBySeason([])).toEqual([]);
  });
});

describe("nextEpisodeWhen", () => {
  afterEach(() => vi.useRealTimers());

  function at(iso: string) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  }

  it("spune „azi” pentru un episod din ziua curentă", () => {
    at("2026-09-07T09:00:00");
    expect(nextEpisodeWhen("2026-09-07", null)?.text).toBe("azi");
  });

  // Zile calendaristice, nu diferență de 24h: un episod de mâine dimineață e
  // "mâine" chiar dacă până atunci mai sunt doar 9 ore.
  it("spune „mâine” chiar când până atunci sunt sub 24 de ore", () => {
    at("2026-09-07T22:00:00");
    expect(nextEpisodeWhen("2026-09-08", null)?.text).toBe("mâine");
  });

  it("numără zilele în săptămâna următoare", () => {
    at("2026-09-07T09:00:00");
    expect(nextEpisodeWhen("2026-09-10", null)?.text).toBe("în 3 zile");
  });

  // Peste o săptămână numărul de zile nu mai spune nimic util, așa că se
  // trece pe data propriu-zisă.
  it("cade pe data calendaristică dincolo de o săptămână", () => {
    at("2026-09-07T09:00:00");
    const res = nextEpisodeWhen("2026-10-20", null);
    expect(res?.text).not.toMatch(/^în \d+ zile$/);
    expect(res?.soon).toBe(false);
  });

  it("marchează „soon” doar pentru azi, mâine și poimâine", () => {
    at("2026-09-07T09:00:00");
    expect(nextEpisodeWhen("2026-09-07", null)?.soon).toBe(true);
    expect(nextEpisodeWhen("2026-09-09", null)?.soon).toBe(true);
    expect(nextEpisodeWhen("2026-09-11", null)?.soon).toBe(false);
  });

  // Un episod deja difuzat nu e "în curând", oricât de aproape ar fi.
  it("nu marchează „soon” un episod din trecut", () => {
    at("2026-09-07T09:00:00");
    expect(nextEpisodeWhen("2026-09-05", null)?.soon).toBe(false);
  });

  it("întoarce null când nu există nicio dată utilizabilă", () => {
    expect(nextEpisodeWhen(null, null)).toBeNull();
    expect(nextEpisodeWhen("nu-i o dată", null)).toBeNull();
  });
});
