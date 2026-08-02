// ---------------------------------------------------------------------------
// Plugin: verifică periodic itemele fixate cu watch activat, la exact 3 ore
// per item — indiferent de restart-uri ale serviciului.
// Detectează: torrente noi pe Filelist, episoade noi lansate (TMDB),
// episoade/filme noi apărute în Plex.
// Fiecare tip de notificare are toggle independent per item.
// Prima rulare per item = baseline (fără notificări).
//
// Bucla internă (setInterval) rulează des (POLL_INTERVAL_MS), dar pentru
// fiecare item se uită la `last_checked_at` din pinned_watch_state (SQLite)
// și sare peste el dacă n-au trecut ITEM_INTERVAL_MS — nu ținem un timer în
// memorie (s-ar reseta la fiecare restart), ci folosim timestamp-ul deja
// persistat per item.
// ---------------------------------------------------------------------------

const ITEM_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 ore — cadența reală per item
const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 min — cât de des verificăm ce a expirat
const TMDB_BASE = "https://api.themoviedb.org/3";

// IMDB ID + titlul literal/romanizat (ex. "Gunche" pentru 군체 — ce arată
// IMDB drept titlu original, folosit efectiv în numele lansărilor de pe
// Filelist) — un singur apel TMDB (append_to_response), necesar pentru
// checkFilelistForItemInternal, care caută prioritar după IMDB ID, apoi
// titlul original literal, apoi cel englez.
async function getTmdbFilelistHints(
  tmdbId: number,
  mediaType: "movie" | "tv",
): Promise<{ imdbId: string | null; literalTitle: string | null }> {
  const key = process.env.TMDB_API_KEY;
  const empty = { imdbId: null, literalTitle: null };
  if (!key) return empty;
  try {
    const res = await fetch(
      `${TMDB_BASE}/${mediaType}/${tmdbId}?append_to_response=external_ids,alternative_titles`,
      {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return empty;
    const json: {
      external_ids?: { imdb_id?: string | null };
      alternative_titles?: {
        titles?: Array<{ type?: string; title?: string }>;
        results?: Array<{ type?: string; title?: string }>;
      };
    } = await res.json();
    const altTitles = json.alternative_titles?.titles ?? json.alternative_titles?.results ?? [];
    const literalTitle = altTitles.find((t) => t.type === "literal title")?.title ?? null;
    return { imdbId: json.external_ids?.imdb_id ?? null, literalTitle };
  } catch {
    return empty;
  }
}

function detectTorrentQuality(name: string): string {
  const n = name.toLowerCase();
  const is4k = /\b(4k|2160p)\b/.test(n);
  const isHdr = /\b(dovi|hdr10|hdr|hlg)\b/.test(n);
  if (is4k && isHdr) return "4K HDR";
  if (is4k) return "4K";
  if (/\b1080p\b/.test(n)) return "1080p";
  if (/\b720p\b/.test(n)) return "720p";
  return "SD";
}

function epKey(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

async function getLatestAiredTmdb(
  tmdbId: number,
): Promise<{ season: number; episode: number; title: string } | null> {
  const key = process.env.TMDB_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${TMDB_BASE}/tv/${tmdbId}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json: {
      last_episode_to_air?: { season_number?: number; episode_number?: number; name?: string };
    } = await res.json();
    const last = json.last_episode_to_air;
    if (!last) return null;
    return {
      season: Number(last.season_number),
      episode: Number(last.episode_number),
      title: String(last.name ?? ""),
    };
  } catch {
    return null;
  }
}

interface WatchRow {
  last_checked_at: string | null;
  seen_torrent_ids: string;
  last_aired_key: string | null;
  plex_episode_keys: string;
  plex_movie_found: number | null;
}

// `force` = true ignoră gate-ul de 3 ore per item — folosit de butonul manual
// "Rulează acum" din Tehnic (triggerPinnedWatcherCheck), ca declanșarea
// explicită a adminului să chiar verifice tot, nu doar itemele care oricum
// erau deja due.
export async function checkAll(force = false): Promise<void> {
  try {
    const { getDb } = await import("../../src/lib/db");
    const { logActivity } = await import("../../src/lib/activity-log");
    const { sendPushToAll } = await import("../../src/lib/push");
    const { checkFilelistForItemInternal, downloadFilelistInternal } =
      await import("../../src/lib/filelist.functions");
    const { getPlexEpisodesInSeasonInternal, checkPlexHasTitleInternal } =
      await import("../../src/lib/services.functions");

    const db = getDb();

    const items = db
      .prepare(
        `SELECT pi.id, pi.media_type, pi.title, pi.original_title,
                pw.watch_filelist, pw.watch_filelist_season, pw.watch_tmdb, pw.watch_plex,
                pw.auto_download, pw.auto_download_quality
         FROM pinned_items pi
         JOIN pinned_watch_settings pw ON pw.id = pi.id AND pw.media_type = pi.media_type
         WHERE pw.watch_filelist = 1 OR pw.watch_tmdb = 1 OR pw.watch_plex = 1`,
      )
      .all() as Array<{
      id: number;
      media_type: string;
      title: string;
      original_title: string;
      watch_filelist: number;
      watch_filelist_season: number;
      watch_tmdb: number;
      watch_plex: number;
      auto_download: number;
      auto_download_quality: string;
    }>;

    if (items.length === 0) return;

    let dueCount = 0;

    for (const item of items) {
      try {
        const stateRow = db
          .prepare("SELECT * FROM pinned_watch_state WHERE id = ? AND media_type = ?")
          .get(item.id, item.media_type) as WatchRow | undefined;

        // Cadență strictă de 3 ore per item, persistată în DB — supraviețuiește
        // restart-urilor serviciului (nu se bazează pe un timer în memorie).
        if (!force && stateRow?.last_checked_at) {
          const elapsedMs = Date.now() - new Date(stateRow.last_checked_at).getTime();
          if (elapsedMs < ITEM_INTERVAL_MS) continue;
        }

        dueCount++;

        const isFirstRun = !stateRow || stateRow.last_checked_at === null;
        const seenTorrentIds = new Set<number>(JSON.parse(stateRow?.seen_torrent_ids || "[]"));
        const plexEpKeys = new Set<string>(JSON.parse(stateRow?.plex_episode_keys || "[]"));
        const lastAiredKey: string | null = stateRow?.last_aired_key ?? null;
        const plexMovieFound: boolean | null =
          stateRow?.plex_movie_found !== null && stateRow?.plex_movie_found !== undefined
            ? !!stateRow.plex_movie_found
            : null;

        const changes: string[] = [];
        const notifications: Array<{ title: string; body: string }> = [];
        const journalEntries: string[] = [];
        let newLastAiredKey = lastAiredKey;
        let newPlexMovieFound = plexMovieFound;

        // ── 1. Sezon curent din TMDB (necesar și pentru filtrul Filelist) ────
        let latestAired: { season: number; episode: number; title: string } | null = null;
        if (
          item.media_type === "tv" &&
          (item.watch_tmdb || item.watch_plex || item.watch_filelist_season)
        ) {
          latestAired = await getLatestAiredTmdb(item.id);
          if (latestAired) {
            const key = epKey(latestAired.season, latestAired.episode);
            if (item.watch_tmdb && !isFirstRun && lastAiredKey && key !== lastAiredKey) {
              const epLabel = `${key}${latestAired.title ? ` — ${latestAired.title}` : ""}`;
              changes.push(`📅 Episod nou lansat: ${epLabel}`);
              journalEntries.push(`📅 Episod nou lansat: ${epLabel}`);
              notifications.push({
                title: `📅 ${item.title} — Episod nou`,
                body: epLabel,
              });
            }
            newLastAiredKey = key;
          }
        }

        // ── 2. Filelist ──────────────────────────────────────────────────────
        if (item.watch_filelist) {
          const mediaType = item.media_type as "movie" | "tv";
          const { imdbId, literalTitle } = await getTmdbFilelistHints(item.id, mediaType);
          const result = await checkFilelistForItemInternal({
            title: item.title,
            originalTitle: literalTitle || item.original_title || item.title,
            imdbId,
            mediaType,
          });
          const matchedTorrents = result.status === "ok" ? result.torrents : [];
          const newTorrents = matchedTorrents.filter((t) => !seenTorrentIds.has(t.id));
          for (const t of newTorrents) seenTorrentIds.add(t.id);

          if (!isFirstRun && newTorrents.length > 0) {
            let toNotify = newTorrents;
            // Filtru opțional: doar sezonul curent
            if (item.watch_filelist_season && latestAired) {
              const seasonPad = String(latestAired.season).padStart(2, "0");
              const seasonRe = new RegExp(`S${seasonPad}`, "i");
              toNotify = newTorrents.filter((t) => seasonRe.test(t.name));
            }

            if (toNotify.length > 0) {
              // Detectăm calitățile unice, în ordine
              const ORDER = ["4K HDR", "4K", "1080p", "720p", "SD"];
              const qualitiesFound = [
                ...new Set(toNotify.map((t) => detectTorrentQuality(t.name))),
              ].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
              const epLabel = latestAired ? epKey(latestAired.season, latestAired.episode) : "";
              const torrentLabel = epLabel
                ? `${epLabel}: ${qualitiesFound.join(", ")}`
                : qualitiesFound.join(", ");
              changes.push(`🎞 Torrente noi: ${torrentLabel}`);
              journalEntries.push(`🎞 Torrente noi: ${torrentLabel}`);
              notifications.push({
                title: `🎞 ${item.title} — Torrente noi`,
                body: torrentLabel,
              });

              // Auto-download: cel mai bun torrent din calitatea dorită —
              // DOAR dintre cele confirmate prin IMDb ID (matchedByImdb).
              // Torrentele găsite doar prin potrivire de text pe titlu pot fi
              // alt film/serial cu nume asemănător (ex. un documentar
              // "making of" al aceluiași titlu) — prea riscant pentru o
              // descărcare pornită fără confirmare umană.
              if (item.auto_download) {
                const quality = item.auto_download_quality || "1080p";
                const unconfirmedExists = toNotify.some(
                  (t) => detectTorrentQuality(t.name) === quality && !t.matchedByImdb,
                );
                const candidates = toNotify.filter(
                  (t) => detectTorrentQuality(t.name) === quality && t.matchedByImdb,
                );
                const best = candidates.sort((a, b) => b.seeders - a.seeders)[0];
                if (best) {
                  try {
                    const dlResult = await downloadFilelistInternal({
                      torrentId: best.id,
                      torrentName: best.name,
                      categoryId: best.category,
                      categoryName: best.categoryName,
                      size: best.size,
                      freeleech: best.freeleech,
                      internal: best.internal,
                      skipLog: true,
                    });
                    if (dlResult.status === "ok") {
                      changes.push(`⬇️ Auto-descărcat (${quality}): ${best.name}`);
                      journalEntries.push(`⬇️ Auto-descărcat (${quality}): ${best.name}`);
                      notifications.push({
                        title: `⬇️ ${item.title} — Descărcare automată`,
                        body: `${quality}: ${best.name}`,
                      });
                    } else {
                      console.warn(
                        `[pinned-watcher] Auto-download eșuat pentru "${item.title}": ${dlResult.error}`,
                      );
                    }
                  } catch (e) {
                    console.warn("[pinned-watcher] Eroare auto-download:", e);
                  }
                } else if (unconfirmedExists) {
                  console.log(
                    `[pinned-watcher] Auto-download sărit pentru "${item.title}": există torrent ${quality}, dar niciunul confirmat prin IMDb ID`,
                  );
                } else {
                  console.log(`[pinned-watcher] Auto-download: niciun torrent ${quality} găsit`);
                }
              }
            } else {
              for (const t of newTorrents) {
                changes.push(`🎞 Torrent nou (alt sezon): ${t.name}`);
              }
            }
          }
        }

        // ── 3. Episoade/filme noi în Plex ────────────────────────────────────
        if (item.watch_plex) {
          if (item.media_type === "tv" && latestAired) {
            const showTitle = item.original_title || item.title;
            const plexEps = await getPlexEpisodesInSeasonInternal(showTitle, latestAired.season);
            for (const ep of plexEps) {
              const k = epKey(latestAired.season, ep.num);
              if (!plexEpKeys.has(k)) {
                plexEpKeys.add(k);
                if (!isFirstRun) {
                  const qStr = ep.quality ? ` (${ep.quality})` : "";
                  changes.push(`📺 Episod nou în Plex: ${k}${qStr}`);
                  journalEntries.push(`📺 Episod nou în Plex: ${k}${qStr}`);
                  notifications.push({
                    title: `📺 ${item.title} — în Plex`,
                    body: `${k}${qStr}`,
                  });
                }
              }
            }
          }

          if (item.media_type === "movie") {
            const result = await checkPlexHasTitleInternal(
              item.title,
              item.original_title,
              "movie",
            );
            if (result !== null) {
              if (!isFirstRun && plexMovieFound === false && result.found) {
                const qStr = result.quality ? ` (${result.quality})` : "";
                changes.push(`📺 Film adăugat în Plex${qStr}`);
                journalEntries.push(`📺 Film adăugat în Plex${qStr}`);
                notifications.push({
                  title: `📺 ${item.title} — în Plex`,
                  body: `Film disponibil${qStr}`,
                });
              }
              newPlexMovieFound = result.found;
            }
          }
        }

        // ── Salvare stare ────────────────────────────────────────────────────
        db.prepare(
          `INSERT INTO pinned_watch_state
             (id, media_type, last_checked_at, seen_torrent_ids, last_aired_key, plex_episode_keys, plex_movie_found)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id, media_type) DO UPDATE SET
             last_checked_at = excluded.last_checked_at,
             seen_torrent_ids = excluded.seen_torrent_ids,
             last_aired_key = excluded.last_aired_key,
             plex_episode_keys = excluded.plex_episode_keys,
             plex_movie_found = excluded.plex_movie_found`,
        ).run(
          item.id,
          item.media_type,
          new Date().toISOString(),
          JSON.stringify(Array.from(seenTorrentIds)),
          newLastAiredKey,
          JSON.stringify(Array.from(plexEpKeys)),
          newPlexMovieFound !== null ? (newPlexMovieFound ? 1 : 0) : null,
        );

        if (changes.length === 0) {
          console.log(`[pinned-watcher] "${item.title}" — nicio modificare`);
          continue;
        }

        console.log(`[pinned-watcher] "${item.title}" — ${changes.length} modificare(i)`);
        for (const entry of journalEntries) {
          await logActivity("pinned_update", `${item.title}: ${entry}`, { title: item.title });
        }
        for (const notif of notifications) {
          await sendPushToAll(notif.title, notif.body);
        }
      } catch (e) {
        console.warn(`[pinned-watcher] Eroare la "${item.title}":`, e);
      }
    }

    if (dueCount > 0) {
      console.log(
        `[pinned-watcher] Verificate ${dueCount}/${items.length} item(e)${force ? " (forțat)" : ""}`,
      );
    }
  } catch (e) {
    console.warn("[pinned-watcher] Eroare generală:", e);
  }
}

export default function () {
  // Idempotent — garantează că patch-ul de captare console.warn/error e
  // instalat indiferent de ordinea de încărcare față de src/server.ts.
  import("../../src/lib/console-capture").then(({ installConsoleErrorCapture }) =>
    installConsoleErrorCapture(),
  );

  setTimeout(() => {
    checkAll().catch((e) => console.warn("[pinned-watcher] Prima rulare eșuată:", e));
  }, 30_000);

  setInterval(() => {
    checkAll().catch((e) => console.warn("[pinned-watcher] Rulare periodică eșuată:", e));
  }, POLL_INTERVAL_MS);
}
