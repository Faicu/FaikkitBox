// ---------------------------------------------------------------------------
// Urmărirea serialelor: descărcarea automată a episoadelor noi.
//
// A doua încercare. Prima (pinned-watcher.ts + tabelele pinned_*, eliminate
// în commit 1599c9e / migrarea v14) a fost problematică din două motive de
// fond, ambele evitate aici:
//
// 1. Trăia într-o structură paralelă. Titlurile urmărite stăteau în
//    `pinned_items`, per-utilizator, legate de `media` doar prin tmdb_id.
//    De-acolo veneau bug-urile ei: rânduri duplicate, dedublare între două
//    liste, un GROUP BY defensiv ca să nu descarce de N ori pentru N useri
//    care fixaseră același serial. Acum urmărirea e un set de coloane
//    `auto_download*` / `watch_*` pe rândul 'tv_show' din `media` — rând care e
//    deja unic per serial și deja legat de episoade prin parent_id. Nu mai
//    există nimic de corelat.
//
// 2. Era diferențială, nu declarativă. Ținea `seen_torrent_ids` și
//    `last_aired_key` și reacționa la "ce s-a schimbat de la ultima
//    verificare": prima rulare per item era baseline (rata intenționat
//    primul episod), starea se strica la restart, iar o verificare picată
//    însemna un episod pierdut definitiv.
//
//    Aici comparăm starea dorită cu starea reală: TMDB spune ce episoade au
//    fost difuzate, `media WHERE parent_id = ?` spune ce avem, diferența e
//    ce trebuie descărcat. Rularea e idempotentă — se poate relua oricând,
//    se auto-repară după un restart, nu ratează nimic dacă un ciclu pică, și
//    nu poate descărca de două ori, fiindcă verifică realitatea, nu un
//    jurnal de evenimente.
// ---------------------------------------------------------------------------

import { airedEpisodeKeys } from "./aired-episodes";
import {
  effectiveFallback,
  fallbackReady,
  parseFallbackSeen,
  type FallbackSeen,
} from "./fallback-quality";
import { advancedWatchFrom, type EpisodeKey } from "./watch-position";
import { getDb } from "../db";
import { diffFields, EPISODE_FIELDS, SHOW_FIELDS, type MetaReport } from "./metadata-report";

const ITEM_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 ore — cadența reală per serial
// Câte descărcări pornim cel mult într-o rulare per serial. Un serial abia
// activat cu multe episoade lipsă nu trebuie să arunce 30 de torrente în
// qBittorrent deodată; restul vin la ciclurile următoare.
const MAX_DOWNLOADS_PER_RUN = 3;

function formatEpisodeKey(k: EpisodeKey): string {
  return `S${String(k.season).padStart(2, "0")}E${String(k.episode).padStart(2, "0")}`;
}

function parseEpisodeKey(s: string | null): EpisodeKey | null {
  const m = s?.match(/^S(\d+)E(\d+)$/i);
  return m ? { season: Number(m[1]), episode: Number(m[2]) } : null;
}

// Ordonare stabilă sezon-apoi-episod, folosită și la comparația cu
// auto_download_from ("descarcă doar ce vine după punctul ăsta").
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

// Episoadele deja difuzate, după TMDB. Cerem doar sezoanele care ne
// interesează (de la sezonul lui `from` în sus), nu tot serialul — și pe
// alea într-un singur request, prin append_to_response.
//
// Sezonul 0 ("Specials") e sărit intenționat: nu face parte din numerotarea
// pe care o urmărim, iar lansările de pe Filelist nu-l acoperă coerent.
//
// `details` vine din afară, nu îl cerem noi: apelantul are oricum nevoie de
// el (pentru metadatele descărcării), iar tmdbFetch n-are niciun cache — două
// apeluri însemnau două cereri HTTP identice la fiecare ciclu.
async function getAiredEpisodes(
  tmdbId: number,
  fromSeason: number,
  details: TmdbShowDetails | null,
  // Și episoadele cu data de azi — vezi aired-episodes.ts.
  includeToday = false,
): Promise<EpisodeKey[]> {
  const { getTmdbAllSeasonsInternal } = await import("../tmdb/tmdb.functions");
  const seasonNumbers = (details?.seasons ?? [])
    .map((s) => s.seasonNumber)
    .filter((n) => n >= Math.max(1, fromSeason));
  if (seasonNumbers.length === 0) return [];
  const schema = await getTmdbAllSeasonsInternal(tmdbId, seasonNumbers).catch(() => []);
  // Aceeași zi ca în tmdb.functions.ts (UTC), ca regulile să nu se decaleze.
  return airedEpisodeKeys(schema, {
    includeToday,
    today: new Date().toISOString().slice(0, 10),
  });
}

type TmdbShowDetails = Awaited<
  ReturnType<typeof import("../tmdb/tmdb.functions").getTmdbDetailsInternal>
>;

// null și când TMDB „răspunde" gol: getTmdbDetailsInternal nu aruncă la o
// eroare, ci întoarce un obiect cu titlul gol. Tratat ca răspuns valid, ar fi
// șters următorul episod anunțat (`next_episode` se scrie direct, fără
// COALESCE) până la reîmprospătarea următoare.
async function fetchShowDetails(tmdbId: number): Promise<TmdbShowDetails | null> {
  const { getTmdbDetailsInternal } = await import("../tmdb/tmdb.functions");
  const details = await getTmdbDetailsInternal(tmdbId, "tv").catch(() => null);
  return details?.title ? details : null;
}

// Scrie pe rândul-serial ce ține de titlu, nu de fișiere: detaliile (titluri,
// an, descriere, genuri, poster), statusul curent și următorul episod anunțat.
// Toate vin din același răspuns TMDB, deci sunt gratuite oriunde avem deja
// `details` în mână.
//
// Ora exactă vine din altă parte: TMDB dă doar data (air_date), fără oră, așa
// că o luăm de la TVmaze — aceeași sursă folosită de wizard. `airstamp` e un
// instant ISO cu fus, deci browserul îl redă direct în ora României, fără să
// calculăm noi vreun offset. TVmaze e interogat doar când chiar există un
// episod următor, ca să nu-l batem degeaba pentru serialele încheiate.
//
// `markRefreshed` pornește ceasul de 12h (`meta_refreshed_at`) — doar
// reîmprospătarea completă, care actualizează și episoadele, are voie să-l
// pornească. Verificarea de episoade noi (la 3h) scria și ea aici, deci la
// un serial urmărit ceasul nu apuca niciodată 12h, iar numele și descrierile
// episoadelor nu se mai reîmprospătau deloc după descărcare (găsit pe 26 sept.
// 2026: Insula Iubirii rămăsese cu „Episodul 1–3” și fără descrieri, deși
// TMDB le avea de ore bune).
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
    airstamp =
      stamps.find(
        (a) => a.seasonNumber === next.seasonNumber && a.episodeNum === next.episodeNumber,
      )?.airstamp ?? null;
  }

  // Titlurile se împrospătează și ele. `title` (varianta de afișare, în
  // română) și `original_title` (cea în limba originală de producție) erau
  // scrise o singură dată, la crearea rândului, și rămâneau înghețate — iar
  // ramura de backfill nu completa deloc original_title și year. Rezultatul
  // s-a văzut la "The Rookie", importat din Plex pe 15 aug: title rămăsese
  // englezescul "The Rookie" deși TMDB are "Recrutul", iar original_title era
  // gol, deci nici titlul original nu apărea sub el.
  //
  // COALESCE + NULLIF: nu suprascriem cu gol dacă TMDB răspunde incomplet —
  // mai bine un titlu vechi decât niciunul.
  //
  // Descrierea, genurile și posterul la fel (din 26 sept. 2026): sunt cerute
  // în română la fiecare reîmprospătare, deci un serial adăugat înainte ca
  // TMDB să aibă traducerea sau posterul românesc le primește singur, la cel
  // mult 12 ore după ce apar pe TMDB. Fiecare câmp se scrie separat și doar
  // cu o valoare nevidă — ce lipsește la TMDB nu șterge ce avem.
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
    opts.markRefreshed ? 1 : 0,
    showId,
  );

  // Episoadele poartă titlul serialului, prin convenția din `media` — dacă
  // rămâneau pe cel vechi, un episod deschis singur ar fi arătat alt nume
  // decât serialul din care face parte. `original_title` contează în plus:
  // e cheia de rezervă la potrivirea vizionărilor cu Plex, când istoricul
  // vine fără ratingKey.
  //
  // Descrierea și genurile episoadelor sunt tot copii ale celor ale serialului
  // (upsertMediaEntry, desfacerea pachetelor), deci țin pasul cu ele. Posterul
  // nu: pe episoade e posterul SEZONULUI, ținut de syncEpisodeDetails — scris
  // și aici, cele două s-ar fi suprascris una pe alta la fiecare verificare.
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

// Serialele aflate chiar acum în verificare. Restul logicii e idempotentă
// pentru rulări SUCCESIVE (compară mereu realitatea), dar nu și pentru două
// rulări SIMULTANE: butonul "Verifică acum" apăsat în timpul unui ciclu
// automat ar face ambele să vadă aceleași episoade lipsă și să pornească
// același torrent de două ori, înainte ca vreuna să apuce să scrie ceva.
const inProgress = new Set<number>();

// Verifică un singur serial și pornește descărcările lipsă. Exportată separat
// de bucla periodică fiindcă butonul "Verifică acum" din drawer o cheamă
// direct, pentru serialul deschis.
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

  // datetime('now'), nu new Date().toISOString(): restul coloanelor de timp
  // din `media` sunt în formatul SQLite ("2026-09-06 07:54:16"), iar un ISO
  // complet ("...T07:54:16.987Z") strica două lucruri deodată. Afișarea —
  // conversia standard din UI îi mai adăuga un "Z" și ieșea dată invalidă.
  // Și, mai grav, programarea: comparația din checkDueShows e pe șiruri, iar
  // 'T' (84) > ' ' (32), deci un serial verificat azi nu devenea scadent în
  // aceeași zi oricâte ore treceau — urmărirea rula o dată pe zi, nu la 3 ore.
  const stamp = () =>
    db.prepare("UPDATE media SET watch_last_checked_at = datetime('now') WHERE id = ?").run(showId);
  // Notițele calității de rezervă (vezi fallback-quality.ts). Se rescriu la
  // fiecare verificare care a ajuns să compare calitățile: rămân doar țintele
  // la care încă se așteaptă principala.
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

  // Fără IMDb id nu avem cum căuta: căutarea pe Filelist e strict pe IMDb
  // (fallback-ul pe titlu a fost eliminat definitiv, confirmat de suport).
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

  // Un pachet de sezon pornit, dar încă neterminat, e un singur rând cu
  // episode NULL: episoadele lui apar abia după ce Plex îl indexează și
  // resolveSeasonPackPlexLinks îl desface. Până atunci episoadele lui ar
  // părea în continuare "lipsă", iar la ciclul următor am fi descărcat
  // episoadele individuale PESTE pachetul care oricum le aduce. Plasa cu
  // torrent_name de mai jos nu acoperă cazul ăsta — acolo e vorba de alt
  // torrent, cu alt nume.
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
  // Verificarea unui serial urmărit e și momentul în care îi împrospătăm
  // metadatele — datele sunt deja aici, ar fi risipă să le aruncăm.
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
    // La o eroare Filelist notițele rămân: nu știm nimic nou, iar ștergerea
    // lor ar reporni de la zero așteptarea după principală.
    if (search.status === "ok") saveFallbackSeen({});
    stamp();
    result.skipped =
      search.status === "ok" ? "niciun torrent pe Filelist" : (search.error ?? "eroare Filelist");
    return result;
  }

  const { detectTorrentQuality } = await import("./torrent-quality");
  const { parseSeasonEpisodeFromName } = await import("./torrent-name-parse");
  const wantedQuality = row.auto_download_quality || "1080p";

  // Torrente deja aduse (indiferent de stadiu) — plasa care ține rularea
  // idempotentă în fereastra dintre pornirea unui pachet de sezon și
  // apariția rândurilor lui per episod: până atunci episoadele încă apar
  // "lipsă", iar fără verificarea asta același pachet ar fi descărcat din
  // nou la fiecare ciclu.
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
    .map((t) => ({
      torrent: t,
      parsed: parseSeasonEpisodeFromName(t.name),
      quality: detectTorrentQuality(t.name),
    }))
    .filter((c) => c.parsed != null)
    .filter((c) => {
      const p = c.parsed!;
      if (p.episode != null) return missingKeys.has(formatEpisodeKey({ ...p, episode: p.episode }));
      // Pachet de sezon: util doar dacă acoperă măcar un episod lipsă.
      // Alegerea ta explicită e să-l luăm oricând acoperă ceva, chiar dacă
      // aduce și episoade deja deținute — singura excepție e pachetul din
      // care avem deja tot, care n-ar aduce nimic nou.
      return missing.some((k) => k.season === p.season);
    });

  // Episoadele lipsă pe care le-ar aduce un torrent (un pachet = tot ce
  // lipsește din sezonul lui).
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

  // Calitatea de rezervă (vezi fallback-quality.ts): contează doar pentru
  // ținte pe care principala nu le acoperă deloc — nici ca episod, nici prin
  // pachetul sezonului. Prima dată se notează și se așteaptă; se descarcă abia
  // la o verificare de peste cel puțin 3 ore, dacă principala tot lipsește.
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

  const candidates = [...primary, ...readyFallback]
    // Episoadele individuale au prioritate față de pachete (mai puțin trafic
    // pentru același rezultat), apoi principala față de rezervă, apoi seederi.
    .sort((a, b) => {
      const aPack = a.parsed!.episode == null ? 1 : 0;
      const bPack = b.parsed!.episode == null ? 1 : 0;
      const aFallback = a.quality === wantedQuality ? 0 : 1;
      const bFallback = b.quality === wantedQuality ? 0 : 1;
      return aPack - bPack || aFallback - bFallback || b.torrent.seeders - a.torrent.seeders;
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
  // Ce a adus urmărirea în verificarea asta — reperul până la care avansează
  // poziția de start (vezi watch-position.ts).
  const downloadedNow: EpisodeKey[] = [];

  for (const c of candidates) {
    if (result.downloaded.length >= MAX_DOWNLOADS_PER_RUN) break;
    const p = c.parsed!;
    // Nu porni două torrente care acoperă același episod în aceeași rulare
    // (ex. episodul individual și pachetul sezonului lui).
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
        // parent_id nu se trimite: upsertMediaEntry îl rezolvă singur, prin
        // ensureMediaPlaceholder, după tmdb_id/imdb_id/titlu — adică exact
        // rândul-serial de la care am pornit. Dublarea lui aici ar fi o a
        // doua sursă de adevăr pentru aceeași legătură.
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

  // O rezervă „gata" care n-a pornit acum (descărcare eșuată, sau limita de
  // descărcări pe verificare) rămâne gata și la verificarea următoare — nu
  // reîncepe așteptarea de 3 ore.
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

  // Poziția de start avansează peste ce tocmai a adus urmărirea, ca un episod
  // văzut și șters apoi din Bibliotecă să nu fie redescărcat (vezi
  // watch-position.ts pentru regulă și de ce se oprește la primul gol).
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

  // Fără notificare proprie aici: downloadFilelistCore loghează deja
  // torrent_added și trimite push-ul, iar `addedVia: "auto"` face titlul
  // notificării "🤖 Descărcare Automată" în loc de "⬇️ Descărcare Inițiată".
  // Un push în plus de-aici ar dubla fiecare episod.
  stamp();
  return result;
}

// Bucla periodică: verifică serialele urmărite cărora le-a expirat cadența
// de 3 ore. Cadența e persistată în DB (watch_last_checked_at), nu într-un
// timer în memorie — altfel fiecare restart al serviciului ar reporni
// numărătoarea de la zero.
export async function checkDueShows(): Promise<void> {
  const db = getDb();
  const due = db
    .prepare(
      `SELECT id FROM media
         WHERE media_type = 'tv_show' AND auto_download = 1
           AND (watch_last_checked_at IS NULL
                OR watch_last_checked_at <= datetime('now', ?))`,
    )
    .all(`-${Math.round(ITEM_INTERVAL_MS / 1000)} seconds`) as unknown as Array<{ id: number }>;

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
  // Calitatea de rezervă (vezi fallback-quality.ts). `undefined` = lasă
  // neschimbată; `null` = fără rezervă.
  fallbackQuality?: string | null;
  // "forward" (implicit) = doar episoadele care apar de-acum înainte;
  // "backfill" = și tot ce lipsește deja din istoric. Distincția contează:
  // pentru un serial cu 7 sezoane din care ai 2, "backfill" înseamnă câteva
  // zeci de episoade, deci trebuie să fie o alegere conștientă, nu implicită.
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

  // Dacă urmărirea e DEJA pornită, singurul lucru care se schimbă e calitatea.
  // Punctul de pornire rămâne neatins: recalculându-l, o simplă schimbare de
  // calitate ar muta `auto_download_from` la ultimul episod difuzat și ar sări
  // silențios peste episoadele care încă așteptau un torrent. E exact bug-ul
  // reparat în 4a94143 la implementarea veche ("pinForMonitoring rescria
  // necondiționat setările de urmărire, resetând silențios orice
  // personalizare"), doar cu alt nume.
  const current = db
    .prepare("SELECT auto_download FROM media WHERE id = ? AND media_type = 'tv_show'")
    .get(input.mediaId) as { auto_download: number } | undefined;
  if (current?.auto_download) {
    // Notițele rezervei se golesc la orice schimbare de calitate: erau despre
    // perechea veche (principală, rezervă), iar așteptarea reîncepe corect.
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
    // Punctul de plecare = ce e mai târziu dintre ultimul episod deținut și
    // ultimul difuzat. Fără el, un serial din care ai doar primele sezoane
    // ar declanșa la activare descărcarea a tot ce a apărut între timp.
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

// Cât timp mai sperăm că TMDB completează titlul unui episod deja difuzat,
// înainte să acceptăm placeholder-ul lui generic ca răspuns final.
const PLACEHOLDER_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

// "Episodul 8" / "Episode 8" — titlul generic pe care TMDB îl întoarce când
// episodul n-are (încă) nume propriu.
const GENERIC_EPISODE_TITLE = /^episo(?:dul|de)\s*\d+$/i;

// Detaliile episoadelor, de la TMDB: numele, descrierea, imaginea și data
// difuzării episodului, plus posterul sezonului (pe `poster_path`, locul
// posterului vertical din notificări și miniaturi). Totul cerut în română, cu engleza ca
// rezervă pentru ce lipsește (getTmdbAllSeasonsInternal cu `details`).
//
// Două feluri de rulare, ambele pe un singur serial:
// - `parentId` (imediat după ce se scrie un episod, vezi
//   syncEpisodeDetailsForShow): episoadele acelui serial cărora le lipsește
//   ceva — nume, descriere sau imagine — ca detaliile să apară odată cu
//   episodul.
// - `parentId` + `all` (reîmprospătarea serialului, la 12 ore): TOATE
//   episoadele lui. Așa ajunge româna când apare pe TMDB: un nume salvat în
//   engleză („Lights Out") e înlocuit cu cel românesc („Stingerea"), la cel
//   mult 12 ore după ce apare. Înainte, un episod cu nume nu mai era
//   verificat niciodată, deci engleza rămânea pe veci.
//
// (Până pe 26 sept. 2026 mai era un pas la 10 minute pentru episoadele fără
// nume. Scos la cererea userului: cele două rulări de mai sus îl acoperă, iar
// singurul lui câștig — numele real în cel mult 10 minute când, la
// descărcare, TMDB avea doar „Episodul N" — nu merita un pas separat.)
//
// Reguli la scriere: un nume se înlocuiește doar cu un nume real, niciodată
// cu „Episodul N"; descrierea, imaginea și posterul — doar cu valori nevide.
// Ce lipsește la TMDB nu șterge ce avem.
export async function syncEpisodeDetails(opts: {
  parentId: number;
  all?: boolean;
  // Câte o linie per episod schimbat, pentru jurnalul reîmprospătării.
  onEpisodeChange?: (line: string) => void;
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
  // Toate rândurile sunt ale aceluiași serial, deci o singură cerere TMDB
  // (sezoanele deținute, prin append_to_response).
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
        // Avem deja un nume (real sau placeholder acceptat) — un placeholder
        // nou nu-l înlocuiește.
        title = null;
      } else {
        // "Episodul 8" e placeholder-ul pe care TMDB îl întoarce cât timp
        // n-are încă titlul real — frecvent în primele ore după difuzare,
        // dar și permanent pentru emisiuni ale căror episoade n-au titluri
        // (reality show-uri, televiziune locală). Pentru un episod difuzat
        // recent îl lăsăm gol, ca reîmprospătarea să reîncerce; pentru unul
        // difuzat demult (sau fără dată la TMDB) îl acceptăm — nu mai are
        // rost să-l așteptăm (găsit la "Insula Iubirii" S10, unde TMDB n-are
        // titluri deloc). UI-ul ascunde oricum numele generice.
        const stillWorthWaiting =
          found.airDate != null &&
          Date.now() - new Date(found.airDate).getTime() <= PLACEHOLDER_GRACE_MS;
        if (stillWorthWaiting) title = null;
      }
    }

    const before = readEpisode.get(r.id) as Record<string, unknown> | undefined;
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
      );
    }
  }
  return changed;
}

// Detaliile episoadelor unui serial, imediat după ce i s-a scris un episod
// nou (descărcare pornită din wizard, căutare manuală sau urmărire;
// desfacerea unui pachet de sezon). Rulează în fundal: descărcarea nu
// așteaptă după TMDB, iar o eroare aici nu contează — reîmprospătarea de 12
// ore reîncearcă oricum.
export function syncEpisodeDetailsForShow(parentId: number | null): void {
  if (parentId == null) return;
  syncEpisodeDetails({ parentId }).catch((e) =>
    console.warn(`[show-watch] Detalii de episod necompletate pentru serialul ${parentId}:`, e),
  );
}

// ---------------------------------------------------------------------------
// Reîmprospătarea metadatelor de serial
// ---------------------------------------------------------------------------

// 12h per titlu, fără limită pe rulare: TMDB are limite generoase, iar o
// limită ar întârzia corecțiile la o bibliotecă mare (decizia userului, 26 sept.
// 2026). Aceeași cadență și pentru filme (movie-metadata.ts).
export const META_INTERVAL_MS = 12 * 60 * 60 * 1000;

// Ține la zi tv_status, următorul episod și detaliile (titluri, an,
// descriere, genuri, poster — vezi writeShowMeta) pentru TOATE serialele, nu
// doar pentru cele urmărite.
//
// tv_status era scris o singură dată, la prima descărcare, și rămânea așa pe
// veci. Conta: panoul de urmărire se ascunde exact pe `tv_status === 'Ended'`,
// deci un serial reînnoit după ce fusese marcat încheiat nu mai arăta
// niciodată butonul — adică fix pentru serialele NEurmărite era cel mai
// important să fie corect.
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

  // Marchează încercarea chiar și când TMDB n-a răspuns. `meta_refreshed_at`
  // se scrie altfel doar în writeShowMeta, deci un serial al cărui tmdb_id nu
  // mai rezolvă (șters de pe TMDB, id greșit) ar fi fost reîncercat la fiecare
  // rulare, adică la 10 minute, la nesfârșit. (Pe vremea limitei de 5 pe
  // rulare era mai rău: cinci astfel de seriale ocupau permanent tot LIMIT-ul
  // și blocau împrospătarea pentru toate celelalte.)
  //
  // Costul e că o pană TMDB trecătoare amână serialele atinse cu încă 12h.
  // Acceptabil: cadența nu e critică.
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
