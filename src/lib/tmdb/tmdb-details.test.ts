import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

// Ce titlu și ce descriere alege getTmdbDetailsInternal când TMDB n-are
// româna. Ordinea pentru titlu: română → titlu alternativ RO → engleză →
// original. Producțiile românești își păstrează titlul original (e deja cel
// românesc). TMDB e simulat prin tmdbFetch.

vi.mock("./tmdb-client", () => ({ tmdbFetch: vi.fn() }));
vi.mock("./tmdb-title-lookup", () => ({ findRomanianAkaTitle: vi.fn() }));

let tmdb: typeof import("./tmdb.functions");
let tmdbFetch: ReturnType<typeof vi.fn>;
let findRomanianAkaTitle: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  tmdb = await import("./tmdb.functions");
  tmdbFetch = vi.mocked((await import("./tmdb-client")).tmdbFetch);
  findRomanianAkaTitle = vi.mocked((await import("./tmdb-title-lookup")).findRomanianAkaTitle);
});

beforeEach(() => {
  vi.resetAllMocks();
  findRomanianAkaTitle.mockResolvedValue(null);
});

// Răspunsurile TMDB pentru un film: `ro` la cererea ro-RO, `en` la cea implicită.
function movie(ro: Record<string, unknown>, en: Record<string, unknown> = {}) {
  tmdbFetch.mockImplementation(async (path: string) => (path.includes("language=ro-RO") ? ro : en));
}

describe("getTmdbDetailsInternal — titlu și descriere", () => {
  it("cu traducere românească: titlul și descrierea în română, fără cerere în engleză", async () => {
    movie({
      title: "Trădare la nivel înalt",
      original_title: "Mutiny",
      original_language: "en",
      overview: "Descriere RO",
    });

    const d = await tmdb.getTmdbDetailsInternal(1288445, "movie");

    expect(d.title).toBe("Trădare la nivel înalt");
    expect(d.overview).toBe("Descriere RO");
    expect(tmdbFetch).toHaveBeenCalledTimes(1);
  });

  it("fără traducere, cu titlu alternativ RO: îl folosește pe acela", async () => {
    movie({ title: "Mayday", original_title: "Mayday", original_language: "en", overview: "x" });
    findRomanianAkaTitle.mockResolvedValue("S.O.S.: Evadare din URSS");

    expect((await tmdb.getTmdbDetailsInternal(1, "movie")).title).toBe("S.O.S.: Evadare din URSS");
  });

  it("fără nimic în română, la un film spaniol: engleza, nu originalul", async () => {
    movie(
      {
        title: "Enfrentados: Marfil",
        original_title: "Enfrentados: Marfil",
        original_language: "es",
        overview: "",
      },
      { title: "Face Off: Ivory", overview: "English overview" },
    );

    const d = await tmdb.getTmdbDetailsInternal(2, "movie");

    expect(d.title).toBe("Face Off: Ivory");
    expect(d.originalTitle).toBe("Enfrentados: Marfil");
    expect(d.overview).toBe("English overview");
    // Engleza se cere o singură dată, deși e folosită de două ori.
    expect(tmdbFetch).toHaveBeenCalledTimes(2);
  });

  it("dacă nici engleza n-are titlu, rămâne originalul", async () => {
    movie({ title: "군체", original_title: "군체", original_language: "ko", overview: "x" }, {});

    expect((await tmdb.getTmdbDetailsInternal(3, "movie")).title).toBe("군체");
  });

  it("o producție românească își păstrează titlul original", async () => {
    tmdbFetch.mockResolvedValue({
      name: "Insula Iubirii",
      original_name: "Insula Iubirii",
      original_language: "ro",
      overview: "x",
    });

    const d = await tmdb.getTmdbDetailsInternal(62767, "tv");

    expect(d.title).toBe("Insula Iubirii");
    expect(findRomanianAkaTitle).not.toHaveBeenCalled();
    expect(tmdbFetch).toHaveBeenCalledTimes(1);
  });

  it("serial fără titlu românesc: tot engleza înaintea originalului", async () => {
    tmdbFetch.mockImplementation(async (path: string) =>
      path.includes("language=ro-RO")
        ? { name: "Élite", original_name: "Élite", original_language: "es", overview: "RO" }
        : { name: "Elite" },
    );

    expect((await tmdb.getTmdbDetailsInternal(76669, "tv")).title).toBe("Elite");
  });
});

describe("getTmdbAllSeasonsInternal — detaliile episoadelor", () => {
  // Răspunsul TMDB cu append_to_response=season/8: `ro` la cererea ro-RO,
  // `en` la cea implicită.
  function seasons8(ro: Record<string, unknown>, en: Record<string, unknown>) {
    tmdbFetch.mockImplementation(async (path: string) => ({
      "season/8": path.includes("language=ro-RO") ? ro : en,
    }));
  }

  it("cu `details`: descrierea în română, altfel în engleză; imaginea și posterul sezonului", async () => {
    seasons8(
      {
        poster_path: "/sezon8-ro.jpg",
        episodes: [
          { episode_number: 1, name: "Episodul 1", overview: "", still_path: "/e1.jpg" },
          { episode_number: 2, name: "Profeții", overview: "Descriere RO", still_path: null },
        ],
      },
      {
        episodes: [
          { episode_number: 1, name: "Soul of a Rebel", overview: "English overview" },
          { episode_number: 2, name: "Prophecies", overview: "English 2" },
        ],
      },
    );

    const [s] = await tmdb.getTmdbAllSeasonsInternal(56570, [8], { details: true });

    expect(s.posterUrl).toBe("https://image.tmdb.org/t/p/w342/sezon8-ro.jpg");
    expect(s.episodes[0]).toMatchObject({
      title: "Soul of a Rebel",
      overview: "English overview",
      stillUrl: "https://image.tmdb.org/t/p/original/e1.jpg",
    });
    expect(s.episodes[1]).toMatchObject({
      title: "Profeții",
      overview: "Descriere RO",
      stillUrl: null,
    });
  });

  it("nume românesc, dar descriere lipsă în română: cere engleza doar pentru descriere", async () => {
    seasons8(
      { episodes: [{ episode_number: 1, name: "Stingerea", overview: "", still_path: null }] },
      { episodes: [{ episode_number: 1, name: "Lights Out", overview: "English overview" }] },
    );

    const [s] = await tmdb.getTmdbAllSeasonsInternal(95350, [8], { details: true });

    expect(s.episodes[0]).toMatchObject({ title: "Stingerea", overview: "English overview" });
  });

  it("fără `details` (wizard-ul): nici descrieri, nici imagini, nici cerere în engleză de dragul lor", async () => {
    seasons8(
      { episodes: [{ episode_number: 1, name: "Nume RO", overview: "", still_path: "/e1.jpg" }] },
      {},
    );

    const [s] = await tmdb.getTmdbAllSeasonsInternal(56570, [8]);

    expect(s.episodes[0]).not.toHaveProperty("overview");
    expect(s.episodes[0]).not.toHaveProperty("stillUrl");
    expect(s).not.toHaveProperty("posterUrl");
    expect(tmdbFetch).toHaveBeenCalledTimes(1);
  });
});
