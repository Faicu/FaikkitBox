import { describe, it, expect } from "vitest";

import { resizePosterUrl, normalizeStoredPoster, STORED_POSTER_SIZE } from "./poster";

describe("resizePosterUrl", () => {
  it("schimbă doar segmentul de dimensiune", () => {
    expect(resizePosterUrl("https://image.tmdb.org/t/p/w92/abc.jpg", "w342")).toBe(
      "https://image.tmdb.org/t/p/w342/abc.jpg",
    );
  });

  it("merge de la orice dimensiune la orice dimensiune", () => {
    expect(resizePosterUrl("https://image.tmdb.org/t/p/w342/x.jpg", "w780")).toBe(
      "https://image.tmdb.org/t/p/w780/x.jpg",
    );
  });

  it("nu atinge un URL fără segment de dimensiune", () => {
    // Posterele nu vin doar de la TMDB: „Vizionări recente" folosește și
    // miniaturi Plex, servite prin proxy-ul nostru.
    const plex = "/api/plex-thumb?path=%2Flibrary%2Fmetadata%2F4158%2Fthumb";
    expect(resizePosterUrl(plex, "w342")).toBe(plex);
  });

  it("trece null mai departe", () => {
    expect(resizePosterUrl(null, "w342")).toBeNull();
  });

  it("nu confundă alte numere din adresă cu dimensiunea", () => {
    // Hash-ul unui poster poate începe cu litere și cifre; doar segmentul de
    // după /t/p/ e dimensiunea.
    expect(resizePosterUrl("https://image.tmdb.org/t/p/w92/w500abc.jpg", "w342")).toBe(
      "https://image.tmdb.org/t/p/w342/w500abc.jpg",
    );
  });
});

describe("normalizeStoredPoster", () => {
  it("aduce orice poster la dimensiunea de stocare", () => {
    expect(normalizeStoredPoster("https://image.tmdb.org/t/p/w92/a.jpg")).toContain(
      `/t/p/${STORED_POSTER_SIZE}/`,
    );
  });

  it("e idempotentă", () => {
    const once = normalizeStoredPoster("https://image.tmdb.org/t/p/w92/a.jpg");
    expect(normalizeStoredPoster(once)).toBe(once);
  });
});
