import { writeFile, unlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { FilelistDownloadResult } from "./types";
import { CATEGORY_NAMES, parseCategoryId, isMovieCategory, isSeriesCategory } from "./categories";
import { downloadTorrentFile } from "./filelist-client";
import { parseSeasonEpisodeFromName } from "../media/torrent-name-parse";
import { qbitLogin, qbitEnsureCookie, resetQbitCookie } from "../qbit-client";
import { CORRECTED_OUTCOMES } from "./subtitle-outcomes";
import type { SubtitleRunItem, DeleteSubtitleResult } from "./subtitles";
import { refreshPlexLibrary } from "../plex-refresh";
// subtitles.ts se importă dinamic: folosește node:child_process (ffprobe), care
// n-are ce căuta în bundle-ul de client.

// Complet = 100% și o stare de seeding (sau oprit după seeding).
export function isTorrentComplete(progress: number, state: string): boolean {
  return (
    progress >= 1 &&
    (state.includes("UP") || state === "uploading" || state === "pausedUP" || state === "stalledUP")
  );
}

// Infohash-ul unui .torrent, din bytes (SHA1 peste dicționarul „info”) — fără
// qBittorrent. Varianta veche căuta hash-ul în qBittorrent după nume și eșua
// când numele intern diferea de cel de pe Filelist (2 sept. 2026).
function bencodeStringAt(buf: Buffer, start: number): { value: string; end: number } {
  const colon = buf.indexOf(0x3a, start);
  const len = parseInt(buf.toString("ascii", start, colon), 10);
  const strStart = colon + 1;
  const strEnd = strStart + len;
  return { value: buf.toString("latin1", strStart, strEnd), end: strEnd };
}

function bencodeSkip(buf: Buffer, start: number): number {
  const c = buf[start];
  if (c === 0x69 /* 'i' */) {
    const end = buf.indexOf(0x65, start);
    return end + 1;
  }
  if (c >= 0x30 && c <= 0x39 /* '0'-'9' -> string */) {
    return bencodeStringAt(buf, start).end;
  }
  if (c === 0x6c /* 'l' */) {
    let pos = start + 1;
    while (buf[pos] !== 0x65) pos = bencodeSkip(buf, pos);
    return pos + 1;
  }
  if (c === 0x64 /* 'd' */) {
    let pos = start + 1;
    while (buf[pos] !== 0x65) {
      pos = bencodeSkip(buf, pos); // cheie
      pos = bencodeSkip(buf, pos); // valoare
    }
    return pos + 1;
  }
  throw new Error(`bencode invalid la offset ${start}`);
}

function computeTorrentInfoHash(torrentBuffer: ArrayBuffer): string | null {
  try {
    const buf = Buffer.from(torrentBuffer);
    if (buf[0] !== 0x64 /* 'd' */) return null;
    let pos = 1;
    while (buf[pos] !== 0x65) {
      const key = bencodeStringAt(buf, pos);
      pos = key.end;
      if (key.value === "info") {
        const valueEnd = bencodeSkip(buf, pos);
        return createHash("sha1").update(buf.subarray(pos, valueEnd)).digest("hex");
      }
      pos = bencodeSkip(buf, pos);
    }
    return null;
  } catch (e) {
    console.warn("[filelist] Nu am putut calcula infohash local din .torrent:", e);
    return null;
  }
}

// Finalizarea unei descărcări ajunse la 100%: ID-ul IMDb în nume, completed_at,
// notificare, subtitrare română, refresh Plex. Apelată de sarcina „downloads”
// (download-tracker.ts), care face și legarea la Plex.
export async function finalizeDownload(t: {
  torrentHash: string;
  torrentName: string;
  isMovie: boolean;
  imdbId: string | null;
  qbitUrl: string;
  qbitUser: string;
  qbitPass: string;
}): Promise<void> {
  const { torrentHash, torrentName, imdbId, qbitUrl, qbitUser, qbitPass } = t;
  const plexType = t.isMovie ? "movie" : "show";

  // ID-ul IMDb în numele fișierelor (plex-id-hint.ts) — înaintea gărzii: un
  // restart între cele două lasă completed_at NULL, deci pasul se reia
  // (idempotent).
  const { applyPlexIdHint } = await import("./plex-id-hint");
  await applyPlexIdHint({ qbitUrl, qbitUser, qbitPass, torrentHash });

  // Garda atomică pe `media` (markMediaCompleted): o singură finalizare per
  // hash, oricâte rânduri are pachetul.
  const media = await import("../media/media");
  if (!media.markMediaCompleted(torrentHash)) {
    console.log(`[filelist] "${torrentName}" deja marcat complet — skip`);
    return;
  }
  console.log(`[filelist] "${torrentName}" complet — dau refresh Plex`);
  // O ștergere cerută în timpul descărcării tocmai și-a primit termenul.
  const { scheduledDeletion } = await import("../media/scheduled-delete");
  if (scheduledDeletion(torrentHash)) {
    const { pokeWatcher } = await import("../watcher/poke");
    pokeWatcher("scheduled-delete");
  }
  import("../notifications/notifications")
    .then(({ buildTorrentCompleteNotification }) =>
      buildTorrentCompleteNotification({ torrentName, imdb: imdbId, torrentHash }),
    )
    .then((n) =>
      import("../activity-log").then(({ logActivity }) =>
        logActivity(
          "torrent_complete",
          n.body,
          { torrentHash },
          {
            image: n.image,
            url: n.url,
            title: n.title,
            tag: `torrent-${torrentHash}`,
          },
        ),
      ),
    )
    .catch(() => {});
  try {
    const { ensureRomanianSubtitle, logSubtitleRun } = await import("./subtitles");
    const subtitleItem = await ensureRomanianSubtitle({
      qbitUrl,
      qbitUser,
      qbitPass,
      torrentHash,
      torrentName,
      imdbId,
      mediaType: t.isMovie ? "movie" : "tv",
    });
    await logSubtitleRun([subtitleItem], "download");
    media.updateMediaSubtitleStatus(torrentHash, subtitleItem);
  } catch (e) {
    console.warn(`[filelist] Eroare subtitrare pentru "${torrentName}":`, e);
  }
  await refreshPlexLibrary(plexType);
  console.log(`[filelist] Plex refresh trimis pentru "${plexType}"`);
}

// ---------------------------------------------------------------------------
// Server function: descarcă torrent și trimite la qBittorrent
// ---------------------------------------------------------------------------

export interface DownloadFilelistParams {
  torrentId: number;
  torrentName: string;
  categoryId: number;
  categoryName?: string;
  size?: number;
  freeleech?: boolean;
  internal?: boolean;
  imdb?: string | null;
  requestedByUserId?: number | null;
  // Metadatele TMDB, gata calculate de wizard/urmărire. Lipsesc la căutarea
  // manuală pe Filelist — atunci încearcă autoResolveManualMedia.
  media?: Omit<
    import("../media/media").UpsertMediaEntryInput,
    | "torrentName"
    | "torrentHash"
    | "filelistId"
    | "category"
    | "categoryName"
    | "size"
    | "freeleech"
    | "internal"
    | "savePath"
    | "requestedByUserId"
  >;
}

// Metadatele TMDB pentru o descărcare din căutarea manuală, best-effort: după
// IMDb id-ul confirmat de Filelist, altfel după numele lansării. null = fără.
async function autoResolveManualMedia(
  torrentImdb: string | null | undefined,
  torrentName: string,
  isMovie: boolean,
): Promise<DownloadFilelistParams["media"] | null> {
  const mediaType: "movie" | "tv" = isMovie ? "movie" : "tv";
  let imdbId = torrentImdb ?? null;
  if (!imdbId) {
    const { searchImdbIdByReleaseName } = await import("../tmdb/tmdb-title-lookup");
    const found = await searchImdbIdByReleaseName(torrentName, mediaType).catch(() => null);
    imdbId = found?.imdbId ?? null;
  }
  if (!imdbId) return null;

  const { lookupTmdbInfoByImdbId } = await import("../tmdb/tmdb-title-lookup");
  const info = await lookupTmdbInfoByImdbId(imdbId).catch(() => null);
  if (!info) return null;

  const { getTmdbDetailsInternal } = await import("../tmdb/tmdb.functions");
  const details = await getTmdbDetailsInternal(info.id, info.mediaType).catch(() => null);
  const parsed = !isMovie ? parseSeasonEpisodeFromName(torrentName) : null;

  return {
    mediaType: isMovie ? "movie" : "episode",
    imdbId,
    tmdbId: info.id,
    title: info.title,
    originalTitle: details?.originalTitle ?? null,
    literalTitle: details?.literalTitle ?? null,
    year: info.year ? Number(info.year) : null,
    season: parsed?.season ?? null,
    episode: parsed?.episode ?? null,
    overviewRo: details?.overview ?? null,
    genres: details?.genres ?? [],
    posterPath: info.posterPath ? `https://image.tmdb.org/t/p/w342${info.posterPath}` : null,
    tvStatus: !isMovie ? (details?.tvStatus ?? null) : null,
    isSeasonPack: !!parsed && parsed.episode === null,
    addedVia: "manual",
  };
}

// Film sau serial — decide folderul, categoria qBittorrent, rândul din `media`
// și biblioteca Plex. Întâi ce a cerut omul, apoi categoria; la categoriile
// mixte (RO Dubbed) întrebăm TMDB după IMDb, iar fără el căutăm S01/S01E02.
async function resolveIsMovie(params: DownloadFilelistParams, catId: number): Promise<boolean> {
  if (params.media) return params.media.mediaType === "movie";
  if (isMovieCategory(catId)) return true;
  if (isSeriesCategory(catId)) return false;
  if (catId === 0) return /film|movie/i.test(params.categoryName ?? "");
  if (params.imdb) {
    const { lookupTmdbInfoByImdbId } = await import("../tmdb/tmdb-title-lookup");
    const info = await lookupTmdbInfoByImdbId(params.imdb).catch(() => null);
    if (info) return info.mediaType === "movie";
  }
  return parseSeasonEpisodeFromName(params.torrentName) === null;
}

// Descărcarea + trimiterea la qBittorrent, pentru downloadFilelist.
export async function downloadFilelistCore(
  params: DownloadFilelistParams,
): Promise<FilelistDownloadResult> {
  const username = process.env.FILELIST_USERNAME;
  const passkey = process.env.FILELIST_PASSKEY;
  const qbitBase = process.env.QBIT_URL ?? "http://192.168.1.192:25556";
  const qbitUser = process.env.QBIT_USERNAME;
  const qbitPass = process.env.QBIT_PASSWORD;
  const moviesPath = process.env.MEDIA_MOVIES_PATH ?? "/media/ssd2tb/Filme";
  const seriesPath = process.env.MEDIA_SERIES_PATH ?? "/media/ssd2tb/Seriale";

  if (!username || !passkey) {
    return { status: "error", error: "FILELIST_USERNAME / FILELIST_PASSKEY nu sunt configurate" };
  }
  if (!qbitUser || !qbitPass) {
    return { status: "error", error: "QBIT_USERNAME / QBIT_PASSWORD nu sunt configurate" };
  }

  const catId =
    params.categoryId || (params.categoryName ? parseCategoryId(params.categoryName) : 0);
  const isMovie = await resolveIsMovie(params, catId);
  const savePath = isMovie ? moviesPath : seriesPath;

  // 1. Descarcă fișierul .torrent de la Filelist
  let torrentBuffer: ArrayBuffer;
  try {
    torrentBuffer = await downloadTorrentFile(params.torrentId);
  } catch (e) {
    return {
      status: "error",
      error: `Eroare rețea Filelist: ${e instanceof Error ? e.message : e}`,
    };
  }

  // 2. Scrie temporar fișierul .torrent pe disk
  const safeName = params.torrentName.replace(/[^a-z0-9_\-. ]/gi, "_").slice(0, 80);
  const tmpPath = join(tmpdir(), `faikkitbox_${params.torrentId}_${Date.now()}.torrent`);
  await writeFile(tmpPath, Buffer.from(torrentBuffer));

  try {
    // 3. Autentifică-te la qBittorrent
    const url = qbitBase.replace(/\/$/, "");
    let cookie: string;
    try {
      cookie = await qbitEnsureCookie(url, qbitUser, qbitPass);
    } catch {
      resetQbitCookie();
      cookie = await qbitLogin(url, qbitUser, qbitPass);
    }

    // 4. Trimite torrentul la qBittorrent cu save path corect
    const form = new FormData();
    const fileBytes = await readFile(tmpPath);
    form.append(
      "torrents",
      new Blob([fileBytes], { type: "application/x-bittorrent" }),
      `${safeName}.torrent`,
    );
    form.append("savepath", savePath);
    form.append("category", isMovie ? "filme" : "seriale");

    let uploadRes = await fetch(`${url}/api/v2/torrents/add`, {
      method: "POST",
      headers: { Cookie: cookie, Referer: url, Origin: url },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });

    // Un SID expirat primește tot 403 (nu 401) — reîncercăm o dată cu login
    // proaspăt. Alte erori nu se rezolvă prin relogin.
    if (uploadRes.status === 401 || uploadRes.status === 403) {
      resetQbitCookie();
      cookie = await qbitLogin(url, qbitUser, qbitPass);
      uploadRes = await fetch(`${url}/api/v2/torrents/add`, {
        method: "POST",
        headers: { Cookie: cookie, Referer: url, Origin: url },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
    }

    if (!uploadRes.ok) {
      const txt = await uploadRes.text().catch(() => "");
      return {
        status: "error",
        error: `qBittorrent upload eșuat: HTTP ${uploadRes.status} ${txt.slice(0, 120)}`,
      };
    }

    const uploadText = await uploadRes.text();
    if (!uploadText.includes("Ok")) {
      console.warn("qBit upload răspuns neașteptat:", uploadText);
    }

    // 5–7 rulează în fundal: clientul n-are nevoie de hash ca să știe că
    // trimiterea a reușit.
    const catName = params.categoryName || CATEGORY_NAMES[catId] || `Cat ${catId}`;
    finishFilelistDownload({
      params,
      catId,
      catName,
      savePath,
      isMovie,
      torrentHash: computeTorrentInfoHash(torrentBuffer),
    }).catch((e) => console.error("[filelist] Eroare la finalizarea descărcării în fundal:", e));

    return { status: "ok", torrentName: params.torrentName, savePath };
  } finally {
    // Curăță fișierul temporar
    await unlink(tmpPath).catch(() => {});
  }
}

// Pașii 5–7, fără await, după ce qBittorrent a confirmat torrentul.
async function finishFilelistDownload(ctx: {
  params: DownloadFilelistParams;
  catId: number;
  catName: string;
  savePath: string;
  isMovie: boolean;
  torrentHash: string | null;
}): Promise<void> {
  const { params, catId, catName, savePath, isMovie, torrentHash } = ctx;

  // 6. `media` ÎNAINTE de notificare — notificarea citește titlul și posterul
  // de aici, nu printr-un lookup TMDB paralel.
  const mediaPayload =
    params.media ??
    (await autoResolveManualMedia(params.imdb, params.torrentName, isMovie).catch((e) => {
      console.warn("[filelist] Rezolvare automată media eșuată:", e);
      return null;
    }));
  // Și fără titlu identificat se scrie un rând, cu numele lansării: e singura
  // urmă a descărcării — fără el n-ar apărea în Bibliotecă și n-ar fi urmărită
  // până la final (subtitrare, notificare, Plex), fără ca nimic să se plângă.
  const { upsertMediaEntry } = await import("../media/media");
  const parsed = isMovie ? null : parseSeasonEpisodeFromName(params.torrentName);
  const fallbackPayload = {
    mediaType: (isMovie ? "movie" : "episode") as "movie" | "episode",
    imdbId: params.imdb ?? null,
    tmdbId: null,
    title: params.torrentName,
    season: parsed?.season ?? null,
    episode: parsed?.episode ?? null,
    isSeasonPack: !isMovie && parsed?.episode == null,
    addedVia: "manual" as const,
  };
  try {
    const mediaId = upsertMediaEntry({
      ...(mediaPayload ?? fallbackPayload),
      torrentName: params.torrentName,
      torrentHash: torrentHash ?? null,
      filelistId: params.torrentId,
      category: catId,
      categoryName: catName,
      size: params.size ?? 0,
      freeleech: params.freeleech ?? false,
      internal: params.internal ?? false,
      savePath,
      requestedByUserId: params.requestedByUserId ?? null,
    });
    // Detaliile episodului acum, nu la reîmprospătarea de 12h. Un pachet le
    // primește la desfacere.
    if (!isMovie) {
      const { getDb } = await import("../db");
      const parent = getDb().prepare("SELECT parent_id FROM media WHERE id = ?").get(mediaId) as
        { parent_id: number | null } | undefined;
      const { syncEpisodeDetailsForShow } = await import("../media/show-watch");
      syncEpisodeDetailsForShow(parent?.parent_id ?? null);
    }
  } catch (e) {
    console.warn("[filelist] Nu am putut scrie în tabela media:", e);
  }

  // 7. Jurnalul, imediat (completedAt null = în curs)
  import("../notifications/notifications")
    .then(({ buildTorrentAddedNotification }) =>
      buildTorrentAddedNotification({
        torrentName: params.torrentName,
        imdb: params.imdb,
        torrentHash,
        auto: params.media?.addedVia === "auto",
      }),
    )
    .then((n) =>
      import("../activity-log").then(({ logActivity }) =>
        logActivity(
          "torrent_added",
          n.body,
          {
            category: catName,
            savePath,
            size: params.size,
            torrentHash: torrentHash ?? undefined,
          },
          {
            image: n.image,
            url: n.url,
            title: n.title,
            // Fără hash, fără tag — un tag comun ar înlocui notificări diferite.
            tag: torrentHash ? `torrent-${torrentHash}` : undefined,
          },
        ),
      ),
    )
    .catch(() => {});

  // 8. Urmărirea până la final e a sarcinii „downloads” — o trezim.
  if (torrentHash) {
    const { pokeWatcher } = await import("../watcher/poke");
    pokeWatcher("downloads");
  } else {
    console.warn("[filelist] Hash nedisponibil — descărcarea nu poate fi urmărită până la final");
  }
}

// Corectează subtitrarea unui singur titlu, cu aceeași logică
// (ensureRomanianSubtitle), direct pe hash-ul lui.
export type CorrectSubtitleResult =
  ({ status: "ok" } & SubtitleRunItem) | { status: "error"; error: string };

// ---------------------------------------------------------------------------
// Variantele pe `media.id`, pentru Bibliotecă.
// ---------------------------------------------------------------------------

interface MediaActionRow {
  torrent_name: string | null;
  torrent_hash: string | null;
  imdb_id: string | null;
  media_type: string;
  requested_by_user_id: number | null;
}

export async function correctSubtitleForMediaCore(
  session: { data: { admin?: boolean; userId?: number } },
  data: { mediaId: number },
): Promise<CorrectSubtitleResult> {
  {
    const { isAdminOrOwner } = await import("../auth/admin.server");
    const { getDb } = await import("../db");
    const row = getDb()
      .prepare(
        "SELECT torrent_name, torrent_hash, imdb_id, media_type, requested_by_user_id FROM media WHERE id = ?",
      )
      .get(data.mediaId) as MediaActionRow | undefined;

    if (!row) {
      return { status: "error", error: "Titlul nu a fost găsit" };
    }
    if (!isAdminOrOwner(session, row.requested_by_user_id)) {
      return {
        status: "error",
        error: "Doar cel care a adăugat titlul sau un admin poate corecta subtitrarea",
      };
    }
    if (!row.torrent_hash) {
      return {
        status: "error",
        error: "Hash-ul torrentului e necunoscut — nu poate fi gestionat automat",
      };
    }

    return checkSubtitleForTorrent(
      {
        torrentName: row.torrent_name,
        torrentHash: row.torrent_hash,
        imdbId: row.imdb_id,
        isMovie: row.media_type === "movie",
      },
      { logRun: "always" },
    );
  }
}

// Verificarea/corectarea subtitrării unui torrent, cu jurnal, stare în DB și
// refresh Plex dacă s-a schimbat ceva. Folosită de „Corectează subtitrare” și
// de reîncercarea zilnică; `logRun: "corrected"` scrie în jurnal doar când s-a
// pus efectiv o subtitrare (altfel „tot nimic” zilnic).
export async function checkSubtitleForTorrent(
  row: {
    torrentName: string | null;
    torrentHash: string;
    imdbId: string | null;
    isMovie: boolean;
  },
  opts: {
    logRun: "always" | "corrected";
    upgradeApproximate?: boolean;
    approximateEpisodes?: ReadonlySet<string>;
    via?: "retry";
  },
): Promise<CorrectSubtitleResult> {
  const qbitBase = process.env.QBIT_URL ?? "http://192.168.1.192:25556";
  const qbitUser = process.env.QBIT_USERNAME;
  const qbitPass = process.env.QBIT_PASSWORD;
  if (!qbitUser || !qbitPass) {
    return { status: "error", error: "QBIT_USERNAME / QBIT_PASSWORD nu sunt configurate" };
  }
  const url = qbitBase.replace(/\/$/, "");

  const { ensureRomanianSubtitle, logSubtitleRun } = await import("./subtitles");
  const plexType = row.isMovie ? "movie" : "show";

  const result = await ensureRomanianSubtitle({
    qbitUrl: url,
    qbitUser,
    qbitPass,
    torrentHash: row.torrentHash,
    torrentName: row.torrentName ?? "",
    imdbId: row.imdbId ?? undefined,
    mediaType: plexType === "movie" ? "movie" : "tv",
    upgradeApproximate: opts.upgradeApproximate,
    approximateEpisodes: opts.approximateEpisodes,
  });

  const corrected = CORRECTED_OUTCOMES.includes(result.outcome);
  if (opts.logRun === "always" || corrected)
    await logSubtitleRun([result], "download", { via: opts.via });
  const { updateMediaSubtitleStatus } = await import("../media/media");
  updateMediaSubtitleStatus(row.torrentHash, result);
  if (corrected) {
    await refreshPlexLibrary(plexType).catch(() => {});
  }

  return { status: "ok", ...result };
}

export async function deleteSubtitleForMediaCore(
  session: { data: { admin?: boolean; userId?: number } },
  data: { mediaId: number },
): Promise<DeleteSubtitleResult> {
  {
    const { isAdminOrOwner } = await import("../auth/admin.server");
    const { getDb } = await import("../db");
    const row = getDb()
      .prepare(
        "SELECT torrent_name, torrent_hash, imdb_id, media_type, requested_by_user_id FROM media WHERE id = ?",
      )
      .get(data.mediaId) as MediaActionRow | undefined;

    if (!row) {
      return { status: "error", deleted: [], error: "Titlul nu a fost găsit" };
    }
    if (!isAdminOrOwner(session, row.requested_by_user_id)) {
      return {
        status: "error",
        deleted: [],
        error: "Doar cel care a adăugat titlul sau un admin poate șterge subtitrarea",
      };
    }
    if (!row.torrent_hash) {
      return {
        status: "error",
        deleted: [],
        error: "Hash-ul torrentului e necunoscut — nu poate fi gestionat automat",
      };
    }

    const qbitBase = process.env.QBIT_URL ?? "http://192.168.1.192:25556";
    const qbitUser = process.env.QBIT_USERNAME;
    const qbitPass = process.env.QBIT_PASSWORD;
    if (!qbitUser || !qbitPass) {
      return {
        status: "error",
        deleted: [],
        error: "QBIT_USERNAME / QBIT_PASSWORD nu sunt configurate",
      };
    }
    const url = qbitBase.replace(/\/$/, "");

    const { deleteRomanianSubtitle } = await import("./subtitles");
    const result = await deleteRomanianSubtitle({
      qbitUrl: url,
      qbitUser,
      qbitPass,
      torrentHash: row.torrent_hash,
    });

    if (result.status === "ok") {
      const { clearMediaSubtitleStatus } = await import("../media/media");
      clearMediaSubtitleStatus(row.torrent_hash);
      const { refreshPlexLibrary } = await import("../plex-refresh");
      await refreshPlexLibrary(row.media_type === "movie" ? "movie" : "show").catch(() => {});
    }

    return result;
  }
}
