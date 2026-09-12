import { createServerFn } from "@tanstack/react-start";
import { qbitLogin } from "../qbit-client";
import {
  refreshPlexLibraryForCategoryAndEmptyTrash,
  refreshPlexLibraryAndEmptyTrash,
  refreshPlexLibrariesAndEmptyTrash,
} from "../plex-refresh";
import { deleteMediaByTorrentHash } from "../media/media";

// Ștergerea unui titlu: qBittorrent (torrent + fișiere), reziduul de pe disk
// și rândurile din `media`. Orice rând `media` cu torrent_hash cunoscut e
// ștergibil, indiferent de proveniență.
export const deleteMediaEntry = createServerFn({ method: "POST" })
  .validator((data: { mediaId: number }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; qbitDeleted?: boolean; error?: string }> => {
    const { requireAuth, isAdminOrOwner } = await import("../auth/admin.server");
    const session = await requireAuth();
    try {
      const { getDb } = await import("../db");
      const db = getDb();

      const row = db
        .prepare(
          "SELECT torrent_hash, category, media_type, imdb_id, requested_by_user_id FROM media WHERE id = ?",
        )
        .get(data.mediaId) as
        | {
            torrent_hash: string | null;
            category: number | null;
            media_type: string | null;
            imdb_id: string | null;
            requested_by_user_id: number | null;
          }
        | undefined;

      if (!row) {
        return { ok: false, error: "Titlul nu a fost găsit" };
      }
      if (!isAdminOrOwner(session, row.requested_by_user_id)) {
        return { ok: false, error: "Doar cel care a adăugat titlul sau un admin poate șterge" };
      }
      if (!row.torrent_hash) {
        return { ok: false, error: "Hash-ul torrentului e necunoscut — nu poate fi șters automat" };
      }

      let qbitDeleted = false;
      let contentPath: string | null = null;
      try {
        const qbitUrl = (process.env.QBIT_URL ?? "http://192.168.1.192:25556").replace(/\/$/, "");
        const user = process.env.QBIT_USERNAME ?? "";
        const pass = process.env.QBIT_PASSWORD ?? "";
        const cookie = await qbitLogin(qbitUrl, user, pass);

        // Reținem calea reală a conținutului dinaintea ștergerii — numele
        // torrentului salvat în DB poate diferi de numele folderului de pe
        // disk (qBittorrent normalizează unele nume), deci e singura sursă
        // de adevăr pentru fallback-ul de mai jos.
        try {
          const infoRes = await fetch(
            `${qbitUrl}/api/v2/torrents/info?hashes=${row.torrent_hash}`,
            { headers: { Cookie: cookie } },
          );
          if (infoRes.ok) {
            const info = (await infoRes.json()) as Array<{ content_path?: string }>;
            contentPath = info[0]?.content_path ?? null;
          }
        } catch (e) {
          console.warn("[filelist] Nu am putut citi content_path din qBit:", e);
        }

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

      // qBittorrent șterge doar fișierele pe care le-a descărcat el — dacă
      // pipeline-ul de subtitrări a scris .srt-uri direct în folderul
      // torrentului (cazul obișnuit pentru un titlu deja complet), qBit dă
      // "Directory not empty" la ștergere și lasă folderul (cu doar
      // subtitrările) orfan pe disk, invizibil în DB/qBit (vezi reziduul
      // The Crown S02, 2026-09-02). La acest punct fișierele video sunt deja
      // confirmate șterse de qBittorrent, deci orice mai rămâne e propriul
      // nostru reziduu — sigur de șters forțat.
      if (contentPath) {
        try {
          const { existsSync, rmSync } = await import("node:fs");
          if (existsSync(contentPath)) {
            rmSync(contentPath, { recursive: true, force: true });
          }
        } catch (e) {
          console.warn("[filelist] Nu am putut curăța reziduul de pe disk:", e);
        }
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

      // Refresh Plex necondiționat — categoria Filelist (numerică) poate
      // lipsi (titluri fără flux standard de descărcare), dar tot știm
      // sigur film vs. serial din media_type, care e mereu populat. Fără
      // niciuna din ele, refresh la ambele biblioteci ca fallback sigur —
      // la fel ca la ștergerea din pagina qBittorrent (qbittorrent.ts),
      // în loc să renunțăm silențios (găsit la "Avatar: Foc și cenușă",
      // 2026-09-02 — titlul șters din DB/disk, dar rămas fantomă în Plex).
      try {
        if (row.category !== null) {
          await refreshPlexLibraryForCategoryAndEmptyTrash(row.category);
        } else if (row.media_type) {
          const plexType = row.media_type === "movie" ? "movie" : "show";
          await refreshPlexLibraryAndEmptyTrash(plexType);
        } else {
          await refreshPlexLibrariesAndEmptyTrash();
        }
      } catch (e) {
        console.error("[filelist] Eroare la refresh Plex după ștergere:", e);
      }

      return { ok: true, qbitDeleted };
    } catch (e) {
      console.error("[filelist] Nu am putut șterge titlul:", e);
      return { ok: false };
    }
  });
