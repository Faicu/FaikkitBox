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

// Ștergerea efectivă a unui titlu: qBittorrent (torrent + fișiere), reziduul
// de pe disk, rândurile din `media` și Plex. Fără verificări de drepturi sau
// de termen — le fac apelanții: deleteMediaEntry (log.ts), la cererea unui
// utilizator, și pasul „Ștergeri programate” din maintenance.ts, la
// împlinirea celor 24 h (vezi scheduled-delete.ts).
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

    // Reținem calea reală de pe disc dinaintea ștergerii — numele
    // torrentului salvat în DB poate diferi de numele folderului de pe
    // disk (qBittorrent normalizează unele nume), deci e singura sursă
    // de adevăr pentru curățarea de mai jos. Rădăcina, nu content_path:
    // un fișier unic într-un folder propriu și-ar lăsa altfel folderul
    // gol pe disc (vezi qbitTorrentRootPath).
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

  // Ce a rămas după qBittorrent (subtitrările scrise de aplicație) —
  // vezi disk-cleanup.ts.
  if (rootPath) {
    const { removeTorrentResidue } = await import("./disk-cleanup");
    await removeTorrentResidue(rootPath);
  }

  // Toate rândurile media care împart același torrent_hash (episoadele
  // unui pachet de sezon) — nu doar cel apăsat — altfel restul rămân
  // orfane, cu un hash care nu mai există în qBittorrent, și apar
  // permanent ca "se descarcă" în Bibliotecă. Mesajul de confirmare din
  // drawer promite ștergerea întregului pachet — asta chiar face.
  deleteMediaByTorrentHash(row.torrent_hash);

  // Rânduri "fantomă" pentru același titlu (același imdb_id), fără
  // torrent_hash — create de exemplu de un backfill dintr-un scan Plex
  // vechi, nelegat niciodată de un download real. Invizibile pentru
  // ștergerea de mai sus (care lucrează strict după torrent_hash), deci
  // rămân orfane la nesfârșit dacă nu le curățăm explicit aici (găsit la
  // "Pompeii: Out of Time with Tom Hiddleston", 2026-09-02).
  // `parent_id IS NOT NULL` e esențial: rândul-părinte al unui serial
  // (ensureMediaPlaceholder) are prin construcție torrent_hash NULL, deci
  // fără filtrul ăsta era prins de curățare — iar ștergerea lui declanșa
  // ON DELETE CASCADE pe parent_id și lua cu el TOATE episoadele
  // celorlalte sezoane, care rămâneau perfect valide în qBittorrent
  // (găsit la "My Life with the Walter Boys", 2026-09-06: ștergerea unui
  // episod din pachetul S2 a golit și S3 din bibliotecă).
  if (row.imdb_id) {
    db.prepare(
      "DELETE FROM media WHERE imdb_id = ? AND torrent_hash IS NULL AND parent_id IS NOT NULL",
    ).run(row.imdb_id);

    // Rândul-serial rămâne util cât are măcar un episod; abia când
    // pachetul șters era ultimul, devine un titlu gol în Bibliotecă și
    // se curăță — intenția originală a curățării de mai sus, acum fără
    // efectul colateral asupra sezoanelor rămase.
    db.prepare(
      `DELETE FROM media WHERE imdb_id = ? AND media_type = 'tv_show'
         AND id NOT IN (SELECT parent_id FROM media WHERE parent_id IS NOT NULL)`,
    ).run(row.imdb_id);
  }

  // Refresh Plex necondiționat, după media_type — sursa film/serial,
  // nu categoria Filelist (RO Dubbed amestecă filme și seriale). Fără
  // el, refresh la ambele biblioteci ca fallback sigur — la fel ca la
  // ștergerea din pagina qBittorrent (qbittorrent.ts), în loc să
  // renunțăm silențios (găsit la "Avatar: Foc și cenușă", 2026-09-02 —
  // titlul șters din DB/disk, dar rămas fantomă în Plex).
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

// Pasul „Ștergeri programate” din maintenance.ts: execută ștergerile cu
// termenul atins și le scrie în jurnal. O ștergere eșuată rămâne programată
// și se reîncearcă la următorul tic. Întoarce câte s-au executat.
export async function runDueDeletions(nowMs = Date.now()): Promise<number> {
  const { logActivity } = await import("../activity-log");
  let done = 0;
  for (const due of listDueDeletions(nowMs)) {
    try {
      // Cineva poate să fi renunțat între listare și ștergerea precedentă.
      if (!scheduledDeletion(due.torrentHash)) continue;
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
