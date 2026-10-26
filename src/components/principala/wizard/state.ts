// Starea wizard-ului, într-un reducer. Cu 22 de `useState`, reset() și goBack()
// enumerau manual setteri (o stare uitată = bug tăcut, 1e1b3fe), iar stări
// imposibile erau reprezentabile (pasul „confirm” fără țintă, 3249390).
//
// Ce ține de un pas stă în varianta lui (`Flow`). Subiectul verificării e la
// nivelul de sus (citit de mai mulți pași), la fel căutarea — supraviețuiește
// intenționat întoarcerii la ea.

import type { TmdbSearchResult, TmdbDetails, TmdbSeasonSchema } from "@/lib/tmdb/tmdb.functions";
import type { TvmazeAirstamp } from "@/lib/tvmaze/tvmaze.functions";
import type { DownloadingMediaEntry, WantedMovie } from "@/lib/media/media.functions";
import type { FilelistTorrent } from "@/lib/filelist.functions";
import type { CheckResult, PlexSeasonEpisode, Quality, TorrentChoiceContext } from "./types";

// Ținta unei confirmări: un singur torrent — film, episod sau sezon întreg.
export interface ConfirmTarget {
  torrent: FilelistTorrent;
  label: string;
  season?: number;
  episode?: number;
  isSeasonPack: boolean;
}

// Alegerea manuală (admin): lista de candidați și torrentul bifat.
export type PickFlow = { step: "pick"; choice: TorrentChoiceContext; pickedTorrentId: number };

// Pasul la care duce „înapoi” din confirmare, cu torrentul bifat — lista se
// regăsește exact cum ai lăsat-o.
export type BackFlow = { step: "result" } | PickFlow;

export type Flow =
  | { step: "search" }
  | { step: "checking" }
  | { step: "result" }
  | PickFlow
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

  // Traversează pașii. Calitatea revine la 1080p la fiecare titlu nou.
  quality: Quality;

  // În timpul unei descărcări sau al pornirii/opririi urmăririi.
  busy: boolean;
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
  busy: false,
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
  | { type: "DECLINE_HDR"; quality: Quality }
  | { type: "PICK_TORRENT"; torrentId: number }
  | { type: "OPEN_PICK"; choice: TorrentChoiceContext; pickedTorrentId: number }
  | { type: "OPEN_CONFIRM"; target: ConfirmTarget; back: BackFlow }
  | { type: "BACK" }
  | { type: "SET_BUSY"; busy: boolean }
  | { type: "SET_WANTED"; wanted: WantedMovie | null }
  | { type: "DONE"; message: string };

// Subiectul golit — la întoarcerea în căutare rezultatele rămân, titlul ales nu.
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
} satisfies Partial<WizardState>;

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "RESET":
      return initialWizardState;

    case "QUERY_CHANGED":
      // Sub două caractere nu se caută — rezultatele vechi n-ar avea legătură
      // cu câmpul.
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
        // Același titlu își păstrează calitatea; unul nou pornește de la 1080p.
        quality:
          state.selected?.id === action.item.id &&
          state.selected.mediaType === action.item.mediaType
            ? state.quality
            : initialWizardState.quality,
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
      return { ...state, quality: action.quality };

    // „Nu” la întrebarea HDR: înapoi la selector, pe varianta fără HDR (lista de
    // candidați e tot HDR).
    case "DECLINE_HDR":
      return { ...state, quality: action.quality, flow: { step: "result" } };

    case "PICK_TORRENT":
      if (state.flow.step !== "pick") return state;
      return { ...state, flow: { ...state.flow, pickedTorrentId: action.torrentId } };

    case "OPEN_PICK":
      return {
        ...state,
        flow: { step: "pick", choice: action.choice, pickedTorrentId: action.pickedTorrentId },
      };

    case "OPEN_CONFIRM":
      return { ...state, flow: { step: "confirm", target: action.target, back: action.back } };

    case "BACK":
      switch (state.flow.step) {
        // Întoarcerea din confirmare regăsește lista din `back`.
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

    case "SET_WANTED":
      return { ...state, wantedEntry: action.wanted };

    case "DONE":
      return { ...state, flow: { step: "done", message: action.message } };
  }
}
