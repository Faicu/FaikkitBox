import { describe, it, expect } from "vitest";

import { mergeConsecutiveEpisodes } from "./recent-watch-merge";
import type { RecentWatch } from "./recent-watch-types";

// `viewedAt` e în secunde; folosim numere mici și crescătoare ca ordinea
// cronologică să fie evidentă la citirea testului.
function ep(
  episode: number,
  viewedAt: number,
  username = "ana",
  over: Partial<RecentWatch> = {},
): RecentWatch {
  return {
    ratingKey: `${username}-${episode}`,
    title: "",
    show: "Serial",
    season: 1,
    episode,
    episodeEnd: null,
    thumbUrl: null,
    username,
    viewedAt,
    completed: true,
    progressMinutes: null,
    durationMinutes: null,
    ...over,
  };
}

function movie(title: string, viewedAt: number, username = "bogdan"): RecentWatch {
  return {
    ratingKey: `m-${title}`,
    title,
    show: null,
    season: null,
    episode: null,
    episodeEnd: null,
    thumbUrl: null,
    username,
    viewedAt,
    completed: true,
    progressMinutes: null,
    durationMinutes: null,
  };
}

// Rezumat citibil: "E01-E03" pentru un card unit, "E02" pentru unul singur.
function labels(items: RecentWatch[]): string[] {
  return items
    .sort((a, b) => b.viewedAt - a.viewedAt)
    .map((i) =>
      i.episode == null
        ? i.title
        : i.episodeEnd != null
          ? `E0${i.episode}-E0${i.episodeEnd}`
          : `E0${i.episode}`,
    );
}

describe("mergeConsecutiveEpisodes", () => {
  it("unește un maraton neîntrerupt într-un singur card", () => {
    const out = mergeConsecutiveEpisodes([ep(1, 100), ep(2, 200), ep(3, 300)]);
    expect(labels(out)).toEqual(["E01-E03"]);
  });

  it("NU unește peste vizionarea altui utilizator", () => {
    // Cerința care a motivat regula: lista sugera un maraton neîntrerupt,
    // deși între episoade se uitase altcineva la altceva.
    const out = mergeConsecutiveEpisodes([
      ep(1, 100),
      ep(2, 200),
      movie("Film", 250, "bogdan"),
      ep(3, 300),
    ]);
    expect(labels(out)).toEqual(["E03", "Film", "E01-E02"]);
  });

  it("NU unește peste vizionarea altui titlu al aceluiași utilizator", () => {
    const out = mergeConsecutiveEpisodes([
      ep(1, 100),
      ep(2, 200),
      movie("Film", 250, "ana"),
      ep(3, 300),
    ]);
    expect(labels(out)).toEqual(["E03", "Film", "E01-E02"]);
  });

  it("nu amestecă doi utilizatori care văd același serial", () => {
    const out = mergeConsecutiveEpisodes([ep(1, 100, "ana"), ep(2, 200, "bogdan")]);
    expect(out).toHaveLength(2);
    expect(out.every((i) => i.episodeEnd == null)).toBe(true);
  });

  it("nu unește episoade neconsecutive, chiar alăturate în listă", () => {
    const out = mergeConsecutiveEpisodes([ep(1, 100), ep(5, 200)]);
    expect(labels(out)).toEqual(["E05", "E01"]);
  });

  it("lasă pe rândul lui un episod neterminat", () => {
    // Altfel minutele afișate ("34/41 min") ar părea să se refere la tot
    // intervalul unit, nu la ultimul episod din el.
    const out = mergeConsecutiveEpisodes([
      ep(1, 100),
      ep(2, 200),
      ep(3, 300, "ana", { completed: false, progressMinutes: 12, durationMinutes: 41 }),
    ]);
    expect(labels(out)).toEqual(["E03", "E01-E02"]);
  });

  it("cardul unit poartă ora celei mai recente vizionări din serie", () => {
    const out = mergeConsecutiveEpisodes([ep(1, 100), ep(2, 200), ep(3, 300)]);
    expect(out[0].viewedAt).toBe(300);
  });

  it("lasă neatinse filmele și tot ce n-are sezon/episod", () => {
    const out = mergeConsecutiveEpisodes([movie("A", 100), movie("B", 200)]);
    expect(labels(out)).toEqual(["B", "A"]);
  });

  it("două reprize separate ale aceluiași serial dau două carduri", () => {
    const out = mergeConsecutiveEpisodes([
      ep(1, 100),
      ep(2, 200),
      movie("Pauză", 250, "bogdan"),
      ep(3, 300),
      ep(4, 400),
    ]);
    expect(labels(out)).toEqual(["E03-E04", "Pauză", "E01-E02"]);
  });

  it("nu pierde nicio vizionare", () => {
    const input = [ep(1, 100), ep(2, 200), movie("F", 250, "bogdan"), ep(3, 300)];
    const out = mergeConsecutiveEpisodes(input);
    const acoperite = out.reduce(
      (n, i) => n + (i.episodeEnd != null ? i.episodeEnd - (i.episode ?? 0) + 1 : 1),
      0,
    );
    expect(acoperite).toBe(input.length);
  });
});
