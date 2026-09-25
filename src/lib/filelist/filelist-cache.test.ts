import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";

// Cache-ul de 10 minute al căutării pe Filelist e doar al wizard-ului.
// Urmărirea (seriale și filme) întreabă mereu Filelist direct — un răspuns
// din cache acolo ar raporta „nimic nou" pe baza unei căutări vechi.
//
// Filelist e simulat: `fetch` numără cererile și nu iese în rețea.

type Client = typeof import("./filelist-client");
let client: Client;
let calls: number;

beforeAll(async () => {
  process.env.FILELIST_USERNAME = "test";
  process.env.FILELIST_PASSKEY = "test";
  client = await import("./filelist-client");
});

beforeEach(() => {
  calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (!String(input).startsWith("https://filelist.io/"))
        throw new Error(`Cerere neașteptată: ${input}`);
      calls++;
      return new Response("[]", { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Fiecare test pe alt IMDb, ca să nu moștenească intrări de cache între ele.
const query = (imdbId: string, useCache?: boolean) => ({
  title: "X",
  originalTitle: "X",
  imdbId,
  mediaType: "tv" as const,
  useCache,
});

describe("checkFilelistForItemInternal — cache", () => {
  it("urmărirea (fără useCache) întreabă Filelist la fiecare verificare", async () => {
    await client.checkFilelistForItemInternal(query("tt1000001"));
    await client.checkFilelistForItemInternal(query("tt1000001"));

    expect(calls).toBe(2);
  });

  it("wizard-ul (useCache) refolosește rezultatul în cele 10 minute", async () => {
    await client.checkFilelistForItemInternal(query("tt1000002", true));
    await client.checkFilelistForItemInternal(query("tt1000002", true));

    expect(calls).toBe(1);
  });

  it("wizard-ul profită de o căutare proaspătă făcută de urmărire", async () => {
    await client.checkFilelistForItemInternal(query("tt1000003"));
    await client.checkFilelistForItemInternal(query("tt1000003", true));

    expect(calls).toBe(1);
  });
});
