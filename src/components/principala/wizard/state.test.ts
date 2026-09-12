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
  plexQuality: null,
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
      target: { kind: "single", torrent: torrent(1), label: "Film", isSeasonPack: false },
      back: { step: "result" },
    });
    expect(s.flow).toMatchObject({ step: "confirm", target: { kind: "single" } });
  });

  it("ținta e ori un torrent, ori un lot — niciodată amândouă", () => {
    const s = wizardReducer(atResult(), {
      type: "OPEN_CONFIRM",
      target: { kind: "bulk", items: [] },
      back: { step: "result" },
    });
    if (s.flow.step !== "confirm") throw new Error("ar fi trebuit să fie la confirmare");
    expect(s.flow.target.kind).toBe("bulk");
    // Uniunea garantează că un `target` de tip bulk n-are câmp `torrent`.
    expect("torrent" in s.flow.target).toBe(false);
  });
});

// Înainte, `goBack` ghicea destinația: `setStep(torrentChoice ? "pick" : "result")`.
describe("înapoi din confirmare merge unde a promis", () => {
  it("se întoarce la alegerea de torrent, cu lista intactă", () => {
    let s = wizardReducer(atResult(), { type: "OPEN_PICK", choice, pickedTorrentId: 2 });
    s = wizardReducer(s, {
      type: "OPEN_CONFIRM",
      target: { kind: "single", torrent: torrent(2), label: choice.label, isSeasonPack: false },
      back: { step: "pick", choice },
    });
    s = wizardReducer(s, { type: "BACK" });
    expect(s.flow).toEqual({ step: "pick", choice });
    // Selecția rămâne, altfel te-ai întoarce la o listă care și-a uitat alegerea.
    expect(s.pickedTorrentId).toBe(2);
  });

  it("se întoarce la rezultat când confirmarea a venit direct de acolo", () => {
    let s = wizardReducer(atResult(), {
      type: "OPEN_CONFIRM",
      target: { kind: "bulk", items: [] },
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
    s = wizardReducer(s, { type: "SET_BULK_PROGRESS", progress: { done: 3, total: 9 } });
    s = wizardReducer(s, { type: "DONE", message: "gata" });
    expect(wizardReducer(s, { type: "RESET" })).toEqual(initialWizardState);
  });
});

describe("calitate și alegere manuală", () => {
  it("schimbarea calității anulează torrentul ales", () => {
    // Lista de candidați se schimbă odată cu calitatea, deci un id ales
    // dintr-o listă veche ar indica un torrent care nu mai e pe ecran.
    let s: WizardState = { ...atResult(), pickedTorrentId: 7 };
    s = wizardReducer(s, { type: "SET_QUALITY", quality: "4K" });
    expect(s.quality).toBe("4K");
    expect(s.pickedTorrentId).toBeNull();
  });

  it("alegerea unui torrent nu schimbă pasul", () => {
    const s = wizardReducer(atResult(), { type: "PICK_TORRENT", torrentId: 3 });
    expect(s.flow.step).toBe("result");
    expect(s.pickedTorrentId).toBe(3);
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
