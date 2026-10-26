// ---------------------------------------------------------------------------
// Jurnalul reîmprospătării metadatelor (seriale, episoade, filme). Înainte se
// vedea doar în journalctl, ca număr — un bug din 26 sept. 2026 (episoadele
// serialelor urmărite nu se mai reîmprospătau) a stat nedescoperit de-asta.
//
// O rulare = o intrare, scrisă doar cu schimbări reale sau titluri eșuate
// (rulările „nimic nou”, ~50/zi, împingeau afară ce conta). Schimbările se
// compară valoare cu valoare: SQLite numără ca modificat și un rând rescris
// cu aceleași valori.
// ---------------------------------------------------------------------------

import { pluralRo } from "../format";

export interface MetaTitleChange {
  title: string;
  kind: "show" | "movie";
  // Câmpurile titlului, gata formatate („poster”, „titlu „A” → „B””).
  fields: string[];
  // Câte o linie per episod schimbat („S10E1: nume „A” → „B”, descriere”).
  episodes: string[];
}

export interface MetaReport {
  shows: number;
  movies: number;
  failed: number;
  changes: MetaTitleChange[];
}

export function newMetaReport(): MetaReport {
  return { shows: 0, movies: 0, failed: 0, changes: [] };
}

type Row = Record<string, unknown>;

// Diferențele dintre două citiri ale aceluiași rând. `verbose`: coloanele la
// care arătăm și valorile; la descrieri și postere, doar faptul schimbării.
export function diffFields(
  before: Row | undefined,
  after: Row | undefined,
  labels: Record<string, string>,
  verbose: string[] = [],
): string[] {
  if (!before || !after) return [];
  const out: string[] = [];
  for (const [col, label] of Object.entries(labels)) {
    const a = before[col] ?? null;
    const b = after[col] ?? null;
    if (a === b) continue;
    if (verbose.includes(col)) {
      out.push(`${label} ${a == null ? "—" : `„${a}”`} → ${b == null ? "—" : `„${b}”`}`);
    } else {
      out.push(label);
    }
  }
  return out;
}

export const SHOW_FIELDS: Record<string, string> = {
  title: "titlu",
  original_title: "titlu original",
  year: "an",
  overview_ro: "descriere",
  genres: "genuri",
  poster_path: "poster",
  tv_status: "status",
  next_episode: "următorul episod",
};

export const MOVIE_FIELDS: Record<string, string> = {
  title: "titlu",
  original_title: "titlu original",
  year: "an",
  overview_ro: "descriere",
  genres: "genuri",
  poster_path: "poster",
};

export const EPISODE_FIELDS: Record<string, string> = {
  episode_title: "nume",
  episode_overview: "descriere",
  episode_still: "cadru",
  episode_air_date: "dată difuzare",
  poster_path: "poster sezon",
};

export function buildMetaRefreshMessage(r: MetaReport): string {
  const done = [
    r.shows > 0 && pluralRo(r.shows, "serial", "seriale"),
    r.movies > 0 && pluralRo(r.movies, "film", "filme"),
  ].filter(Boolean);
  const parts: string[] = [];
  if (done.length > 0) {
    const eps = r.changes.reduce((n, c) => n + c.episodes.length, 0);
    const changed =
      r.changes.length === 0
        ? "nimic nou"
        : `schimbări la ${pluralRo(r.changes.length, "titlu", "titluri")}` +
          (eps > 0 ? ` (${pluralRo(eps, "episod", "episoade")})` : "");
    parts.push(`${done.join(", ")} · ${changed}`);
  }
  if (r.failed > 0) parts.push(`${r.failed} ${r.failed === 1 ? "eșuat" : "eșuate"}`);
  return `Metadate: ${parts.join(" · ")}`;
}

// A adus rularea ceva de arătat? Schimbări reale sau titluri eșuate.
export function hasMetaNews(r: MetaReport): boolean {
  return r.changes.length > 0 || r.failed > 0;
}

export async function logMetaReport(r: MetaReport): Promise<void> {
  if (!hasMetaNews(r)) return;
  const { logActivity } = await import("../activity-log");
  await logActivity("metadata_refresh", buildMetaRefreshMessage(r), {
    shows: r.shows,
    movies: r.movies,
    failed: r.failed,
    // Obiecte plate (ActivityMetaValue): listele devin text pe linii.
    items: r.changes.map((c) => ({
      title: c.title,
      kind: c.kind,
      fields: c.fields.join(", "),
      episodes: c.episodes.join("\n"),
    })),
  });
}

// Episoadele mai vechi actualizate după o descărcare (syncAndLogEpisodeDetails)
// — aceeași formă ca o rulare de 12h, scrisă doar cu schimbări.
export function buildEpisodeUpdateMessage(title: string, episodes: number): string {
  return `Metadate: ${title} · ${pluralRo(episodes, "episod actualizat", "episoade actualizate")}`;
}

export async function logEpisodeUpdates(title: string, episodes: string[]): Promise<void> {
  if (episodes.length === 0) return;
  const { logActivity } = await import("../activity-log");
  await logActivity("metadata_refresh", buildEpisodeUpdateMessage(title, episodes.length), {
    shows: 0,
    movies: 0,
    failed: 0,
    items: [{ title, kind: "show", fields: "", episodes: episodes.join("\n") }],
  });
}
