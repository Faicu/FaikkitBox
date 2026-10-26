import { getDb } from "../db";
import { qbitLogin, qbitTorrentRootPath } from "../qbit-client";
import {
  refreshPlexLibraryAndEmptyTrash,
  refreshPlexLibrariesAndEmptyTrash,
} from "../plex-refresh";
import { deleteMediaByTorrentHash } from "../media/media";
import {
  listDueDeletions,
  scheduledDeletion,
  torrentLabel,
  usernameOf,
} from "../media/scheduled-delete";

// Ștergerea efectivă: qBittorrent (torrent + fișiere), resturile de pe disc,
// rândurile din `media` și Plex. Drepturile și termenul le verifică apelanții
// (deleteMediaEntry din log.ts, „Ștergeri programate”).
export async function deleteTorrentNow(row: {
  torrent_hash: string;
  media_type: string | null;
  imdb_id: string | null;
}): Promise<{ qbitDeleted: boolean }> {
  const db = getDb();
  let qbitDeleted = false;
  let rootPath: string | null = null;
  try {
    const qbitUrl = (process.env.QBIT_URL ?? "http://192.168.1.192:25556").replace(/\/$/, "");
    const user = process.env.QBIT_USERNAME ?? "";
    const pass = process.env.QBIT_PASSWORD ?? "";
    const cookie = await qbitLogin(qbitUrl, user, pass);

    // Calea reală, înainte de ștergere — numele din DB poate diferi de folderul
    // de pe disc. Rădăcina, nu content_path: altfel un fișier unic își lasă
    // folderul gol.
    rootPath = await qbitTorrentRootPath(qbitUrl, row.torrent_hash, user, pass);

    const form = new URLSearchParams({ hashes: row.torrent_hash, deleteFiles: "true" });
    const res = await fetch(`${qbitUrl}/api/v2/torrents/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
      body: form.toString(),
    });
    qbitDeleted = res.ok;
  } catch (e) {
    console.warn("[filelist] Nu am putut șterge din qBit:", e);
  }

  // Ce a rămas după qBittorrent (subtitrările scrise de aplicație).
  if (rootPath) {
    const { removeTorrentResidue } = await import("./disk-cleanup");
    await removeTorrentResidue(rootPath);
  }

  // Toate rândurile cu același hash (episoadele unui pachet), nu doar cel
  // apăsat — altfel restul rămân „se descarcă” pe veci.
  deleteMediaByTorrentHash(row.torrent_hash);

  // Rândurile „fantomă” ale aceluiași titlu, fără hash (de la un backfill
  // vechi) — altfel rămân orfane (Pompeii, 2 sept. 2026). `parent_id IS NOT
  // NULL` e esențial: rândul-părinte al serialului n-are hash, iar ștergerea lui
  // lua prin CASCADE episoadele tuturor sezoanelor (Walter Boys, 6 sept. 2026).
  if (row.imdb_id) {
    db.prepare(
      "DELETE FROM media WHERE imdb_id = ? AND torrent_hash IS NULL AND parent_id IS NOT NULL",
    ).run(row.imdb_id);

    // Rândul-serial se curăță doar când pachetul șters era ultimul lui.
    db.prepare(
      `DELETE FROM media WHERE imdb_id = ? AND media_type = 'tv_show'
         AND id NOT IN (SELECT parent_id FROM media WHERE parent_id IS NOT NULL)`,
    ).run(row.imdb_id);
  }

  // Refresh Plex mereu, după media_type (RO Dubbed amestecă filme și seriale);
  // fără el, ambele biblioteci — altfel titlul rămânea fantomă în Plex
  // (Avatar, 2 sept. 2026).
  try {
    if (row.media_type) {
      const plexType = row.media_type === "movie" ? "movie" : "show";
      await refreshPlexLibraryAndEmptyTrash(plexType);
    } else {
      await refreshPlexLibrariesAndEmptyTrash();
    }
  } catch (e) {
    console.error("[filelist] Eroare la refresh Plex după ștergere:", e);
  }

  return { qbitDeleted };
}

// Ștergerile cu termenul atins, scrise în jurnal. O ștergere eșuată rămâne
// programată. Întoarce câte s-au executat.
export async function runDueDeletions(nowMs = Date.now()): Promise<number> {
  const { finalizingHashes } = await import("./download-tracker");
  const { logActivity } = await import("../activity-log");
  let done = 0;
  for (const due of listDueDeletions(nowMs)) {
    try {
      // Cineva poate să fi renunțat între timp.
      if (!scheduledDeletion(due.torrentHash)) continue;
      // Torrent tocmai terminat, încă în finalizare — rămâne pentru data viitoare.
      if (finalizingHashes().has(due.torrentHash)) continue;
      const row = getDb()
        .prepare("SELECT media_type, imdb_id FROM media WHERE id = ?")
        .get(due.mediaId) as { media_type: string | null; imdb_id: string | null } | undefined;
      if (!row) continue;
      const label = torrentLabel(due.torrentHash);
      await deleteTorrentNow({ ...row, torrent_hash: due.torrentHash });
      const by = usernameOf(due.byUserId);
      await logActivity(
        "title_delete",
        `Șters la termen: ${label}${by ? ` (programat de ${by})` : ""}`,
        { torrentHash: due.torrentHash, action: "deleted_scheduled", user: by },
      );
      done++;
    } catch (e) {
      console.warn(`[scheduled-delete] Ștergerea ${due.torrentHash} a eșuat:`, e);
    }
  }
  return done;
}
