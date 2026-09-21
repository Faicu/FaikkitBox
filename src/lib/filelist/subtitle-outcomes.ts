// ---------------------------------------------------------------------------
// Tip + constante pentru rezultatele ensureRomanianSubtitle (subtitles.ts).
// Fișier "curat" — fără node:child_process/node:fs/iconv — ca să poată fi
// importat static și din componente client (SubtitleFixDrawer.tsx), nu doar
// din subtitles.ts (server-only, dinamic din cauza dependințelor Node).
// ---------------------------------------------------------------------------

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
  // Rezultate agregate pentru un pachet de episoade (season pack) — un
  // singur SubtitleRunItem per torrent, cu detaliu per episod în `detail`.
  | "season_corrected"
  | "season_already_ok"
  | "season_no_subtitle_found";

// Outcome-uri care au schimbat efectiv ceva pe disk — folosite ca să știe
// dacă trebuie declanșat refresh Plex, și de UI (SubtitleFixDrawer) pentru
// gruparea "corectate" cu iconiță verde.
export const CORRECTED_OUTCOMES: SubtitleOutcome[] = [
  "renamed_srt",
  "reencoded_srt",
  "downloaded",
  "downloaded_approximate",
  "season_corrected",
];

// Outcome-uri "nimic de făcut" — subtitrarea era deja corectă. Folosite și
// pentru a decide când NU trimitem notificare push la o descărcare unică
// (logSubtitleRun) — utilizatorul nu vrea push când n-a fost nevoie de nicio
// intervenție.
export const OK_OUTCOMES: SubtitleOutcome[] = [
  "already_embedded",
  "audio_already_romanian",
  "srt_already_ok",
  "season_already_ok",
];

export const APPROXIMATE_OUTCOMES: SubtitleOutcome[] = ["downloaded_approximate"];

// Etichetă scurtă per outcome — folosită pentru linia din Jurnal Activități
// și corpul notificării push la o descărcare unică (rezumatul complet, cu
// nume de fișiere, rămâne doar în drawer-ul de detalii, nu în mesajul scurt).
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

// Sursa externă de la care a venit subtitrarea descărcată. Outcome-ul nu o
// mai spune (se numea `downloaded_opensubtitles` de pe vremea când
// OpenSubtitles era singura sursă — redenumit la migrarea v29) — câmpul ăsta
// e singurul care o zice.
export type SubtitleSource = "opensubtitles" | "subsro";

export const SUBTITLE_SOURCE_LABELS: Record<SubtitleSource, string> = {
  opensubtitles: "OpenSubtitles",
  subsro: "subs.ro",
};

// Eticheta scurtă pentru jurnal/push. Pentru descărcări o compunem cu sursa
// reală, ca să nu contrazică detaliul (care o conține dintotdeauna); fără
// sursă cunoscută (înregistrări vechi) rămâne eticheta statică.
export function shortLabelFor(outcome: SubtitleOutcome, source?: SubtitleSource | null): string {
  if (!source) return SHORT_LABELS[outcome];
  const label = SUBTITLE_SOURCE_LABELS[source];
  if (outcome === "downloaded") return `subtitrare descărcată de pe ${label}`;
  if (outcome === "downloaded_approximate")
    return `subtitrare aproximativă descărcată de pe ${label} — verifică sincronizarea`;
  return SHORT_LABELS[outcome];
}

// Eticheta afișată pentru `media.subtitle_source` (Bibliotecă → detalii
// tehnice). Valorile din DB sunt slug-uri, nu text pentru ochi.
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
