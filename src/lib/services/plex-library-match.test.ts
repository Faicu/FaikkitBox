import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import type { PlexMetadataItem } from "./plex-shared";

// Potrivirea după titlu — singurul loc unde un rând din `media` se leagă de
// un item Plex anume. O potrivire greșită nu dă eroare nicăieri: rândul
// primește ratingKey-ul altui titlu și Biblioteca arată, liniștit, altceva.
//
// Plex e simulat printr-un `fetch` fals care răspunde doar la rutele știute și
// aruncă la orice altceva — testul nu poate ieși în rețea nici din greșeală.
// Descoperirea serverului (plex.tv) e înlocuită cu o adresă fixă.

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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const u = new URL(input);
      if (u.origin !== "http://plex.test")
        throw new Error(`Cerere în afara Plex-ului fals: ${input}`);
      const key = `${u.pathname}${u.search}`;
      requested.push(key);
      if (!routes.has(key)) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(routes.get(key)), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const container = (Metadata: PlexMetadataItem[]) => ({ MediaContainer: { Metadata } });

function searchReturns(query: string, type: 1 | 2, results: PlexMetadataItem[]): void {
  routes.set(`/search?query=${encodeURIComponent(query)}&type=${type}`, container(results));
}

function item(ratingKey: string, fields: Partial<PlexMetadataItem> = {}): PlexMetadataItem {
  return { ratingKey, duration: 7_200_000, addedAt: 1_700_000_000, ...fields } as PlexMetadataItem;
}

// Un serial complet în Plex: show → sezoane → episoade.
function showInPlex(ratingKey: string, seasons: Record<number, number[]>): void {
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

const show = (ratingKey: string, title: string) => item(ratingKey, { type: "show", title });

describe("findPlexMovieLink", () => {
  it("găsește filmul după titlu și citește item-ul complet", async () => {
    searchReturns("Dune", 1, [item("m1", { type: "movie", title: "Dune" })]);
    routes.set(
      "/library/metadata/m1",
      container([item("m1", { type: "movie", duration: 9_000_000 })]),
    );

    const link = await plex.findPlexMovieLink("Dune", "Dune");

    expect(link).toMatchObject({ ratingKey: "m1", durationMs: 9_000_000 });
    expect(requested).toContain("/library/metadata/m1");
  });

  it("cade pe titlul original când titlul nu dă nimic", async () => {
    searchReturns("Dune: Partea a doua", 1, []);
    searchReturns("Dune: Part Two", 1, [item("m2", { type: "movie" })]);
    routes.set("/library/metadata/m2", container([item("m2", { type: "movie" })]));

    expect((await plex.findPlexMovieLink("Dune: Partea a doua", "Dune: Part Two"))?.ratingKey).toBe(
      "m2",
    );
  });

  it("sare peste rezultatele care nu sunt filme", async () => {
    searchReturns("Dune", 1, [show("s1", "Dune"), item("m1", { type: "movie" })]);
    routes.set("/library/metadata/m1", container([item("m1", { type: "movie" })]));

    expect((await plex.findPlexMovieLink("Dune", "Dune"))?.ratingKey).toBe("m1");
  });

  it("dacă Plex nu răspunde, întoarce null fără să arunce", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))),
    );

    expect(await plex.findPlexMovieLink("Dune", "Dune")).toBeNull();
  });

  it("dacă filmul nu e în Plex, întoarce null", async () => {
    searchReturns("Dune", 1, []);

    expect(await plex.findPlexMovieLink("Dune", "Dune")).toBeNull();
  });

  // Problemă cunoscută (24 sept. 2026): se ia primul film din căutare, fără
  // an. La un remake (Dune 1984 / 2021) legarea poate nimeri filmul vechi.
  // Funcția nu primește anul deloc, deci un test „corect" nici nu se poate
  // scrie înainte de reparație.
  it.todo("alege filmul după an când Plex are două cu același titlu");
});

describe("potrivirea serialului (prin findPlexEpisodeLink)", () => {
  it("preferă potrivirea exactă celei parțiale", async () => {
    searchReturns("The Office", 2, [show("us", "The Office (US)"), show("uk", "The Office")]);
    showInPlex("uk", { 1: [1] });

    expect((await plex.findPlexEpisodeLink("The Office", 1, 1))?.ratingKey).toBe("uk-s1e1");
  });

  it("ignoră diacriticele și majusculele", async () => {
    // Un rezultat străin înainte: altfel fallback-ul „primul rezultat" ar
    // nimeri serialul bun și fără normalizare, iar testul n-ar verifica nimic.
    searchReturns("Ștefan cel Mare", 2, [
      show("x", "Ștefan și Ana"),
      show("s1", "stefan cel mare"),
    ]);
    showInPlex("s1", { 1: [1] });

    expect((await plex.findPlexEpisodeLink("Ștefan cel Mare", 1, 1))?.ratingKey).toBe("s1-s1e1");
  });

  it("când căutarea nu dă nimic, caută în lista secțiunii de seriale", async () => {
    searchReturns("Severance", 2, []);
    routes.set("/library/sections", {
      MediaContainer: {
        Directory: [
          { type: "movie", key: "1" },
          { type: "show", key: "2" },
        ],
      },
    });
    routes.set("/library/sections/2/all?type=2", container([show("sv", "Severance")]));
    showInPlex("sv", { 2: [5] });

    expect((await plex.findPlexEpisodeLink("Severance", 2, 5))?.ratingKey).toBe("sv-s2e5");
  });

  it("întoarce null când sezonul sau episodul nu există încă", async () => {
    searchReturns("Severance", 2, [show("sv", "Severance")]);
    showInPlex("sv", { 1: [1, 2] });

    expect(await plex.findPlexEpisodeLink("Severance", 2, 1)).toBeNull();
    expect(await plex.findPlexEpisodeLink("Severance", 1, 3)).toBeNull();
  });

  // Probleme cunoscute (24 sept. 2026). `it.fails` trece cât timp potrivirea
  // greșește; după reparație testul pică și trebuie trecut pe `it`.
  it.fails(
    "un titlu scurt nu se leagă de un serial care doar îl conține (You → Younger)",
    async () => {
      searchReturns("You", 2, [show("yg", "Younger")]);
      showInPlex("yg", { 1: [1] });

      expect(await plex.findPlexEpisodeLink("You", 1, 1)).toBeNull();
    },
  );

  it.fails("fără nicio potrivire de titlu nu ia primul rezultat al căutării", async () => {
    searchReturns("Severance", 2, [show("bb", "Breaking Bad")]);
    showInPlex("bb", { 1: [1] });

    expect(await plex.findPlexEpisodeLink("Severance", 1, 1)).toBeNull();
  });
});

describe("findPlexSeasonLinks", () => {
  it("întoarce câte un link per episod indexat, fără episodul 0", async () => {
    searchReturns("Severance", 2, [show("sv", "Severance")]);
    showInPlex("sv", { 2: [0, 1, 2, 3] });

    const links = await plex.findPlexSeasonLinks("Severance", 2);

    expect([...(links?.keys() ?? [])]).toEqual([1, 2, 3]);
    expect(links?.get(2)?.ratingKey).toBe("sv-s2e2");
  });

  it("întoarce null, nu o hartă goală, când serialul lipsește din Plex", async () => {
    // Diferența contează: resolveSeasonPackPlexLinks tratează ambele ca „mai
    // încearcă", dar null înseamnă „nu știu", nu „știu că n-are nimic".
    searchReturns("Severance", 2, []);
    routes.set("/library/sections", { MediaContainer: { Directory: [] } });

    expect(await plex.findPlexSeasonLinks("Severance", 2)).toBeNull();
  });
});
