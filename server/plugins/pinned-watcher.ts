// ---------------------------------------------------------------------------
// Plugin: verifică periodic (la 3 ore) itemele fixate cu watch activat.
// Detectează: torrente noi pe Filelist, episoade noi lansate (TMDB),
// episoade/filme noi apărute în Plex.
// Fiecare tip de notificare are toggle independent per item.
// Prima rulare per item = baseline (fără notificări).
// ---------------------------------------------------------------------------

const INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 ore
const TMDB_BASE = "https://api.themoviedb.org/3";

function stripDiacritics(str: string): string {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
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
    const json: any = await res.json();
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

async function checkAll(): Promise<void> {
  try {
    const { getDb } = await import("../../src/lib/db");
    const { logActivity } = await import("../../src/lib/activity-log");
    const { sendPushToAll } = await import("../../src/lib/push");
    const { searchFilelistRaw, downloadFilelistInternal } = await import("../../src/lib/filelist.functions");
    const { getPlexEpisodesInSeasonInternal, checkPlexHasTitleInternal } = await import(
      "../../src/lib/services.functions"
    );

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
    console.log(`[pinned-watcher] Verificare ${items.length} item(e)`);

    for (const item of items) {
      try {
        const stateRow = db
          .prepare("SELECT * FROM pinned_watch_state WHERE id = ? AND media_type = ?")
          .get(item.id, item.media_type) as WatchRow | undefined;

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
        if (item.media_type === "tv" && (item.watch_tmdb || item.watch_plex || item.watch_filelist_season)) {
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
          const query = stripDiacritics(item.original_title || item.title);
          const category = item.media_type === "movie" ? "movies" as const : "series" as const;
          const torrents = await searchFilelistRaw(query, category);
          const newTorrents = torrents.filter((t) => !seenTorrentIds.has(t.id));
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
              const qualitiesFound = [...new Set(toNotify.map((t) => detectTorrentQuality(t.name)))]
                .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
              const epLabel = latestAired
                ? epKey(latestAired.season, latestAired.episode)
                : "";
              const torrentLabel = epLabel ? `${epLabel}: ${qualitiesFound.join(", ")}` : qualitiesFound.join(", ");
              changes.push(`🎞 Torrente noi: ${torrentLabel}`);
              journalEntries.push(`🎞 Torrente noi: ${torrentLabel}`);
              notifications.push({
                title: `🎞 ${item.title} — Torrente noi`,
                body: torrentLabel,
              });

              // Auto-download: cel mai bun torrent din calitatea dorită
              if (item.auto_download) {
                const quality = item.auto_download_quality || "1080p";
                const candidates = toNotify.filter((t) => detectTorrentQuality(t.name) === quality);
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
                      console.warn(`[pinned-watcher] Auto-download eșuat: ${dlResult.error}`);
                    }
                  } catch (e) {
                    console.warn("[pinned-watcher] Eroare auto-download:", e);
                  }
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
            const result = await checkPlexHasTitleInternal(item.title, item.original_title, "movie");
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
  } catch (e) {
    console.warn("[pinned-watcher] Eroare generală:", e);
  }
}

export default function () {
  setTimeout(() => {
    checkAll().catch((e) => console.warn("[pinned-watcher] Prima rulare eșuată:", e));
  }, 30_000);

  setInterval(() => {
    checkAll().catch((e) => console.warn("[pinned-watcher] Rulare periodică eșuată:", e));
  }, INTERVAL_MS);
}
