// ---------------------------------------------------------------------------
// Tip + constante pentru rezultatele ensureRomanianSubtitle (subtitles.ts).
// Fișier "curat" — fără node:child_process/node:fs/iconv — ca să poată fi
// importat static și din componente client (SubtitleFixDrawer.tsx), nu doar
// din subtitles.ts (server-only, dinamic din cauza dependințelor Node).
// ---------------------------------------------------------------------------

export type SubtitleOutcome =
  | "already_embedded"
  | "srt_already_ok"
  | "renamed_srt"
  | "reencoded_srt"
  | "downloaded_opensubtitles"
  | "downloaded_opensubtitles_approximate"
  | "multiple_srt_skipped"
  | "season_pack_skipped"
  | "no_imdb"
  | "no_subtitle_found"
  | "download_failed"
  | "no_media_file";

// Outcome-uri care au schimbat efectiv ceva pe disk — folosite de
// backfillSubtitles ca să știe pentru ce categorii (filme/seriale) trebuie
// declanșat refresh Plex, și de UI (SubtitleFixDrawer) pentru gruparea
// "corectate" cu iconiță verde.
export const CORRECTED_OUTCOMES: SubtitleOutcome[] = [
  "renamed_srt",
  "reencoded_srt",
  "downloaded_opensubtitles",
  "downloaded_opensubtitles_approximate",
];

// Outcome-uri "nimic de făcut" — subtitrarea era deja corectă. Folosite și
// pentru a decide când NU trimitem notificare push la o descărcare unică
// (logSubtitleRun) — utilizatorul nu vrea push când n-a fost nevoie de nicio
// intervenție.
export const OK_OUTCOMES: SubtitleOutcome[] = ["already_embedded", "srt_already_ok"];

export const APPROXIMATE_OUTCOMES: SubtitleOutcome[] = ["downloaded_opensubtitles_approximate"];

// Etichetă scurtă per outcome — folosită pentru linia din Jurnal Activități
// și corpul notificării push la o descărcare unică (rezumatul complet, cu
// nume de fișiere, rămâne doar în drawer-ul de detalii, nu în mesajul scurt).
export const SHORT_LABELS: Record<SubtitleOutcome, string> = {
  already_embedded: "are deja subtitrare română încorporată",
  srt_already_ok: "avea deja .srt corect denumit și codat",
  renamed_srt: "subtitrare corectată (.srt redenumit pentru Plex)",
  reencoded_srt: "subtitrare corectată (encoding UTF-8)",
  downloaded_opensubtitles: "subtitrare descărcată de pe OpenSubtitles",
  downloaded_opensubtitles_approximate: "subtitrare aproximativă descărcată — verifică sincronizarea",
  multiple_srt_skipped: "mai multe .srt găsite, am sărit peste",
  season_pack_skipped: "pachet de episoade, am sărit peste",
  no_imdb: "fără subtitrare și fără IMDb id pentru căutare",
  no_subtitle_found: "nicio subtitrare găsită pe OpenSubtitles",
  download_failed: "eroare la corectarea subtitrării",
  no_media_file: "niciun fișier media găsit în torrent",
};
