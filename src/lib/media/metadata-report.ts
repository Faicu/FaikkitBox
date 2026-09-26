// ---------------------------------------------------------------------------
// Jurnalul reîmprospătării metadatelor (seriale, episoade, filme).
//
// Până acum reîmprospătarea de 12h lăsa urme doar în journalctl, ca număr
// („pentru 9 seriale”), deci din aplicație nu se vedea nici când a rulat,
// nici ce a adus. Bug-ul din 26 sept. 2026 (serialele urmărite nu mai primeau
// deloc reîmprospătarea episoadelor) a stat nedescoperit tocmai de-asta.
//
// O rulare = o intrare în jurnal, scrisă doar dacă a fost ceva scadent.
// „Ce s-a schimbat” e comparat explicit, valoare cu valoare, înainte și după:
// SQLite numără un rând ca modificat și când valorile scrise sunt identice,
// deci `changes` n-ar deosebi „nimic nou” de o schimbare reală.
// ---------------------------------------------------------------------------

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

// Diferențele dintre două citiri ale aceluiași rând. `verbose`: coloanele
// scurte la care arătăm și valorile (titluri, nume) — la descrieri sau
// postere, doar faptul că s-au schimbat.
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

// „1 film”, „2 filme”, „58 de filme” — de la 20 în sus, cu „de”.
function plural(n: number, one: string, many: string): string {
  if (n === 1) return `1 ${one}`;
  const rest = n % 100;
  return n >= 20 && (rest === 0 || rest >= 20) ? `${n} de ${many}` : `${n} ${many}`;
}

export function buildMetaRefreshMessage(r: MetaReport): string {
  const done = [
    r.shows > 0 && plural(r.shows, "serial", "seriale"),
    r.movies > 0 && plural(r.movies, "film", "filme"),
  ].filter(Boolean);
  const parts: string[] = [];
  if (done.length > 0) {
    const eps = r.changes.reduce((n, c) => n + c.episodes.length, 0);
    const changed =
      r.changes.length === 0
        ? "nimic nou"
        : `schimbări la ${plural(r.changes.length, "titlu", "titluri")}` +
          (eps > 0 ? ` (${plural(eps, "episod", "episoade")})` : "");
    parts.push(`${done.join(", ")} · ${changed}`);
  }
  if (r.failed > 0) parts.push(`${r.failed} ${r.failed === 1 ? "eșuat" : "eșuate"}`);
  return `Metadate: ${parts.join(" · ")}`;
}

export async function logMetaReport(r: MetaReport): Promise<void> {
  if (r.shows + r.movies + r.failed === 0) return;
  const { logActivity } = await import("../activity-log");
  await logActivity("metadata_refresh", buildMetaRefreshMessage(r), {
    shows: r.shows,
    movies: r.movies,
    failed: r.failed,
    // Obiecte plate (vezi ActivityMetaValue): listele devin text pe linii.
    items: r.changes.map((c) => ({
      title: c.title,
      kind: c.kind,
      fields: c.fields.join(", "),
      episodes: c.episodes.join("\n"),
    })),
  });
}
