import { describe, it, expect } from "vitest";

import { wizardReducer, initialWizardState, type WizardState } from "./state";
import type { TmdbSearchResult } from "@/lib/tmdb/tmdb.functions";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import type { TorrentChoiceContext, CheckResult } from "./types";

const item = { id: 42, title: "Titlu", mediaType: "tv" } as unknown as TmdbSearchResult;
const torrent = (id: number) => ({ id, name: `T${id}`, seeders: id }) as unknown as FilelistTorrent;

const choice: TorrentChoiceContext = {
  label: "S01E01",
  season: 1,
  episode: 1,
  isSeasonPack: false,
  candidates: [torrent(1), torrent(2)],
};

const emptyCheck: CheckResult = {
  imdbId: null,
  originalTitle: "Titlu",
  plexFound: false,
  plexQualities: [],
  torrents: [],
  seasons: [],
};

// Ajunge la pasul de rezultat, ca punct de plecare pentru majoritatea testelor.
function atResult(): WizardState {
  let s = wizardReducer(initialWizardState, { type: "SELECT_ITEM", item });
  s = wizardReducer(s, {
    type: "CHECK_LOADED",
    payload: {
      checkResult: emptyCheck,
      tmdbDetails: null as never,
      seasonSchema: [],
      tvmazeAirstamps: [],
      plexBySeason: new Map(),
      downloadingEntries: [],
      wantedEntry: null,
    },
  });
  return s;
}

describe("navigarea între pași", () => {
  it("pornește la căutare", () => {
    expect(initialWizardState.flow.step).toBe("search");
  });

  it("alegerea unui titlu duce la verificare și golește eroarea precedentă", () => {
    const s = wizardReducer(
      { ...initialWizardState, checkError: "veche" },
      { type: "SELECT_ITEM", item },
    );
    expect(s.flow.step).toBe("checking");
    expect(s.selected).toBe(item);
    expect(s.checkError).toBeNull();
  });

  it("un titlu nou pornește de la 1080p, reîncercarea aceluiași titlu nu", () => {
    let s = wizardReducer(atResult(), { type: "SET_QUALITY", quality: "4K HDR" });
    s = wizardReducer(s, { type: "SELECT_ITEM", item });
    expect(s.quality).toBe("4K HDR");
    s = wizardReducer(s, { type: "SELECT_ITEM", item: { ...item, id: 43 } });
    expect(s.quality).toBe("1080p");
  });

  it("verificarea eșuată ajunge tot la rezultat, dar cu eroarea păstrată", () => {
    let s = wizardReducer(initialWizardState, { type: "SELECT_ITEM", item });
    s = wizardReducer(s, { type: "CHECK_FAILED", error: "TMDB pică", fallback: emptyCheck });
    expect(s.flow.step).toBe("result");
    expect(s.checkError).toBe("TMDB pică");
  });

  it("înapoi din rezultat golește subiectul, dar păstrează căutarea", () => {
    // Rezultatele căutării supraviețuiesc intenționat: te întorci ca să alegi
    // altceva din aceeași listă, nu ca să cauți de la zero.
    let s: WizardState = { ...atResult(), query: "matrix", results: [item] };
    s = wizardReducer(s, { type: "BACK" });
    expect(s.flow.step).toBe("search");
    expect(s.query).toBe("matrix");
    expect(s.results).toHaveLength(1);
    expect(s.selected).toBeNull();
    expect(s.checkResult).toBeNull();
    expect(s.checkError).toBeNull();
  });
});

// Bug-ul reparat în 3249390: pasul "confirm" putea exista fără țintă, ceea ce
// randa un dialog gol. Aici devine imposibil — ținta face parte din pas.
describe("confirmarea nu poate exista fără țintă", () => {
  it("deschiderea confirmării poartă mereu ținta", () => {
    const s = wizardReducer(atResult(), {
      type: "OPEN_CONFIRM",
      target: { torrent: torrent(1), label: "Film", isSeasonPack: false },
      back: { step: "result" },
    });
    expect(s.flow).toMatchObject({ step: "confirm", target: { torrent: torrent(1) } });
  });
});

// Înainte, `goBack` ghicea destinația: `setStep(torrentChoice ? "pick" : "result")`.
describe("înapoi din confirmare merge unde a promis", () => {
  it("se întoarce la alegerea de torrent, cu lista intactă", () => {
    let s = wizardReducer(atResult(), { type: "OPEN_PICK", choice, pickedTorrentId: 2 });
    s = wizardReducer(s, {
      type: "OPEN_CONFIRM",
      target: { torrent: torrent(2), label: choice.label, isSeasonPack: false },
      back: { step: "pick", choice, pickedTorrentId: 2 },
    });
    s = wizardReducer(s, { type: "BACK" });
    // Selecția rămâne, altfel te-ai întoarce la o listă care și-a uitat alegerea.
    expect(s.flow).toEqual({ step: "pick", choice, pickedTorrentId: 2 });
  });

  it("se întoarce la rezultat când confirmarea a venit direct de acolo", () => {
    let s = wizardReducer(atResult(), {
      type: "OPEN_CONFIRM",
      target: { torrent: torrent(1), label: "Film", isSeasonPack: false },
      back: { step: "result" },
    });
    s = wizardReducer(s, { type: "BACK" });
    expect(s.flow.step).toBe("result");
  });
});

// Bug-ul din 1e1b3fe: `reset()` enumera 19 setteri manual, iar o stare uitată
// acolo rămânea peste sesiuni — de exemplu `busy`, care bloca tot wizard-ul.
describe("resetarea nu poate uita nimic", () => {
  it("întoarce exact starea inițială, din orice pas", () => {
    let s = atResult();
    s = wizardReducer(s, { type: "SET_BUSY", busy: true });
    s = wizardReducer(s, { type: "DONE", message: "gata" });
    expect(wizardReducer(s, { type: "RESET" })).toEqual(initialWizardState);
  });
});

describe("alegerea manuală", () => {
  it("bifarea unui torrent rămâne în pasul de alegere", () => {
    let s = wizardReducer(atResult(), { type: "OPEN_PICK", choice, pickedTorrentId: 1 });
    s = wizardReducer(s, { type: "PICK_TORRENT", torrentId: 2 });
    expect(s.flow).toEqual({ step: "pick", choice, pickedTorrentId: 2 });
  });

  it("în afara pasului de alegere, bifarea nu face nimic", () => {
    const before = atResult();
    expect(wizardReducer(before, { type: "PICK_TORRENT", torrentId: 3 })).toBe(before);
  });
});

describe("căutarea", () => {
  it("sub două caractere golește rezultatele vechi", () => {
    const s = wizardReducer(
      { ...initialWizardState, results: [item] },
      {
        type: "QUERY_CHANGED",
        query: "a",
      },
    );
    expect(s.results).toEqual([]);
  });

  it("rezultatele sosite opresc indicatorul de căutare", () => {
    let s = wizardReducer(initialWizardState, { type: "SEARCH_STARTED" });
    expect(s.searching).toBe(true);
    s = wizardReducer(s, { type: "SEARCH_RESULTS", results: [item] });
    expect(s.searching).toBe(false);
    expect(s.results).toHaveLength(1);
  });
});
