// Starea wizard-ului de adăugare, într-un reducer.
//
// Înainte erau 22 de `useState` în componentă, cu două consecințe:
//
//  - `reset()` enumera manual 19 setteri, iar `goBack()` repeta un subset cu
//    altă listă. O stare nouă uitată în una din liste = un bug tăcut (vezi
//    1e1b3fe, wizard-ul deblocat în mijlocul unui lot).
//  - stări care logic nu pot coexista puteau coexista în tip: `confirmTorrent`
//    și `confirmBulk` deodată, sau pasul "confirm" fără nicio țintă — ecranul
//    gol reparat în 3249390.
//
// Aici, ce ține strict de un pas trăiește în varianta pasului (`Flow`), deci
// combinațiile alea nu mai sunt reprezentabile. Restul stării stă la nivelul
// de sus, pentru că NU e locală unui pas: subiectul verificării se încarcă o
// dată, la "checking", și e citit de "result", "pick" și "confirm" deopotrivă.
//
// Atenție la două lucruri care par locale și nu sunt:
//  - `pickedTorrentId` e folosit ȘI în "result" (selectorul de torrent pentru
//    filme, admin), ȘI în "pick". Îngropat în varianta "pick", ar strica
//    alegerea manuală la filme.
//  - căutarea (query/results) supraviețuiește intenționat întoarcerii la
//    pasul de căutare — de-asta nu stă în varianta "search".

import type { TmdbSearchResult, TmdbDetails, TmdbSeasonSchema } from "@/lib/tmdb/tmdb.functions";
import type { TvmazeAirstamp } from "@/lib/tvmaze/tvmaze.functions";
import type { DownloadingMediaEntry, WantedMovie } from "@/lib/media/media.functions";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import type {
  BulkDownloadItem,
  CheckResult,
  PlexSeasonEpisode,
  Quality,
  TorrentChoiceContext,
} from "./types";

// Ținta unei confirmări: ori un singur torrent, ori un lot. Nu pot fi ambele
// — de-asta e o uniune, nu două câmpuri.
export type ConfirmTarget =
  | {
      kind: "single";
      torrent: FilelistTorrent;
      label: string;
      season?: number;
      episode?: number;
      isSeasonPack: boolean;
    }
  | { kind: "bulk"; items: BulkDownloadItem[] };

// Pasul la care se întoarce săgeata de "înapoi" din confirmare. Memorat
// explicit, nu ghicit: varianta veche deducea destinația din faptul că
// `torrentChoice` mai era sau nu setat.
export type BackFlow = { step: "result" } | { step: "pick"; choice: TorrentChoiceContext };

export type Flow =
  | { step: "search" }
  | { step: "checking" }
  | { step: "result" }
  | { step: "pick"; choice: TorrentChoiceContext }
  | { step: "confirm"; target: ConfirmTarget; back: BackFlow }
  | { step: "done"; message: string };

export interface WizardState {
  flow: Flow;

  // Căutare — supraviețuiește întoarcerii la pasul de căutare.
  query: string;
  results: TmdbSearchResult[];
  searching: boolean;

  // Subiectul verificării: încărcat la "checking", citit până la "confirm".
  selected: TmdbSearchResult | null;
  checkResult: CheckResult | null;
  checkError: string | null;
  tmdbDetails: TmdbDetails | null;
  seasonSchema: TmdbSeasonSchema[];
  tvmazeAirstamps: TvmazeAirstamp[];
  plexBySeason: Map<number, PlexSeasonEpisode[]>;
  downloadingEntries: DownloadingMediaEntry[];
  wantedEntry: WantedMovie | null;

  // Traversează pașii.
  quality: Quality;
  pickedTorrentId: number | null;

  // Tranzitorii (în timpul unei descărcări).
  busy: boolean;
  downloadingTorrentId: number | null;
  bulkProgress: { done: number; total: number } | null;
}

export const initialWizardState: WizardState = {
  flow: { step: "search" },
  query: "",
  results: [],
  searching: false,
  selected: null,
  checkResult: null,
  checkError: null,
  tmdbDetails: null,
  seasonSchema: [],
  tvmazeAirstamps: [],
  plexBySeason: new Map(),
  downloadingEntries: [],
  wantedEntry: null,
  quality: "1080p",
  pickedTorrentId: null,
  busy: false,
  downloadingTorrentId: null,
  bulkProgress: null,
};

// Tot ce află `selectItem` într-o verificare reușită.
export interface CheckLoadedPayload {
  checkResult: CheckResult;
  tmdbDetails: TmdbDetails;
  seasonSchema: TmdbSeasonSchema[];
  tvmazeAirstamps: TvmazeAirstamp[];
  plexBySeason: Map<number, PlexSeasonEpisode[]>;
  downloadingEntries: DownloadingMediaEntry[];
  wantedEntry: WantedMovie | null;
}

export type WizardAction =
  | { type: "RESET" }
  | { type: "QUERY_CHANGED"; query: string }
  | { type: "SEARCH_STARTED" }
  | { type: "SEARCH_RESULTS"; results: TmdbSearchResult[] }
  | { type: "SELECT_ITEM"; item: TmdbSearchResult }
  | { type: "CHECK_LOADED"; payload: CheckLoadedPayload }
  | { type: "CHECK_FAILED"; error: string; fallback: CheckResult }
  | { type: "SET_QUALITY"; quality: Quality }
  | { type: "PICK_TORRENT"; torrentId: number }
  | { type: "OPEN_PICK"; choice: TorrentChoiceContext; pickedTorrentId: number }
  | { type: "OPEN_CONFIRM"; target: ConfirmTarget; back: BackFlow }
  | { type: "BACK" }
  | { type: "SET_BUSY"; busy: boolean }
  | { type: "SET_DOWNLOADING_TORRENT"; torrentId: number | null }
  | { type: "SET_BULK_PROGRESS"; progress: { done: number; total: number } | null }
  | { type: "SET_WANTED"; wanted: WantedMovie | null }
  | { type: "DONE"; message: string };

// Subiectul, golit — folosit la întoarcerea din "result" în căutare, unde
// rezultatele căutării rămân, dar tot ce ținea de titlul ales dispare.
const EMPTY_SUBJECT = {
  selected: null,
  checkResult: null,
  checkError: null,
  tmdbDetails: null,
  seasonSchema: [],
  tvmazeAirstamps: [],
  plexBySeason: new Map<number, PlexSeasonEpisode[]>(),
  downloadingEntries: [],
  wantedEntry: null,
  pickedTorrentId: null,
} satisfies Partial<WizardState>;

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "RESET":
      return initialWizardState;

    case "QUERY_CHANGED":
      // Sub două caractere nu se caută, deci rezultatele vechi ar rămâne pe
      // ecran fără legătură cu ce scrie acum în câmp.
      return {
        ...state,
        query: action.query,
        results: action.query.trim().length < 2 ? [] : state.results,
      };

    case "SEARCH_STARTED":
      return { ...state, searching: true };

    case "SEARCH_RESULTS":
      return { ...state, results: action.results, searching: false };

    case "SELECT_ITEM":
      return {
        ...state,
        selected: action.item,
        checkError: null,
        flow: { step: "checking" },
      };

    case "CHECK_LOADED":
      return { ...state, ...action.payload, checkError: null, flow: { step: "result" } };

    case "CHECK_FAILED":
      return {
        ...state,
        checkError: action.error,
        checkResult: action.fallback,
        flow: { step: "result" },
      };

    case "SET_QUALITY":
      // Alegerea manuală de torrent e legată de o listă de candidați la o
      // anumită calitate; dacă se schimbă calitatea, lista se schimbă și
      // alegerea veche nu mai are sens (cade înapoi pe "cel mai bun").
      return { ...state, quality: action.quality, pickedTorrentId: null };

    case "PICK_TORRENT":
      return { ...state, pickedTorrentId: action.torrentId };

    case "OPEN_PICK":
      return {
        ...state,
        pickedTorrentId: action.pickedTorrentId,
        flow: { step: "pick", choice: action.choice },
      };

    case "OPEN_CONFIRM":
      return { ...state, flow: { step: "confirm", target: action.target, back: action.back } };

    case "BACK":
      switch (state.flow.step) {
        // Destinația e memorată în `back`, deci întoarcerea din confirmare
        // regăsește exact lista de candidați din care venise.
        case "confirm":
          return { ...state, flow: state.flow.back };
        case "pick":
          return { ...state, flow: { step: "result" } };
        case "result":
          return { ...state, ...EMPTY_SUBJECT, flow: { step: "search" } };
        default:
          return state;
      }

    case "SET_BUSY":
      return { ...state, busy: action.busy };

    case "SET_DOWNLOADING_TORRENT":
      return { ...state, downloadingTorrentId: action.torrentId };

    case "SET_BULK_PROGRESS":
      return { ...state, bulkProgress: action.progress };

    case "SET_WANTED":
      return { ...state, wantedEntry: action.wanted };

    case "DONE":
      return { ...state, flow: { step: "done", message: action.message } };
  }
}
