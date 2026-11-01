// Tipuri și constante pentru rezultatele ensureRomanianSubtitle — fără module
// Node, ca să poată fi importat și din client (SubtitleFixDrawer).

export type SubtitleOutcome =
  | "already_embedded"
  | "audio_already_romanian"
  | "srt_already_ok"
  | "renamed_srt"
  | "reencoded_srt"
  // .srt-ul existent, cu timpii corectați (viteză/decalaj).
  | "retimed_srt"
  | "downloaded"
  | "downloaded_approximate"
  // Subtitrarea aproximativă rămâne: nicio variantă sigur mai bună.
  | "approximate_kept"
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
  "retimed_srt",
  "downloaded",
  "downloaded_approximate",
  "season_corrected",
];

// „Nimic de făcut” — fără push la o descărcare unică.
export const OK_OUTCOMES: SubtitleOutcome[] = [
  "already_embedded",
  "audio_already_romanian",
  "srt_already_ok",
  "approximate_kept",
  "season_already_ok",
];

// Cu subtitrare, dar de verificat (iconiță galbenă).
export const APPROXIMATE_OUTCOMES: SubtitleOutcome[] = [
  "downloaded_approximate",
  "approximate_kept",
];

// Eticheta scurtă din jurnal și push (detaliul complet e în drawer).
export const SHORT_LABELS: Record<SubtitleOutcome, string> = {
  already_embedded: "are deja subtitrare română încorporată",
  audio_already_romanian: "conținut audio deja în română — nu necesită subtitrare",
  srt_already_ok: "avea deja .srt corect denumit și codat",
  renamed_srt: "subtitrare corectată (.srt redenumit pentru Plex)",
  reencoded_srt: "subtitrare corectată (encoding UTF-8)",
  retimed_srt: "subtitrare resincronizată (timpi corectați)",
  downloaded: "subtitrare descărcată automat",
  downloaded_approximate: "subtitrare aproximativă descărcată — verifică sincronizarea",
  approximate_kept: "subtitrarea aproximativă rămâne — nicio variantă mai bună",
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
  // Corecția timpilor aplicată („24 → 23,976 fps, −3,5 s”).
  retime?: string;
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
  // Corecția timpilor aplicată; lipsește la rapoartele de dinainte de 1 nov. 2026.
  syncRetime?: string | null;
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
    const retimed = info.sync.retime ? ", timpi corectați" : "";
    return info.sync.good
      ? `subtitrare descărcată${sourceNote} (sincronizare verificată${retimed})`
      : `subtitrare aproximativă descărcată${sourceNote} (${syncProblem(info.sync)}${retimed}) — verifică sincronizarea`;
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

// Numerele în formatul românesc („0,86”).
export const formatSubtitleNumber = (n: number, digits = 2) => n.toFixed(digits).replace(".", ",");

// Ce nu e sigur la o sincronizare nebifată: decalajul, sau, fără decalaj
// (de exemplu după corecție), corelația prea mică. 0,5 s = pragul din
// subtitle-verify.ts (GOOD_SYNC_MAX_OFFSET_S).
export function syncProblem(sync: { score: number; offset: number }): string {
  return Math.abs(sync.offset) > 0.5
    ? `decalaj ~${formatSubtitleNumber(Math.abs(sync.offset), 1)} s`
    : `sincronizare incertă, ${formatSubtitleNumber(sync.score)}`;
}

// Titlul rezultatului unui fișier, același în drawer-ul tehnic, Bibliotecă și
// toast-ul butonului. „Nicio subtitrare găsită” ar fi înșelător când au existat
// variante, dar toate au fost respinse.
export function subtitleHeadline(outcome: SubtitleOutcome, rejectedCount = 0): string {
  if (outcome === "downloaded") return "Subtitrare descărcată";
  if (outcome === "no_subtitle_found" && rejectedCount > 0) return "Nicio variantă potrivită";
  if (outcome === "downloaded_approximate")
    return "Subtitrare aproximativă — verifică sincronizarea";
  const label = SHORT_LABELS[outcome] ?? outcome;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Tonul rezultatului: corectat, de verificat, nimic de făcut, eșuat.
export function subtitleOutcomeTone(outcome: SubtitleOutcome): "good" | "warn" | "ok" | "bad" {
  if (APPROXIMATE_OUTCOMES.includes(outcome) || outcome === "season_no_subtitle_found")
    return "warn";
  if (CORRECTED_OUTCOMES.includes(outcome)) return "good";
  if (OK_OUTCOMES.includes(outcome)) return "ok";
  return "bad";
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
