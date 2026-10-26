// Tipuri și constante pentru rezultatele ensureRomanianSubtitle — fără module
// Node, ca să poată fi importat și din client (SubtitleFixDrawer).

export type SubtitleOutcome =
  | "already_embedded"
  | "audio_already_romanian"
  | "srt_already_ok"
  | "renamed_srt"
  | "reencoded_srt"
  | "downloaded"
  | "downloaded_approximate"
  | "multiple_srt_skipped"
  | "season_pack_skipped"
  | "no_imdb"
  | "no_subtitle_found"
  | "download_failed"
  | "no_media_file"
  // Pachet de episoade: un singur item per torrent, cu detaliu per episod.
  | "season_corrected"
  | "season_already_ok"
  | "season_no_subtitle_found";

// Au schimbat ceva pe disc — refresh Plex și gruparea „corectate” din UI.
export const CORRECTED_OUTCOMES: SubtitleOutcome[] = [
  "renamed_srt",
  "reencoded_srt",
  "downloaded",
  "downloaded_approximate",
  "season_corrected",
];

// „Nimic de făcut” — fără push la o descărcare unică.
export const OK_OUTCOMES: SubtitleOutcome[] = [
  "already_embedded",
  "audio_already_romanian",
  "srt_already_ok",
  "season_already_ok",
];

export const APPROXIMATE_OUTCOMES: SubtitleOutcome[] = ["downloaded_approximate"];

// Eticheta scurtă din jurnal și push (detaliul complet e în drawer).
export const SHORT_LABELS: Record<SubtitleOutcome, string> = {
  already_embedded: "are deja subtitrare română încorporată",
  audio_already_romanian: "conținut audio deja în română — nu necesită subtitrare",
  srt_already_ok: "avea deja .srt corect denumit și codat",
  renamed_srt: "subtitrare corectată (.srt redenumit pentru Plex)",
  reencoded_srt: "subtitrare corectată (encoding UTF-8)",
  downloaded: "subtitrare descărcată automat",
  downloaded_approximate: "subtitrare aproximativă descărcată — verifică sincronizarea",
  multiple_srt_skipped: "mai multe .srt găsite, am sărit peste",
  season_pack_skipped: "pachet de episoade, am sărit peste",
  no_imdb: "fără subtitrare și fără IMDb id pentru căutare",
  no_subtitle_found: "nicio subtitrare găsită pe OpenSubtitles sau subs.ro",
  download_failed: "eroare la corectarea subtitrării",
  no_media_file: "niciun fișier media găsit în torrent",
  season_corrected: "subtitrări corectate pentru sezon (vezi detalii per episod)",
  season_already_ok: "toate episoadele au deja subtitrare corectă",
  season_no_subtitle_found: "unele episoade fără subtitrare găsită (vezi detalii)",
};

// Sursa externă a subtitrării descărcate (outcome-ul nu o mai spune).
export type SubtitleSource = "opensubtitles" | "subsro";

// Zilele în care reîncercarea caută zilnic; aici, ca s-o vadă și clientul.
export const SUBTITLE_RETRY_DAYS = 14;

// Sincronizarea măsurată față de subtitrarea încorporată (calculată în
// subtitle-verify.ts; aici doar se afișează).
export interface SubtitleSync {
  score: number;
  offset: number;
  good: boolean;
}

// O variantă găsită, dar nefolosită — afișată în jurnal sub „Respinse".
export interface RejectedVariant {
  source: SubtitleSource;
  release: string;
  reason: string;
}

// Ce s-a întâmplat cu subtitrarea unui fișier, pentru jurnalul structurat.
// Salvat „plat” în meta, de-asta sincronizarea e desfăcută în trei câmpuri.
export interface SubtitleFileReport {
  // Torrentul din care face parte.
  torrent: string;
  // „S01E03" la episoade, null la filme.
  episode: string | null;
  outcome: SubtitleOutcome;
  // Varianta aleasă (doar la descărcări).
  source: SubtitleSource | null;
  release: string | null;
  matchedCriteria: number | null;
  maxCriteria: number | null;
  syncScore: number | null;
  syncOffset: number | null;
  syncGood: boolean | null;
  // Câte variante au fost comparate după sincronizare.
  compared: number | null;
  // Motivul pentru care .srt-ul de dinainte a fost mutat deoparte.
  movedAside: string | null;
  // A înlocuit o subtitrare „aproximativă" (reîncercarea zilnică).
  replacedApproximate: boolean;
}

export interface SubtitleRejectionReport extends RejectedVariant {
  torrent: string;
  episode: string | null;
}

// Raportul unui fișier, din `media.subtitle_report`.
export interface FileSubtitleReport {
  file: SubtitleFileReport;
  rejected: SubtitleRejectionReport[];
}

export const SUBTITLE_SOURCE_LABELS: Record<SubtitleSource, string> = {
  opensubtitles: "OpenSubtitles",
  subsro: "subs.ro",
};

// Eticheta pentru jurnal/push. La descărcări: sursa reală și cât de bine se
// potrivește — după asta decide cititorul dacă verifică sincronizarea.
export function shortLabelFor(
  outcome: SubtitleOutcome,
  info?: {
    source?: SubtitleSource | null;
    matchedCriteria?: number | null;
    maxCriteria?: number | null;
    sync?: SubtitleSync | null;
  },
): string {
  const isDownload = outcome === "downloaded" || outcome === "downloaded_approximate";
  if (!isDownload) return SHORT_LABELS[outcome];

  const sourceNote = info?.source ? ` de pe ${SUBTITLE_SOURCE_LABELS[info.source]}` : "";
  // Cu sincronizarea măsurată, ea spune cât de bună e subtitrarea — The Invite
  // apărea „(1/5)” deși era perfect sincronizată.
  if (info?.sync) {
    return info.sync.good
      ? `subtitrare descărcată${sourceNote} (sincronizare verificată)`
      : `subtitrare aproximativă descărcată${sourceNote} (decalaj ~${Math.abs(info.sync.offset).toFixed(1).replace(".", ",")} s) — verifică sincronizarea`;
  }
  const { matchedCriteria: matched, maxCriteria: max } = info ?? {};
  const matchNote =
    matched != null && max != null && max > 0
      ? ` (${matched}/${max}${matched === max ? " — potrivire perfectă" : ""})`
      : "";

  return outcome === "downloaded"
    ? `subtitrare descărcată${sourceNote}${matchNote}`
    : `subtitrare aproximativă descărcată${sourceNote}${matchNote} — verifică sincronizarea`;
}

// Eticheta pentru `media.subtitle_source` (în DB sunt slug-uri).
export const SUBTITLE_SOURCE_DISPLAY: Record<string, string> = {
  opensubtitles: "OpenSubtitles",
  subsro: "subs.ro",
  embedded: "încorporată în fișier",
  audio_ro: "audio în română",
  tracked_srt: ".srt din torrent",
  season_aggregate: "per episod (pachet de sezon)",
};

export function subtitleSourceDisplay(source: string): string {
  return SUBTITLE_SOURCE_DISPLAY[source] ?? source;
}
