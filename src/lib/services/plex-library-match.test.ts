import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import type { PlexMetadataItem } from "./plex-shared";

// Potrivirea cu Plex — singurul loc unde un rând din `media` se leagă de un
// item Plex anume. O potrivire greșită nu dă eroare nicăieri: rândul primește
// ratingKey-ul altui titlu și Biblioteca arată, liniștit, altceva.
//
// Regula (24 sept. 2026): cu ID TMDB decide doar ID-ul (`tmdb://` din Guid);
// fără ID, doar titlul exact. Biblioteca Plex e în română, deci titlul găsit
// diferă des de cel căutat („Imperiul Mafiei" pentru MobLand).
//
// Plex e simulat printr-un `fetch` fals care răspunde doar la rutele știute și
// aruncă la orice altă adresă — testul nu poate ieși în rețea nici din
// greșeală. Descoperirea serverului (plex.tv) e înlocuită cu o adresă fixă.

vi.mock("./plex-shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./plex-shared")>()),
  discoverPlexUrl: vi.fn(async () => ({ url: "http://plex.test", source: "test", attempts: [] })),
}));

type PlexLibrary = typeof import("./plex-library");
let plex: PlexLibrary;

beforeAll(async () => {
  process.env.PLEX_TOKEN = "test-token";
  plex = await import("./plex-library");
});

// Rutele Plex pe care le servește testul curent: cheia e calea + query.
let routes: Map<string, unknown>;
let requested: string[];

beforeEach(() => {
  routes = new Map();
  requested = [];
  // Secțiunile există mereu; conținutul lor e gol până îl umple testul.
  routes.set("/library/sections", {
    MediaContainer: {
      Directory: [
        { type: "movie", key: "1" },
        { type: "show", key: "2" },
      ],
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const u = new URL(input);
      if (u.origin !== "http://plex.test") {
        throw new Error(`Cerere în afara Plex-ului fals: ${input}`);
      }
      const key = `${u.pathname}${u.search}`;
      requested.push(key);
      if (!routes.has(key)) {
        // Căutările și listele neconfigurate sunt goale, nu 404 — așa
        // răspunde și Plex-ul real.
        if (u.pathname === "/search" || u.pathname.endsWith("/all")) {
          return new Response(JSON.stringify({ MediaContainer: { size: 0 } }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      }
      return new Response(JSON.stringify(routes.get(key)), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const container = (Metadata: PlexMetadataItem[]) => ({ MediaContainer: { Metadata } });

function searchReturns(query: string, type: 1 | 2, results: PlexMetadataItem[]): void {
  routes.set(
    `/search?query=${encodeURIComponent(query)}&type=${type}&includeGuids=1`,
    container(results),
  );
}

function sectionContains(type: 1 | 2, items: PlexMetadataItem[]): void {
  routes.set(`/library/sections/${type}/all?type=${type}&includeGuids=1`, container(items));
}

function item(ratingKey: string, fields: Partial<PlexMetadataItem> = {}): PlexMetadataItem {
  return { ratingKey, duration: 7_200_000, addedAt: 1_700_000_000, ...fields } as PlexMetadataItem;
}

const guid = (tmdbId: number) => [{ id: `imdb://tt${tmdbId}` }, { id: `tmdb://${tmdbId}` }];

function movie(ratingKey: string, title: string, tmdbId: number): PlexMetadataItem {
  const m = item(ratingKey, { type: "movie", title, Guid: guid(tmdbId) });
  // Item-ul complet, cerut după potrivire pentru stream-uri.
  routes.set(`/library/metadata/${ratingKey}`, container([m]));
  return m;
}

const show = (ratingKey: string, title: string, tmdbId: number, originalTitle?: string) =>
  item(ratingKey, { type: "show", title, originalTitle, Guid: guid(tmdbId) });

// Sezoanele și episoadele unui serial din Plex.
function seasonsInPlex(ratingKey: string, seasons: Record<number, number[]>): void {
  routes.set(
    `/library/metadata/${ratingKey}/children`,
    container(Object.keys(seasons).map((s) => item(`${ratingKey}-s${s}`, { index: Number(s) }))),
  );
  for (const [s, eps] of Object.entries(seasons)) {
    routes.set(
      `/library/metadata/${ratingKey}-s${s}/children`,
      container(eps.map((e) => item(`${ratingKey}-s${s}e${e}`, { index: e }))),
    );
  }
}

const DUNE_1984 = 841;
const DUNE_2021 = 438631;

describe("findPlexMovieLink", () => {
  it("alege filmul după ID-ul TMDB, nu primul cu același titlu (Dune 1984 / 2021)", async () => {
    searchReturns("Dune", 1, [movie("old", "Dune", DUNE_1984), movie("new", "Dune", DUNE_2021)]);

    const link = await plex.findPlexMovieLink({ tmdbId: DUNE_2021, titles: ["Dune"] });

    expect(link?.ratingKey).toBe("new");
    expect(requested).toContain("/library/metadata/new");
  });

  it("găsește filmul și când Plex îl afișează sub alt titlu", async () => {
    searchReturns("Moana", 1, [movie("m1", "Vaiana", 277834)]);

    expect((await plex.findPlexMovieLink({ tmdbId: 277834, titles: ["Moana"] }))?.ratingKey).toBe(
      "m1",
    );
  });

  it("încearcă și titlul original când primul titlu nu dă ID-ul căutat", async () => {
    searchReturns("Dune: Part Two", 1, [movie("m2", "Dune: Partea a doua", 693134)]);

    const link = await plex.findPlexMovieLink({
      tmdbId: 693134,
      titles: ["Dune: Partea a doua", "Dune: Part Two"],
    });

    expect(link?.ratingKey).toBe("m2");
  });

  it("caută în lista secțiunii când căutarea nu-l găsește", async () => {
    sectionContains(1, [movie("x", "Hokum", 1), movie("m3", "Vaiana", 277834)]);

    expect((await plex.findPlexMovieLink({ tmdbId: 277834, titles: ["Moana"] }))?.ratingKey).toBe(
      "m3",
    );
  });

  it("cu ID TMDB, nu leagă alt film doar pentru că apare în căutare", async () => {
    searchReturns("Dune", 1, [movie("old", "Dune", DUNE_1984)]);
    sectionContains(1, [movie("old", "Dune", DUNE_1984)]);

    expect(await plex.findPlexMovieLink({ tmdbId: DUNE_2021, titles: ["Dune"] })).toBeNull();
  });

  it("sare peste rezultatele care nu sunt filme", async () => {
    searchReturns("Dune", 1, [show("s1", "Dune", DUNE_2021), movie("m1", "Dune", DUNE_2021)]);

    expect((await plex.findPlexMovieLink({ tmdbId: DUNE_2021, titles: ["Dune"] }))?.ratingKey).toBe(
      "m1",
    );
  });

  it("fără ID TMDB, leagă doar la titlu exact", async () => {
    searchReturns("Dune", 1, [movie("p2", "Dune: Part Two", 693134)]);
    expect(await plex.findPlexMovieLink({ tmdbId: null, titles: ["Dune"] })).toBeNull();

    searchReturns("Dune", 1, [movie("p2", "Dune: Part Two", 693134), movie("d", "Dune", 1)]);
    expect((await plex.findPlexMovieLink({ tmdbId: null, titles: ["Dune"] }))?.ratingKey).toBe("d");
  });

  it("dacă Plex nu răspunde, întoarce null fără să arunce", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))),
    );

    expect(await plex.findPlexMovieLink({ tmdbId: DUNE_2021, titles: ["Dune"] })).toBeNull();
  });
});

describe("potrivirea serialului (prin findPlexEpisodeLink)", () => {
  it("găsește serialul sub titlul românesc din Plex (MobLand → Imperiul Mafiei)", async () => {
    searchReturns("MobLand", 2, [show("mb", "Imperiul Mafiei", 247718, "MobLand")]);
    seasonsInPlex("mb", { 1: [1] });

    expect(
      (await plex.findPlexEpisodeLink({ tmdbId: 247718, titles: ["MobLand"] }, 1, 1))?.ratingKey,
    ).toBe("mb-s1e1");
  });

  it("un titlu scurt nu se leagă de un serial care doar îl conține (You → Younger)", async () => {
    searchReturns("You", 2, [show("yg", "Younger", 60590)]);
    sectionContains(2, [show("yg", "Younger", 60590)]);
    seasonsInPlex("yg", { 1: [1] });

    expect(await plex.findPlexEpisodeLink({ tmdbId: 78191, titles: ["You"] }, 1, 1)).toBeNull();
  });

  it("nu ia primul rezultat al căutării când niciunul nu e serialul căutat", async () => {
    searchReturns("Severance", 2, [show("bb", "Breaking Bad", 1396)]);
    sectionContains(2, [show("bb", "Breaking Bad", 1396)]);
    seasonsInPlex("bb", { 1: [1] });

    expect(
      await plex.findPlexEpisodeLink({ tmdbId: 95396, titles: ["Severance"] }, 1, 1),
    ).toBeNull();
  });

  it("deosebește două seriale cu același titlu (The Office UK / US)", async () => {
    searchReturns("The Office", 2, [
      show("uk", "The Office", 2996),
      show("us", "The Office", 2316),
    ]);
    seasonsInPlex("us", { 1: [1] });

    expect(
      (await plex.findPlexEpisodeLink({ tmdbId: 2316, titles: ["The Office"] }, 1, 1))?.ratingKey,
    ).toBe("us-s1e1");
  });

  it("caută în lista secțiunii când căutarea nu dă nimic (Élite → Elita)", async () => {
    sectionContains(2, [show("x", "Wednesday", 119051), show("el", "Elita", 76669, "Élite")]);
    seasonsInPlex("el", { 3: [8] });

    expect(
      (await plex.findPlexEpisodeLink({ tmdbId: 76669, titles: ["Élite"] }, 3, 8))?.ratingKey,
    ).toBe("el-s3e8");
  });

  it("fără ID TMDB: titlu exact, cu diacritice și majuscule ignorate", async () => {
    // Un rezultat străin înainte: altfel testul ar trece și dacă s-ar lua,
    // ca înainte, primul rezultat.
    searchReturns("Ștefan cel Mare", 2, [
      show("x", "Ștefan și Ana", 1),
      show("s1", "stefan cel mare", 2),
    ]);
    seasonsInPlex("s1", { 1: [1] });

    expect(
      (await plex.findPlexEpisodeLink({ tmdbId: null, titles: ["Ștefan cel Mare"] }, 1, 1))
        ?.ratingKey,
    ).toBe("s1-s1e1");
  });

  it("fără ID TMDB: potrivește și titlul original din Plex", async () => {
    searchReturns("Outlander", 2, [show("st", "Străina", 56570, "Outlander")]);
    seasonsInPlex("st", { 1: [1] });

    expect(
      (await plex.findPlexEpisodeLink({ tmdbId: null, titles: ["Outlander"] }, 1, 1))?.ratingKey,
    ).toBe("st-s1e1");
  });

  it("fără ID TMDB: nu mai potrivește „conține”", async () => {
    searchReturns("The Office", 2, [show("us", "The Office (US)", 2316)]);
    seasonsInPlex("us", { 1: [1] });

    expect(
      await plex.findPlexEpisodeLink({ tmdbId: null, titles: ["The Office"] }, 1, 1),
    ).toBeNull();
  });

  it("întoarce null când sezonul sau episodul nu există încă", async () => {
    searchReturns("Severance", 2, [show("sv", "Severance", 95396)]);
    seasonsInPlex("sv", { 1: [1, 2] });
    const sv = { tmdbId: 95396, titles: ["Severance"] };

    expect(await plex.findPlexEpisodeLink(sv, 2, 1)).toBeNull();
    expect(await plex.findPlexEpisodeLink(sv, 1, 3)).toBeNull();
  });
});

describe("findPlexSeasonLinks", () => {
  it("întoarce câte un link per episod indexat, fără episodul 0", async () => {
    searchReturns("Severance", 2, [show("sv", "Severance", 95396)]);
    seasonsInPlex("sv", { 2: [0, 1, 2, 3] });

    const links = await plex.findPlexSeasonLinks({ tmdbId: 95396, titles: ["Severance"] }, 2);

    expect([...(links?.keys() ?? [])]).toEqual([1, 2, 3]);
    expect(links?.get(2)?.ratingKey).toBe("sv-s2e2");
  });

  it("întoarce null, nu o hartă goală, când serialul lipsește din Plex", async () => {
    // Diferența contează: resolveSeasonPackPlexLinks tratează ambele ca „mai
    // încearcă", dar null înseamnă „nu știu", nu „știu că n-are nimic".
    expect(await plex.findPlexSeasonLinks({ tmdbId: 95396, titles: ["Severance"] }, 2)).toBeNull();
  });
});

// Ce vede wizard-ul: „e deja în Plex?" și ce episoade ai din fiecare sezon.
describe("verificările wizard-ului", () => {
  it("nu spune „ai deja” pentru alt film cu același titlu", async () => {
    searchReturns("Dune", 1, [movie("old", "Dune", DUNE_1984)]);

    expect(
      await plex.checkPlexHasTitleInternal({
        tmdbId: DUNE_2021,
        title: "Dune",
        originalTitle: "Dune",
        mediaType: "movie",
      }),
    ).toEqual({ found: false, qualities: [] });
  });

  it("găsește filmul după ID", async () => {
    searchReturns("Dune", 1, [movie("new", "Dune", DUNE_2021)]);

    const res = await plex.checkPlexHasTitleInternal({
      tmdbId: DUNE_2021,
      title: "Dune",
      originalTitle: "Dune",
      mediaType: "movie",
    });

    expect(res?.found).toBe(true);
  });

  it("vede episoadele unui serial cu titlu românesc în Plex", async () => {
    searchReturns("Man vs. Baby", 2, [show("mvb", "Om vs bebeluș", 279601, "Man vs. Baby")]);
    seasonsInPlex("mvb", { 1: [1, 2, 3, 4] });

    const eps = await plex.getPlexEpisodesInSeasonInternal({
      tmdbId: 279601,
      showTitle: "Man vs. Baby",
      season: 1,
    });

    expect(eps.map((e) => e.num)).toEqual([1, 2, 3, 4]);
  });
});
