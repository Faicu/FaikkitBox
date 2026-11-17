import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Captions, CaptionsOff, Loader2, Trash2, XCircle } from "lucide-react";

import type { PlexTitleDetail } from "@/lib/services/plex-title-detail";
import { correctSubtitleForMedia, deleteSubtitleForMedia } from "@/lib/filelist.functions";
import { subtitleHeadline, subtitleOutcomeTone } from "@/lib/filelist/subtitle-outcomes";
import { ScheduledDeleteCard } from "./ScheduledDelete";

export interface TitleDeleteRequest {
  mediaId: number;
  title: string;
  isSeasonPack: boolean;
  isCancel: boolean;
  // Ștergerea doar se programează: până la `until` (SQLite, UTC), sau
  // până la 48 h după finalizare dacă `until` e null.
  delay: { until: string | null } | null;
  // Admin: confirmarea oferă și ștergerea pe loc.
  canDeleteImmediately: boolean;
  // Ștergerea e deja programată — confirmarea e doar pentru „Șterge acum”.
  alreadyScheduled: boolean;
}

// Acțiunile de la coada fișei unui film/episod: ștergerea programată,
// subtitrarea și ștergerea titlului. Confirmarea ștergerii o face lista.
export function TitleActions({
  detail: d,
  onChanged,
  onRequestDelete,
}: {
  detail: PlexTitleDetail;
  onChanged: () => void;
  onRequestDelete: (info: TitleDeleteRequest) => void;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [deletingSubtitle, setDeletingSubtitle] = useState(false);
  const correctFn = useServerFn(correctSubtitleForMedia);
  const deleteSubtitleFn = useServerFn(deleteSubtitleForMedia);

  const requestDelete = (
    info: Pick<
      TitleDeleteRequest,
      "isCancel" | "delay" | "canDeleteImmediately" | "alreadyScheduled"
    >,
  ) =>
    onRequestDelete({
      mediaId: d.mediaId,
      title: d.type === "movie" ? d.title : (d.show ?? d.title),
      isSeasonPack: d.isSeasonPack,
      ...info,
    });

  async function correctSubtitle() {
    setCorrecting(true);
    const toastId = toast.loading(`Verific subtitrarea pentru „${d.title}”…`);
    const res = await correctFn({
      data: { mediaId: d.mediaId },
    }).catch((e) => ({
      status: "error" as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    setCorrecting(false);
    if (res.status !== "ok") {
      toast.error("Eroare la corectarea subtitrării", { id: toastId, description: res.error });
      return;
    }
    // Titlul și culoarea după rezultat, ca în jurnal.
    const tone = subtitleOutcomeTone(res.outcome);
    const show =
      tone === "good"
        ? toast.success
        : tone === "warn"
          ? toast.warning
          : tone === "ok"
            ? toast.info
            : toast.error;
    show(subtitleHeadline(res.outcome), {
      id: toastId,
      description: res.detail,
      duration: 6000,
    });
    onChanged();
  }

  async function deleteSubtitle() {
    setDeletingSubtitle(true);
    const toastId = toast.loading(`Șterg subtitrarea pentru „${d.title}”…`);
    const res = await deleteSubtitleFn({
      data: { mediaId: d.mediaId },
    }).catch((e) => ({
      status: "error" as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    setDeletingSubtitle(false);
    if (res.status !== "ok") {
      toast.error("Eroare la ștergerea subtitrării", { id: toastId, description: res.error });
      return;
    }
    toast.success("Subtitrare ștearsă", {
      id: toastId,
      description: res.deleted.join(", "),
      duration: 6000,
    });
    onChanged();
  }

  return (
    <div className="flex flex-col gap-2 pt-1 border-t border-border">
      {/* Pentru oricine: oricine poate renunța la ștergere. */}
      {d.torrentHash && d.deleteScheduled && (
        <div className="pt-2">
          <ScheduledDeleteCard
            mediaId={d.mediaId}
            at={d.deleteScheduled.at}
            byUsername={d.deleteScheduled.byUsername}
            isCancel={d.status === "downloading"}
            onCancelled={onChanged}
            onDeleteNow={
              d.canDeleteImmediately
                ? () =>
                    requestDelete({
                      isCancel: d.status === "downloading",
                      delay: { until: d.deleteScheduled!.at },
                      canDeleteImmediately: true,
                      alreadyScheduled: true,
                    })
                : undefined
            }
          />
        </div>
      )}
      {d.torrentHash ? (
        d.canManage ? (
          d.status === "downloading" ? (
            d.deleteScheduled ? null : (
              <button
                type="button"
                onClick={() =>
                  requestDelete({
                    isCancel: true,
                    delay: d.deleteDelay,
                    canDeleteImmediately: d.canDeleteImmediately,
                    alreadyScheduled: false,
                  })
                }
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/40 py-2 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <XCircle className="h-3.5 w-3.5" />
                Anulare
              </button>
            )
          ) : (
            <>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={correctSubtitle}
                  disabled={correcting}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/40 py-2 text-xs font-medium text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40"
                >
                  {correcting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Captions className="h-3.5 w-3.5" />
                  )}
                  Corectează subtitrare
                </button>
                <button
                  type="button"
                  onClick={deleteSubtitle}
                  disabled={deletingSubtitle}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/40 py-2 text-xs font-medium text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40"
                >
                  {deletingSubtitle ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CaptionsOff className="h-3.5 w-3.5" />
                  )}
                  Șterge subtitrare
                </button>
              </div>
              {!d.deleteScheduled && (
                <button
                  type="button"
                  onClick={() =>
                    requestDelete({
                      isCancel: false,
                      delay: d.deleteDelay,
                      canDeleteImmediately: d.canDeleteImmediately,
                      alreadyScheduled: false,
                    })
                  }
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/40 py-2 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Șterge titlul complet
                </button>
              )}
            </>
          )
        ) : (
          <div className="pt-2 text-[11px] text-muted-foreground">
            Doar {d.addedByUsername ?? "cel care a adăugat titlul"} sau un admin poate
            corecta/șterge subtitrarea sau șterge titlul.
          </div>
        )
      ) : (
        <div className="pt-2 text-[11px] text-muted-foreground">
          Nu știm ce torrent corespunde acestui titlu (a fost adăugat manual în Plex, sau torrentul
          nu mai există în qBittorrent) — corectarea/ștergerea subtitrării și ștergerea completă nu
          sunt disponibile.
        </div>
      )}
    </div>
  );
}
