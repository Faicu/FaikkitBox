import { createServerFn } from "@tanstack/react-start";

// Ștergerea unui titlu din Bibliotecă (sau anularea descărcării lui). Orice
// rând `media` cu torrent_hash cunoscut e ștergibil, indiferent de
// proveniență. Până la 48 h de la finalizarea descărcării ștergerea nu se
// execută, ci se programează pentru împlinirea lor — hit and run pe Filelist, vezi
// scheduled-delete.ts. Excepție: adminul poate cere ștergerea pe loc
// (`immediate`), ignorat pentru oricine altcineva. Execuția propriu-zisă e în
// delete-title.ts.
export const deleteMediaEntry = createServerFn({ method: "POST" })
  .validator((data: { mediaId: number; immediate?: boolean }) => data)
  .handler(
    async ({
      data,
    }): Promise<{
      ok: boolean;
      qbitDeleted?: boolean;
      // Ștergerea doar s-a programat; `at` null = la 48 h după finalizare.
      scheduled?: { at: string | null };
      error?: string;
    }> => {
      const { requireAuth, isAdminOrOwner, isLiveAdmin } = await import("../auth/admin.server");
      const session = await requireAuth();
      try {
        const { getDb } = await import("../db");
        const db = getDb();

        const row = db
          .prepare(
            "SELECT torrent_hash, media_type, imdb_id, requested_by_user_id FROM media WHERE id = ?",
          )
          .get(data.mediaId) as
          | {
              torrent_hash: string | null;
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
          return {
            ok: false,
            error: "Hash-ul torrentului e necunoscut — nu poate fi șters automat",
          };
        }
        const torrentHash = row.torrent_hash;

        const { deleteDelay, scheduleDeletion, scheduledDeletion, torrentLabel, formatDeleteTime } =
          await import("../media/scheduled-delete");
        const { logActivity } = await import("../activity-log");
        const who = session.data.username ?? "admin";
        const label = torrentLabel(torrentHash);

        // Până la 48 h după finalizare doar programăm — pentru toată lumea,
        // adminul inclus, dacă n-a cerut explicit ștergerea pe loc.
        const delay = deleteDelay(torrentHash);
        const immediate = !!delay && !!data.immediate && (await isLiveAdmin(session));
        if (delay && !immediate) {
          const already = scheduledDeletion(torrentHash);
          const scheduled = scheduleDeletion(torrentHash, delay.until, session.data.userId ?? null);
          if (!already) {
            // Watcher-ul doarme cât nu e nimic programat — îl trezim, ca
            // să-și ia ora noii ștergeri.
            const { pokeWatcher } = await import("../watcher/poke");
            pokeWatcher("scheduled-delete");
            await logActivity(
              "title_delete",
              `${who} a programat ștergerea: ${label} — ${
                scheduled.at
                  ? `se șterge la ${formatDeleteTime(scheduled.at)}`
                  : "se șterge la 48 h după finalizarea descărcării"
              }`,
              { torrentHash, action: "scheduled", user: who },
            );
          }
          return { ok: true, scheduled: { at: scheduled.at } };
        }

        const { deleteTorrentNow } = await import("./delete-title");
        const { qbitDeleted } = await deleteTorrentNow({ ...row, torrent_hash: torrentHash });
        await logActivity(
          "title_delete",
          immediate
            ? `${who} a șters pe loc, înainte de 48 h: ${label}`
            : `${who} a șters: ${label}`,
          {
            torrentHash,
            action: immediate ? "deleted_immediate" : "deleted",
            user: who,
          },
        );
        return { ok: true, qbitDeleted };
      } catch (e) {
        console.error("[filelist] Nu am putut șterge titlul:", e);
        return { ok: false };
      }
    },
  );

// Renunțarea la o ștergere programată — permisă oricui e logat. Cine renunță
// devine proprietarul titlului (vezi cancelScheduledDeletion).
export const cancelMediaDeletion = createServerFn({ method: "POST" })
  .validator((data: { mediaId: number }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const { requireAuth } = await import("../auth/admin.server");
    const session = await requireAuth();
    try {
      const { getDb } = await import("../db");
      const row = getDb()
        .prepare("SELECT torrent_hash FROM media WHERE id = ?")
        .get(data.mediaId) as { torrent_hash: string | null } | undefined;
      if (!row?.torrent_hash) {
        return { ok: false, error: "Titlul nu a fost găsit" };
      }
      const { cancelScheduledDeletion, torrentLabel } = await import("../media/scheduled-delete");
      const label = torrentLabel(row.torrent_hash);
      if (!cancelScheduledDeletion(row.torrent_hash, session.data.userId ?? null)) {
        return { ok: false, error: "Ștergerea nu mai e programată" };
      }
      const who = session.data.username ?? "admin";
      const { logActivity } = await import("../activity-log");
      await logActivity(
        "title_delete",
        `${who} a renunțat la ștergerea: ${label} — titlul e acum al lui`,
        { torrentHash: row.torrent_hash, action: "cancelled", user: who },
      );
      return { ok: true };
    } catch (e) {
      console.error("[filelist] Nu am putut renunța la ștergere:", e);
      return { ok: false };
    }
  });
