// ---------------------------------------------------------------------------
// Urmărirea serialelor: descărcarea automată a episoadelor noi.
//
// Declarativă, nu diferențială: TMDB spune ce s-a difuzat, `media` spune ce
// avem, diferența se descarcă. Rularea e idempotentă — se reia oricând, se
// repară singură după restart, nu ratează nimic dacă un ciclu pică și nu
// descarcă de două ori. Starea stă în coloanele `auto_download*`/`watch_*` ale
// rândului-serial din `media`.
//
// Prima încercare (pinned-watcher.ts, tabele pinned_*, scoase în 1599c9e)
// ținea „ce am văzut ultima dată” într-o structură paralelă: rata primul
// episod, se strica la restart și pierdea definitiv episoadele unui ciclu picat.
// ---------------------------------------------------------------------------

import { airedEpisodeKeys } from "./aired-episodes";
import {
  effectiveFallback,
  fallbackReady,
  parseFallbackSeen,
  type FallbackSeen,
} from "./fallback-quality";
import { compareTorrents, isExcludedTorrent } from "./torrent-rank";
import { advancedWatchFrom, type EpisodeKey } from "./watch-position";
import { getDb } from "../db";
import {
  diffFields,
  EPISODE_FIELDS,
  logEpisodeUpdates,
  SHOW_FIELDS,
  type MetaReport,
} from "./metadata-report";

const ITEM_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 ore — cadența reală per serial
// În ziua episodului următor sau a ultimului difuzat ±1 zi, verificarea e
// orară — torrentul apare de obicei în primele ore. Ultimul difuzat contează
// fiindcă TMDB mută next_episode imediat după difuzare.
const RELEASE_WINDOW_INTERVAL_MS = 60 * 60 * 1000;
// Descărcări per serial într-o rulare — un serial abia activat nu aruncă 30 de
// torrente deodată; restul vin la ciclurile următoare.
const MAX_DOWNLOADS_PER_RUN = 3;

function formatEpisodeKey(k: EpisodeKey): string {
  return `S${String(k.season).padStart(2, "0")}E${String(k.episode).padStart(2, "0")}`;
}

function parseEpisodeKey(s: string | null): EpisodeKey | null {
  const m = s?.match(/^S(\d+)E(\d+)$/i);
  return m ? { season: Number(m[1]), episode: Number(m[2]) } : null;
}

// Ordonare sezon-apoi-episod, folosită și la comparația cu auto_download_from.
function ord(k: EpisodeKey): number {
  return k.season * 1000 + k.episode;
}

interface ShowRow {
  id: number;
  title: string;
  original_title: string | null;
  literal_title: string | null;
  imdb_id: string | null;
  tmdb_id: number | null;
  poster_path: string | null;
  tv_status: string | null;
  auto_download_quality: string | null;
  auto_download_fallback_quality: string | null;
  watch_fallback_seen: string | null;
  auto_download_from: string | null;
  requested_by_user_id: number | null;
}

// Episoadele difuzate, după TMDB — doar sezoanele de la `from` în sus, într-o
// singură cerere. Sezonul 0 („Specials”) e sărit: nu face parte din numerotare,
// iar Filelist nu-l acoperă coerent. `details` vine de la apelant: tmdbFetch
// n-are cache, deci o a doua cerere ar fi identică.
async function getAiredEpisodes(
  tmdbId: number,
  fromSeason: number,
  details: TmdbShowDetails | null,
  // Și episoadele cu data de azi sau mâine — vezi aired-episodes.ts.
  includeUpcoming = false,
): Promise<EpisodeKey[]> {
  const { getTmdbAllSeasonsInternal } = await import("../tmdb/tmdb.functions");
  const seasonNumbers = (details?.seasons ?? [])
    .map((s) => s.seasonNumber)
    .filter((n) => n >= Math.max(1, fromSeason));
  if (seasonNumbers.length === 0) return [];
  const schema = await getTmdbAllSeasonsInternal(tmdbId, seasonNumbers).catch(() => []);
  // Aceeași zi ca în tmdb.functions.ts (UTC), ca regulile să nu se decaleze.
  return airedEpisodeKeys(schema, {
    includeUpcoming,
    today: new Date().toISOString().slice(0, 10),
  });
}

type TmdbShowDetails = Awaited<
  ReturnType<typeof import("../tmdb/tmdb.functions").getTmdbDetailsInternal>
>;

// null și când TMDB „răspunde” gol (getTmdbDetailsInternal nu aruncă): tratat
// ca valid, ar fi șters următorul episod anunțat.
async function fetchShowDetails(tmdbId: number): Promise<TmdbShowDetails | null> {
  const { getTmdbDetailsInternal } = await import("../tmdb/tmdb.functions");
  const details = await getTmdbDetailsInternal(tmdbId, "tv").catch(() => null);
  return details?.title ? details : null;
}

// Scrie pe rândul-serial detaliile, statusul și următorul episod — toate din
// același răspuns TMDB. Ora exactă a episodului vine de la TVmaze (TMDB dă doar
// data), ca instant ISO redat direct în ora României; TVmaze e întrebat doar
// când există un episod următor.
//
// `markRefreshed` pornește ceasul de 12h — doar reîmprospătarea completă, care
// atinge și episoadele. Când îl pornea și verificarea la 3h, la un serial
// urmărit ceasul nu ajungea niciodată la 12h și numele episoadelor nu se mai
// actualizau (Insula Iubirii, 26 sept. 2026).
async function writeShowMeta(
  showId: number,
  imdbId: string | null,
  details: TmdbShowDetails | null,
  opts: { markRefreshed: boolean },
): Promise<string[]> {
  if (!details) return [];
  const next = details.nextEpisode;

  let airstamp: string | null = null;
  if (next && imdbId) {
    const { getTvmazeAirstampsInternal } = await import("../tvmaze/tvmaze.functions");
    const stamps = await getTvmazeAirstampsInternal(imdbId).catch(() => []);
    // Doar dacă e chiar același episod — vezi next-episode-airstamp.ts.
    const { matchingAirstamp } = await import("./next-episode-airstamp");
    airstamp = matchingAirstamp(
      stamps.find(
        (a) => a.seasonNumber === next.seasonNumber && a.episodeNum === next.episodeNumber,
      )?.airstamp ?? null,
      next.airDate ?? null,
    );
  }

  // Titlurile, descrierea, genurile și posterul se împrospătează la fiecare
  // trecere (erau scrise o singură dată: „The Rookie” rămăsese în engleză deși
  // TMDB avea „Recrutul”). COALESCE + NULLIF: un răspuns TMDB incomplet nu
  // șterge ce avem.
  const year = details.releaseDate ? Number(details.releaseDate.slice(0, 4)) : null;
  const genres = (details.genres ?? []).length > 0 ? JSON.stringify(details.genres) : null;
  const db = getDb();
  // Citit înainte și după, pentru jurnalul reîmprospătării (metadata-report.ts).
  const readShow = db.prepare(
    `SELECT ${Object.keys(SHOW_FIELDS).join(", ")} FROM media WHERE id = ?`,
  );
  const before = readShow.get(showId) as Record<string, unknown> | undefined;
  db.prepare(
    `UPDATE media
        SET title = COALESCE(NULLIF(?, ''), title),
            original_title = COALESCE(NULLIF(?, ''), original_title),
            literal_title = COALESCE(?, literal_title),
            year = COALESCE(?, year),
            overview_ro = COALESCE(NULLIF(?, ''), overview_ro),
            genres = COALESCE(?, genres),
            poster_path = COALESCE(NULLIF(?, ''), poster_path),
            tv_status = COALESCE(?, tv_status),
            next_episode = ?,
            next_episode_air_date = ?,
            next_episode_airstamp = ?,
            last_episode_air_date = COALESCE(?, last_episode_air_date),
            meta_refreshed_at = CASE WHEN ? THEN datetime('now') ELSE meta_refreshed_at END
      WHERE id = ?`,
  ).run(
    details.title,
    details.originalTitle,
    details.literalTitle ?? null,
    Number.isFinite(year) ? year : null,
    details.overview ?? null,
    genres,
    details.posterUrl ?? null,
    details.tvStatus,
    next ? formatEpisodeKey({ season: next.seasonNumber, episode: next.episodeNumber }) : null,
    next?.airDate ?? null,
    airstamp,
    details.lastEpisodeAirDate ?? null,
    opts.markRefreshed ? 1 : 0,
    showId,
  );

  // Episoadele poartă titlul serialului (convenția din `media`); original_title
  // e și cheia de rezervă la potrivirea vizionărilor cu Plex. Descrierea și
  // genurile sunt copii ale serialului. Posterul nu: pe episoade e posterul
  // SEZONULUI (syncEpisodeDetails) — scris și aici, s-ar suprascrie reciproc.
  db.prepare(
    `UPDATE media
        SET title = COALESCE(NULLIF(?, ''), title),
            original_title = COALESCE(NULLIF(?, ''), original_title),
            overview_ro = COALESCE(NULLIF(?, ''), overview_ro),
            genres = COALESCE(?, genres)
      WHERE parent_id = ?`,
  ).run(details.title, details.originalTitle, details.overview ?? null, genres, showId);

  const after = readShow.get(showId) as Record<string, unknown> | undefined;
  return diffFields(before, after, SHOW_FIELDS, ["title", "original_title", "next_episode"]);
}

export interface ShowWatchOutcome {
  showId: number;
  title: string;
  missing: string[];
  downloaded: string[];
  skipped: string | null;
}

// Serialele în verificare acum. Rulările succesive sunt idempotente, dar două
// SIMULTANE („Verifică acum” în timpul unui ciclu) ar porni același torrent de
// două ori.
const inProgress = new Set<number>();

// Un singur serial — chemată și direct de „Verifică acum” din drawer.
export async function checkShow(showId: number): Promise<ShowWatchOutcome> {
  if (inProgress.has(showId)) {
    return {
      showId,
      title: "?",
      missing: [],
      downloaded: [],
      skipped: "o verificare e deja în curs",
    };
  }
  inProgress.add(showId);
  try {
    return await checkShowInner(showId);
  } finally {
    inProgress.delete(showId);
  }
}

async function checkShowInner(showId: number): Promise<ShowWatchOutcome> {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, title, original_title, literal_title, imdb_id, tmdb_id, poster_path,
              tv_status, auto_download_quality, auto_download_fallback_quality,
              watch_fallback_seen, auto_download_from, requested_by_user_id
         FROM media WHERE id = ? AND media_type = 'tv_show'`,
    )
    .get(showId) as unknown as ShowRow | undefined;

  // datetime('now'), nu ISO: comparația din checkDueShows e pe șiruri, iar un
  // ISO („...T07:54”) nu devenea scadent în aceeași zi ('T' > ' ') — urmărirea
  // rula o dată pe zi, nu la 3 ore. Și afișarea ieșea dată invalidă.
  const stamp = () =>
    db.prepare("UPDATE media SET watch_last_checked_at = datetime('now') WHERE id = ?").run(showId);
  // Notițele calității de rezervă (fallback-quality.ts): rămân doar țintele la
  // care încă se așteaptă principala.
  const saveFallbackSeen = (seen: FallbackSeen) =>
    db
      .prepare("UPDATE media SET watch_fallback_seen = ? WHERE id = ?")
      .run(Object.keys(seen).length > 0 ? JSON.stringify(seen) : null, showId);

  if (!row)
    return { showId, title: "?", missing: [], downloaded: [], skipped: "serial inexistent" };
  const result: ShowWatchOutcome = {
    showId,
    title: row.title,
    missing: [],
    downloaded: [],
    skipped: null,
  };

  // Căutarea pe Filelist e strict după IMDb (fallback-ul pe titlu, eliminat
  // definitiv, confirmat de suport).
  if (!row.imdb_id || !row.tmdb_id) {
    stamp();
    result.skipped = "lipsește imdb_id sau tmdb_id";
    return result;
  }

  const owned = db
    .prepare("SELECT season, episode FROM media WHERE parent_id = ?")
    .all(row.id) as unknown as Array<{ season: number | null; episode: number | null }>;
  const ownedKeys = new Set(
    owned
      .filter((e) => e.season != null && e.episode != null)
      .map((e) => formatEpisodeKey({ season: e.season!, episode: e.episode! })),
  );

  // Un pachet de sezon neterminat e un singur rând cu episode NULL; episoadele
  // lui apar abia după desfacere. Până atunci ar părea „lipsă” și s-ar
  // descărca individual PESTE pachet.
  const pendingPackSeasons = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT season FROM media
             WHERE parent_id = ? AND is_season_pack = 1
               AND plex_rating_key IS NULL AND season IS NOT NULL`,
        )
        .all(row.id) as unknown as Array<{ season: number }>
    ).map((r) => r.season),
  );

  const from = parseEpisodeKey(row.auto_download_from);
  const details = await fetchShowDetails(row.tmdb_id);
  // Datele sunt deja aici — momentul potrivit pentru metadatele serialului.
  await writeShowMeta(row.id, details ? row.imdb_id : null, details, { markRefreshed: false });
  const aired = await getAiredEpisodes(row.tmdb_id, from ? from.season : 1, details, true);
  const missing = aired
    .filter((k) => !ownedKeys.has(formatEpisodeKey(k)))
    .filter((k) => !pendingPackSeasons.has(k.season))
    .filter((k) => !from || ord(k) > ord(from))
    .sort((a, b) => ord(a) - ord(b));
  result.missing = missing.map(formatEpisodeKey);

  if (missing.length === 0) {
    saveFallbackSeen({});
    stamp();
    return result;
  }

  const { checkFilelistForItemInternal } = await import("../filelist/filelist-client");
  const search = await checkFilelistForItemInternal({
    title: row.title,
    originalTitle: row.literal_title || row.original_title || row.title,
    imdbId: row.imdb_id,
    mediaType: "tv",
  });
  if (search.status !== "ok" || search.torrents.length === 0) {
    // Eroare Filelist: notițele rămân, altfel așteptarea după principală ar
    // reporni de la zero.
    if (search.status === "ok") saveFallbackSeen({});
    stamp();
    result.skipped =
      search.status === "ok" ? "niciun torrent pe Filelist" : (search.error ?? "eroare Filelist");
    return result;
  }

  const { detectTorrentQuality } = await import("./torrent-quality");
  const { parseSeasonEpisodeFromName } = await import("./torrent-name-parse");
  const wantedQuality = row.auto_download_quality || "1080p";

  // Torrentele deja aduse — țin rularea idempotentă cât un pachet pornit încă
  // n-are rânduri per episod.
  const alreadyFetched = new Set(
    (
      db
        .prepare("SELECT DISTINCT torrent_name FROM media WHERE torrent_name IS NOT NULL")
        .all() as unknown as Array<{ torrent_name: string }>
    ).map((r) => r.torrent_name),
  );

  const missingKeys = new Set(missing.map(formatEpisodeKey));
  const relevant = search.torrents
    .filter((t) => t.matchedByImdb)
    .filter((t) => !alreadyFetched.has(t.name))
    .filter((t) => !isExcludedTorrent(t))
    .map((t) => ({
      torrent: t,
      parsed: parseSeasonEpisodeFromName(t.name),
      quality: detectTorrentQuality(t.name),
    }))
    .filter((c) => c.parsed != null)
    .filter((c) => {
      const p = c.parsed!;
      if (p.episode != null) return missingKeys.has(formatEpisodeKey({ ...p, episode: p.episode }));
      // Pachet de sezon: luat dacă acoperă măcar un episod lipsă, chiar dacă
      // aduce și episoade deținute (alegerea ta).
      return missing.some((k) => k.season === p.season);
    });

  // Episoadele lipsă aduse de un torrent (pachetul = tot ce lipsește din sezon).
  const coversOf = (p: { season: number; episode: number | null }): EpisodeKey[] =>
    p.episode != null
      ? [{ season: p.season, episode: p.episode }]
      : missing.filter((k) => k.season === p.season);
  // Ținta din notițele rezervei: episodul, sau pachetul sezonului.
  const targetOf = (p: { season: number; episode: number | null }) =>
    p.episode != null
      ? formatEpisodeKey({ season: p.season, episode: p.episode })
      : `S${String(p.season).padStart(2, "0")} pachet`;

  const primary = relevant.filter((c) => c.quality === wantedQuality);

  // Rezerva contează doar pentru ținte pe care principala nu le acoperă deloc;
  // prima dată se notează, se descarcă la o verificare de peste cel puțin 3h.
  const fallbackQuality = effectiveFallback(wantedQuality, row.auto_download_fallback_quality);
  const primaryCovers = new Set(primary.flatMap((c) => coversOf(c.parsed!).map(formatEpisodeKey)));
  const prevSeen = parseFallbackSeen(row.watch_fallback_seen);
  const nextSeen: FallbackSeen = {};
  const waiting = new Set<string>();
  const readyFallback: typeof relevant = [];
  if (fallbackQuality) {
    const now = Date.now();
    for (const c of relevant) {
      if (c.quality !== fallbackQuality) continue;
      if (coversOf(c.parsed!).some((k) => primaryCovers.has(formatEpisodeKey(k)))) continue;
      const target = targetOf(c.parsed!);
      const decision = fallbackReady(target, prevSeen, now);
      if (decision.ready) {
        readyFallback.push(c);
      } else {
        nextSeen[target] = decision.firstSeen;
        waiting.add(target);
      }
    }
  }
  saveFallbackSeen(nextSeen);

  const byRank = compareTorrents("tv");
  const candidates = [...primary, ...readyFallback]
    // Episoadele individuale înaintea pachetelor (mai puțin trafic), apoi
    // principala înaintea rezervei, apoi clasamentul comun (torrent-rank.ts).
    .sort((a, b) => {
      const aPack = a.parsed!.episode == null ? 1 : 0;
      const bPack = b.parsed!.episode == null ? 1 : 0;
      const aFallback = a.quality === wantedQuality ? 0 : 1;
      const bFallback = b.quality === wantedQuality ? 0 : 1;
      return aPack - bPack || aFallback - bFallback || byRank(a.torrent, b.torrent);
    });

  if (candidates.length === 0) {
    stamp();
    result.skipped =
      waiting.size > 0
        ? `doar ${fallbackQuality} pentru ${[...waiting].join(", ")} — dacă ${wantedQuality} nu apare, se descarcă ${fallbackQuality} la o verificare de peste 3 ore`
        : `niciun torrent ${wantedQuality} pentru episoadele lipsă`;
    return result;
  }

  const { downloadFilelistCore } = await import("../filelist/download");
  const covered = new Set<string>();
  // Ce a adus verificarea — reperul pentru poziția de start (watch-position.ts).
  const downloadedNow: EpisodeKey[] = [];

  for (const c of candidates) {
    if (result.downloaded.length >= MAX_DOWNLOADS_PER_RUN) break;
    const p = c.parsed!;
    // Fără două torrente pentru același episod (episodul și pachetul lui).
    const coversNowKeys = coversOf(p);
    const coversNow = coversNowKeys.map(formatEpisodeKey);
    if (coversNow.every((k) => covered.has(k))) continue;

    const dl = await downloadFilelistCore({
      torrentId: c.torrent.id,
      torrentName: c.torrent.name,
      categoryId: c.torrent.category,
      categoryName: c.torrent.categoryName,
      size: c.torrent.size,
      freeleech: c.torrent.freeleech,
      internal: c.torrent.internal,
      imdb: c.torrent.imdb ?? row.imdb_id,
      requestedByUserId: row.requested_by_user_id,
      media: {
        // parent_id îl rezolvă upsertMediaEntry (ensureMediaPlaceholder) —
        // trimis și aici, ar fi o a doua sursă pentru aceeași legătură.
        mediaType: "episode",
        imdbId: c.torrent.imdb ?? row.imdb_id,
        tmdbId: row.tmdb_id,
        title: row.title,
        originalTitle: row.original_title,
        literalTitle: row.literal_title,
        overviewRo: details?.overview ?? null,
        genres: details?.genres ?? [],
        posterPath: row.poster_path,
        tvStatus: details?.tvStatus ?? row.tv_status,
        season: p.season,
        episode: p.episode,
        isSeasonPack: p.episode == null,
        addedVia: "auto",
      },
    });

    if (dl.status !== "ok") {
      console.warn(
        `[show-watch] "${row.title}" — descărcare eșuată (${c.torrent.name}):`,
        dl.error,
      );
      continue;
    }
    for (const k of coversNow) covered.add(k);
    downloadedNow.push(...coversNowKeys);
    const label =
      p.episode == null
        ? `Sezonul ${p.season} (pachet)`
        : formatEpisodeKey({ season: p.season, episode: p.episode });
    result.downloaded.push(
      c.quality === wantedQuality ? label : `${label} (${c.quality}, rezervă)`,
    );
  }

  // O rezervă „gata” care n-a pornit acum rămâne gata — nu reîncepe cele 3h.
  const unstarted = readyFallback.filter(
    (c) => !coversOf(c.parsed!).every((k) => covered.has(formatEpisodeKey(k))),
  );
  if (unstarted.length > 0) {
    for (const c of unstarted) {
      const target = targetOf(c.parsed!);
      nextSeen[target] = prevSeen[target];
    }
    saveFallbackSeen(nextSeen);
  }

  // Poziția de start avansează peste ce s-a adus, ca un episod văzut și șters
  // să nu revină (watch-position.ts: de ce se oprește la primul gol).
  if (downloadedNow.length > 0) {
    const next = advancedWatchFrom({
      from,
      aired,
      covered: aired.filter(
        (k) =>
          ownedKeys.has(formatEpisodeKey(k)) ||
          pendingPackSeasons.has(k.season) ||
          covered.has(formatEpisodeKey(k)),
      ),
      downloadedNow,
    });
    if (next && (!from || ord(next) > ord(from))) {
      db.prepare("UPDATE media SET auto_download_from = ? WHERE id = ?").run(
        formatEpisodeKey(next),
        showId,
      );
      console.log(
        `[show-watch] "${row.title}" — poziția de start: ${row.auto_download_from ?? "început"} → ${formatEpisodeKey(next)}`,
      );
    }
  }

  // Fără notificare aici: downloadFilelistCore trimite deja push-ul („🤖
  // Descărcare Automată” prin addedVia: "auto") — încă unul l-ar dubla.
  stamp();
  return result;
}

// Serialele cu cadența expirată: 1h în fereastra lansării, 3h în rest, ținută
// în DB (un timer s-ar reseta la restart). Ziua e cea locală: un episod de
// duminică seara în SUA apare luni aici — marja de ±1 zi îl acoperă.
export async function checkDueShows(): Promise<void> {
  const db = getDb();
  const due = db
    .prepare(
      `SELECT id FROM media
         WHERE media_type = 'tv_show' AND auto_download = 1
           AND (watch_last_checked_at IS NULL
                OR watch_last_checked_at <= datetime('now', ?)
                OR (watch_last_checked_at <= datetime('now', ?)
                    AND (ABS(julianday(next_episode_air_date) - julianday(date('now', 'localtime'))) <= 1
                         OR ABS(julianday(last_episode_air_date) - julianday(date('now', 'localtime'))) <= 1)))`,
    )
    .all(
      `-${Math.round(ITEM_INTERVAL_MS / 1000)} seconds`,
      `-${Math.round(RELEASE_WINDOW_INTERVAL_MS / 1000)} seconds`,
    ) as unknown as Array<{ id: number }>;

  for (const { id } of due) {
    try {
      const outcome = await checkShow(id);
      if (outcome.downloaded.length > 0) {
        console.log(`[show-watch] "${outcome.title}" — pornite ${outcome.downloaded.length}`);
      } else if (outcome.skipped) {
        console.log(`[show-watch] "${outcome.title}" — sărit: ${outcome.skipped}`);
      }
    } catch (e) {
      console.warn(`[show-watch] Eroare la serialul ${id}:`, e);
    }
  }
}

// ---------------------------------------------------------------------------
// Setarea urmăririi (din drawer-ul serialului)
// ---------------------------------------------------------------------------

export interface SetShowWatchInput {
  mediaId: number;
  enabled: boolean;
  quality?: string;
  // Calitatea de rezervă: `undefined` = neschimbată; `null` = fără.
  fallbackQuality?: string | null;
  // "forward" (implicit) = doar ce apare de-acum; "backfill" = și tot ce
  // lipsește din istoric — zeci de episoade, deci doar la alegere explicită.
  mode?: "forward" | "backfill";
}

export async function setShowWatchCore(input: SetShowWatchInput): Promise<void> {
  const db = getDb();
  if (!input.enabled) {
    db.prepare("UPDATE media SET auto_download = 0 WHERE id = ? AND media_type = 'tv_show'").run(
      input.mediaId,
    );
    return;
  }

  // Urmărire deja pornită: se schimbă doar calitatea. Recalculat, punctul de
  // pornire ar sări peste episoadele care încă așteptau un torrent (același
  // bug ca 4a94143 la implementarea veche).
  const current = db
    .prepare("SELECT auto_download FROM media WHERE id = ? AND media_type = 'tv_show'")
    .get(input.mediaId) as { auto_download: number } | undefined;
  if (current?.auto_download) {
    // Notițele rezervei erau despre perechea veche de calități.
    db.prepare(
      `UPDATE media SET auto_download_quality = ?,
              auto_download_fallback_quality = CASE WHEN ? THEN ? ELSE auto_download_fallback_quality END,
              watch_fallback_seen = NULL
        WHERE id = ?`,
    ).run(
      input.quality ?? "1080p",
      input.fallbackQuality !== undefined ? 1 : 0,
      input.fallbackQuality ?? null,
      input.mediaId,
    );
    return;
  }

  let from: string | null = null;
  if ((input.mode ?? "forward") === "forward") {
    // Punctul de plecare = cel mai târziu dintre ultimul episod deținut și
    // ultimul difuzat — altfel activarea ar aduce tot ce a apărut între timp.
    const owned = db
      .prepare(
        `SELECT MAX(season * 1000 + episode) AS ord FROM media
           WHERE parent_id = ? AND season IS NOT NULL AND episode IS NOT NULL`,
      )
      .get(input.mediaId) as { ord: number | null } | undefined;
    const show = db
      .prepare("SELECT tmdb_id, imdb_id FROM media WHERE id = ?")
      .get(input.mediaId) as { tmdb_id: number | null; imdb_id: string | null } | undefined;

    let bestOrd = owned?.ord ?? 0;
    if (show?.tmdb_id) {
      const details = await fetchShowDetails(show.tmdb_id);
      await writeShowMeta(input.mediaId, show.imdb_id, details, { markRefreshed: false });
      const aired = await getAiredEpisodes(show.tmdb_id, 1, details).catch(() => []);
      for (const k of aired) bestOrd = Math.max(bestOrd, ord(k));
    }
    if (bestOrd > 0) {
      from = formatEpisodeKey({
        season: Math.floor(bestOrd / 1000),
        episode: bestOrd % 1000,
      });
    }
  }

  db.prepare(
    `UPDATE media SET auto_download = 1, auto_download_quality = ?,
                      auto_download_fallback_quality = ?, auto_download_from = ?,
                      watch_last_checked_at = NULL, watch_fallback_seen = NULL
       WHERE id = ? AND media_type = 'tv_show'`,
  ).run(input.quality ?? "1080p", input.fallbackQuality ?? null, from, input.mediaId);
}

// ---------------------------------------------------------------------------
// Numele episoadelor
// ---------------------------------------------------------------------------

// Cât mai așteptăm ca TMDB să completeze titlul unui episod difuzat, înainte
// să acceptăm placeholder-ul generic.
const PLACEHOLDER_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

// „Episodul 8” — titlul generic al TMDB când episodul n-are (încă) nume.
const GENERIC_EPISODE_TITLE = /^episo(?:dul|de)\s*\d+$/i;

// Detaliile episoadelor de la TMDB (nume, descriere, imagine, data, posterul
// sezonului), în română cu engleza ca rezervă. Două rulări, pe un serial:
// - imediat după ce se scrie un episod: doar episoadele cărora le lipsește
//   ceva (syncEpisodeDetailsForShow);
// - cu `all`, la reîmprospătarea de 12h: toate — așa ajunge româna când apare
//   pe TMDB (un nume salvat în engleză nu se mai verifica niciodată).
//
// Un nume se înlocuiește doar cu un nume real, niciodată cu „Episodul N”;
// restul doar cu valori nevide — ce lipsește la TMDB nu șterge ce avem.
export async function syncEpisodeDetails(opts: {
  parentId: number;
  all?: boolean;
  // O linie per episod schimbat, pentru jurnal. `firstFill`: prima completare
  // a unui episod tocmai creat, nu o actualizare.
  onEpisodeChange?: (line: string, firstFill: boolean) => void;
}): Promise<number> {
  const db = getDb();
  const filter = opts.all
    ? ""
    : "AND (e.episode_title IS NULL OR e.episode_overview IS NULL OR e.episode_still IS NULL)";
  const rows = db
    .prepare(
      `SELECT e.id, e.season, e.episode, e.episode_title, p.tmdb_id AS tmdb_id
         FROM media e
         JOIN media p ON p.id = e.parent_id
        WHERE e.media_type = 'episode'
          AND e.season IS NOT NULL
          AND e.episode IS NOT NULL
          AND p.tmdb_id IS NOT NULL
          AND e.parent_id = ?
          ${filter}`,
    )
    .all(opts.parentId) as unknown as Array<{
    id: number;
    season: number;
    episode: number;
    episode_title: string | null;
    tmdb_id: number;
  }>;
  if (rows.length === 0) return 0;

  const { getTmdbAllSeasonsInternal } = await import("../tmdb/tmdb.functions");
  const update = db.prepare(
    `UPDATE media
        SET episode_title = COALESCE(?, episode_title),
            episode_overview = COALESCE(NULLIF(?, ''), episode_overview),
            episode_still = COALESCE(NULLIF(?, ''), episode_still),
            episode_air_date = COALESCE(NULLIF(?, ''), episode_air_date),
            poster_path = COALESCE(NULLIF(?, ''), poster_path)
      WHERE id = ?`,
  );
  // Un singur serial, deci o singură cerere TMDB.
  const seasons = [...new Set(rows.map((r) => r.season))].sort((a, b) => a - b);
  const schema = await getTmdbAllSeasonsInternal(rows[0].tmdb_id, seasons, {
    details: true,
  }).catch(() => []);
  const bySeason = new Map(schema.map((s) => [s.seasonNumber, s]));
  const readEpisode = db.prepare(
    `SELECT ${Object.keys(EPISODE_FIELDS).join(", ")} FROM media WHERE id = ?`,
  );
  let changed = 0;
  for (const r of rows) {
    const season = bySeason.get(r.season);
    const found = season?.episodes.find((e) => e.episodeNum === r.episode);
    if (!found) continue;

    let title: string | null = found.title;
    if (GENERIC_EPISODE_TITLE.test(found.title)) {
      if (r.episode_title) {
        // Un nume existent nu e înlocuit de un placeholder.
        title = null;
      } else {
        // „Episodul 8” e și placeholder temporar (primele ore după difuzare),
        // și permanent (reality show-uri fără titluri, ca Insula Iubirii).
        // Recent → gol, ca să se reîncerce; vechi → acceptat. UI-ul ascunde
        // oricum numele generice.
        const stillWorthWaiting =
          found.airDate != null &&
          Date.now() - new Date(found.airDate).getTime() <= PLACEHOLDER_GRACE_MS;
        if (stillWorthWaiting) title = null;
      }
    }

    const before = readEpisode.get(r.id) as Record<string, unknown> | undefined;
    const firstFill =
      before != null &&
      before.episode_title == null &&
      before.episode_overview == null &&
      before.episode_still == null &&
      before.episode_air_date == null;
    update.run(
      title,
      found.overview ?? null,
      found.stillUrl ?? null,
      found.airDate ?? null,
      season?.posterUrl ?? null,
      r.id,
    );
    const fields = diffFields(
      before,
      readEpisode.get(r.id) as Record<string, unknown>,
      EPISODE_FIELDS,
      ["episode_title"],
    );
    if (fields.length > 0) {
      changed++;
      opts.onEpisodeChange?.(
        `${formatEpisodeKey({ season: r.season, episode: r.episode })}: ${fields.join(", ")}`,
        firstFill,
      );
    }
  }
  return changed;
}

// Detaliile episoadelor unui serial imediat după ce i s-a scris un episod nou,
// în fundal (o eroare se reia la 12h). Schimbările la episoadele mai vechi
// ajung în jurnalul de metadate; prima completare a celor noi nu (decizia
// userului, 27 sept. 2026).
export function syncEpisodeDetailsForShow(parentId: number | null): void {
  if (parentId == null) return;
  syncAndLogEpisodeDetails(parentId).catch((e) =>
    console.warn(`[show-watch] Detalii de episod necompletate pentru serialul ${parentId}:`, e),
  );
}

// Exportată pentru teste — syncEpisodeDetailsForShow nu așteaptă rezultatul.
export async function syncAndLogEpisodeDetails(parentId: number): Promise<void> {
  const episodes: string[] = [];
  await syncEpisodeDetails({
    parentId,
    onEpisodeChange: (line, firstFill) => {
      if (!firstFill) episodes.push(line);
    },
  });
  if (episodes.length === 0) return;
  const show = getDb().prepare("SELECT title FROM media WHERE id = ?").get(parentId) as
    { title: string } | undefined;
  await logEpisodeUpdates(show?.title ?? "", episodes);
}

// ---------------------------------------------------------------------------
// Reîmprospătarea metadatelor de serial
// ---------------------------------------------------------------------------

// 12h per titlu, fără limită pe rulare (decizia userului, 26 sept. 2026); la
// fel pentru filme (movie-metadata.ts).
export const META_INTERVAL_MS = 12 * 60 * 60 * 1000;

// Statusul, următorul episod și detaliile pentru TOATE serialele, nu doar cele
// urmărite: butonul de urmărire se ascunde pe `tv_status === 'Ended'`, deci un
// serial reînnoit trebuie să-l primească înapoi.
export async function refreshShowMetadata(report?: MetaReport): Promise<number> {
  const db = getDb();
  const due = db
    .prepare(
      `SELECT id, tmdb_id, imdb_id FROM media
         WHERE media_type = 'tv_show' AND tmdb_id IS NOT NULL
           AND (meta_refreshed_at IS NULL OR meta_refreshed_at <= datetime('now', ?))
         ORDER BY meta_refreshed_at IS NOT NULL, meta_refreshed_at`,
    )
    .all(`-${Math.round(META_INTERVAL_MS / 1000)} seconds`) as unknown as Array<{
    id: number;
    tmdb_id: number;
    imdb_id: string | null;
  }>;

  // Încercarea se marchează și fără răspuns TMDB — un tmdb_id mort ar fi fost
  // reîncercat la fiecare 10 minute. Costul: o pană trecătoare amână cu 12h.
  const touch = db.prepare("UPDATE media SET meta_refreshed_at = datetime('now') WHERE id = ?");

  let refreshed = 0;
  for (const row of due) {
    try {
      const details = await fetchShowDetails(row.tmdb_id);
      if (!details) {
        touch.run(row.id);
        if (report) report.failed++;
        continue;
      }
      const fields = await writeShowMeta(row.id, row.imdb_id, details, { markRefreshed: true });
      // Toate episoadele serialului, odată cu el — vezi syncEpisodeDetails.
      const episodes: string[] = [];
      await syncEpisodeDetails({
        parentId: row.id,
        all: true,
        onEpisodeChange: (line) => episodes.push(line),
      });
      refreshed++;
      if (report) {
        report.shows++;
        if (fields.length > 0 || episodes.length > 0) {
          const t = db.prepare("SELECT title FROM media WHERE id = ?").get(row.id) as
            { title: string } | undefined;
          report.changes.push({ title: t?.title ?? "", kind: "show", fields, episodes });
        }
      }
    } catch (e) {
      touch.run(row.id);
      if (report) report.failed++;
      console.warn(`[show-watch] Metadate neactualizate pentru serialul ${row.id}:`, e);
    }
  }
  if (refreshed > 0)
    console.log(`[show-watch] Metadate reîmprospătate pentru ${refreshed} seriale`);
  return refreshed;
}
