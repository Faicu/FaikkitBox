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
