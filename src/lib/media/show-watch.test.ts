import { describe, it, expect } from "vitest";

import { formatEpisodeKey, parseEpisodeKey } from "./show-watch";

// Cheile SxxEyy sunt limba comună dintre TMDB (ce s-a difuzat) și `media` (ce
// avem): diferența dintre cele două mulțimi e chiar lista de descărcat. Dacă
// formatarea și parsarea nu sunt exact inverse una alteia, episoade pe care
// le avem deja apar ca lipsă și se descarcă din nou.
describe("formatEpisodeKey / parseEpisodeKey", () => {
  it("formatează cu două cifre, cu zero în față", () => {
    expect(formatEpisodeKey({ season: 1, episode: 2 })).toBe("S01E02");
  });

  it("nu trunchiază sezoanele și episoadele de peste 99", () => {
    expect(formatEpisodeKey({ season: 10, episode: 108 })).toBe("S10E108");
  });

  it("parsează înapoi ce a formatat", () => {
    const key = { season: 4, episode: 11 };
    expect(parseEpisodeKey(formatEpisodeKey(key))).toEqual(key);
  });

  it("întoarce null pentru intrări lipsă sau malformate", () => {
    expect(parseEpisodeKey(null)).toBeNull();
    expect(parseEpisodeKey("")).toBeNull();
    expect(parseEpisodeKey("sezonul 3")).toBeNull();
    // Un pachet de sezon ("S03") nu e o cheie de episod.
    expect(parseEpisodeKey("S03")).toBeNull();
  });

  it("acceptă litere mici, ca să nu depindă de sursa cheii", () => {
    expect(parseEpisodeKey("s02e09")).toEqual({ season: 2, episode: 9 });
  });
});
