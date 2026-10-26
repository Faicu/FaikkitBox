import { createServerFn } from "@tanstack/react-start";

// Ștergerea unui titlu din Bibliotecă (sau anularea descărcării lui). Orice
// rând `media` cu torrent_hash cunoscut e ștergibil, indiferent de
// proveniență. În primele 24 h de la descărcare ștergerea nu se execută, ci
// se programează pentru împlinirea lor — hit and run pe Filelist, vezi
// scheduled-delete.ts. Execuția propriu-zisă e în delete-title.ts.
export const deleteMediaEntry = createServerFn({ method: "POST" })
  .validator((data: { mediaId: number }) => data)
  .handler(
    async ({
      data,
    }): Promise<{ ok: boolean; qbitDeleted?: boolean; scheduledAt?: string; error?: string }> => {
      const { requireAuth, isAdminOrOwner } = await import("../auth/admin.server");
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

        const {
          deleteDelayedUntil,
          scheduleDeletion,
          scheduledDeletion,
          torrentLabel,
          formatDeleteTime,
        } = await import("../media/scheduled-delete");
        const { logActivity } = await import("../activity-log");
        const who = session.data.username ?? "admin";
        const label = torrentLabel(torrentHash);

        // Pentru toată lumea, adminul inclus: în primele 24 h doar programăm.
        const delayedUntil = deleteDelayedUntil(torrentHash);
        if (delayedUntil) {
          const already = scheduledDeletion(torrentHash);
          const scheduled = scheduleDeletion(
            torrentHash,
            delayedUntil,
            session.data.userId ?? null,
          );
          if (!already) {
            await logActivity(
              "title_delete",
              `${who} a programat ștergerea: ${label} — se șterge la ${formatDeleteTime(scheduled.at)}`,
              { torrentHash, action: "scheduled", user: who },
            );
          }
          return { ok: true, scheduledAt: scheduled.at };
        }

        const { deleteTorrentNow } = await import("./delete-title");
        const { qbitDeleted } = await deleteTorrentNow({ ...row, torrent_hash: torrentHash });
        await logActivity("title_delete", `${who} a șters: ${label}`, {
          torrentHash,
          action: "deleted",
          user: who,
        });
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
