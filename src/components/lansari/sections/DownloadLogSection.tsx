import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { History, Film, Tv, CheckCircle2, Loader2, Captions } from "lucide-react";
import { toast } from "sonner";

import { filelistLogQuery, adminStatusQuery } from "@/lib/queries";
import {
  deleteFilelistLogEntry,
  backfillSubtitles,
  getBackfillState,
  correctSubtitleForItem,
  deleteSubtitleForItem,
  resolveTorrentDisplayName,
} from "@/lib/filelist.functions";
import type { FilelistLogEntry } from "@/lib/filelist.functions";
import { isMovieCategory } from "@/lib/filelist/categories";
import { Progress } from "@/components/ui/progress";
import { DownloadLogEntryDrawer } from "../DownloadLogEntryDrawer";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

// ---------------------------------------------------------------------------
// Rând individual — rezolvă numele de afișat (titlu real RO + sezon/episod)
// doar pentru rândurile vizibile, nu pentru tot jurnalul deodată.
// ---------------------------------------------------------------------------

function DownloadLogRow({ entry, onClick }: { entry: FilelistLogEntry; onClick: () => void }) {
  const nameFn = useServerFn(resolveTorrentDisplayName);
  const { data: displayName } = useQuery({
    queryKey: ["torrentDisplayName", entry.id, entry.name, entry.imdb],
    queryFn: () => nameFn({ data: { torrentName: entry.name, imdb: entry.imdb ?? null } }),
    staleTime: 60 * 60_000,
    enabled: !!entry.imdb,
  });

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 py-2 first:pt-0 last:pb-0 text-left hover:bg-muted/40 transition-colors rounded-lg px-1 -mx-1"
    >
      <div className="mt-0.5 shrink-0">
        {isMovieCategory(entry.category) ? (
          <Film className="h-4 w-4 text-amber-400" />
        ) : (
          <Tv className="h-4 w-4 text-blue-400" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-tight break-words">
          {displayName ?? entry.name}
        </div>
        <div className="mt-1">
          {entry.completedAt ? (
            <span className="flex items-center gap-1 text-[11px] text-emerald-400">
              <CheckCircle2 className="h-3 w-3" /> Complet —{" "}
              {new Date(entry.completedAt).toLocaleString("ro-RO", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Europe/Bucharest",
              })}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-amber-400">
              <Loader2 className="h-3 w-3 animate-spin" /> În descărcare...
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export function DownloadLogSection() {
  const queryClient = useQueryClient();
  const { data: adminData } = useQuery(adminStatusQuery);
  const isAdmin = !!adminData?.isAdmin;
  const { data: log, isLoading } = useQuery(filelistLogQuery);
  const deleteFn = useServerFn(deleteFilelistLogEntry);
  const backfillFn = useServerFn(backfillSubtitles);
  const stateFn = useServerFn(getBackfillState);
  const correctFn = useServerFn(correctSubtitleForItem);
  const deleteSubtitleFn = useServerFn(deleteSubtitleForItem);
  const [visibleCount, setVisibleCount] = useState(3);
  const [backfilling, setBackfilling] = useState(false);
  const [progress, setProgress] = useState<{ total: number; done: number } | null>(null);
  const [correctingId, setCorrectingId] = useState<number | null>(null);
  const [deletingSubtitleId, setDeletingSubtitleId] = useState<number | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<FilelistLogEntry | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    id: number;
    name: string;
    hasHash: boolean;
    isActive: boolean;
  } | null>(null);

  // Backfill-ul poate dura multe minute (zeci/sute de torrente) — pornim
  // rularea în fundal (răspuns rapid la backfillFn) și urmărim progresul +
  // rezultatul final exclusiv prin polling, ca un singur request HTTP lung
  // să nu fie tăiat de vreun timeout de proxy/browser aproape de final.
  async function runBackfill() {
    setBackfilling(true);
    setProgress(null);
    const toastId = toast.loading("Verific subtitrările pentru descărcările vechi…");

    const startRes = await backfillFn({}).catch((e) => ({
      status: "error" as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    if (startRes.status !== "ok") {
      toast.error("Eroare la pornirea verificării", { id: toastId, description: startRes.error });
      setBackfilling(false);
      return;
    }

    const pollInterval = setInterval(async () => {
      const state = await stateFn().catch(() => null);
      if (!state) return;
      setProgress(state.progress);
      if (!state.running) {
        clearInterval(pollInterval);
        setBackfilling(false);
        setProgress(null);
        if (state.lastResult?.status === "ok") {
          const r = state.lastResult;
          toast.success("Subtitrări verificate", {
            id: toastId,
            description: `${r.processed} verificate, ${r.corrected} corectate, ${r.skipped} sărite`,
            duration: 6000,
          });
        } else {
          toast.error("Eroare la verificarea subtitrărilor", {
            id: toastId,
            description: state.lastResult?.error,
          });
        }
      }
    }, 1500);
  }

  async function correctOne(id: number, name: string) {
    setCorrectingId(id);
    const toastId = toast.loading(`Verific subtitrarea pentru „${name}”…`);
    const res = await correctFn({ data: { id } }).catch((e) => ({
      status: "error" as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    setCorrectingId(null);
    if (res.status !== "ok") {
      toast.error("Eroare la corectarea subtitrării", { id: toastId, description: res.error });
      return;
    }
    toast.success("Subtitrare verificată", {
      id: toastId,
      description: res.detail,
      duration: 6000,
    });
  }

  async function deleteSubtitleOne(id: number, name: string) {
    setDeletingSubtitleId(id);
    const toastId = toast.loading(`Șterg subtitrarea pentru „${name}”…`);
    const res = await deleteSubtitleFn({ data: { id } }).catch((e) => ({
      status: "error" as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    setDeletingSubtitleId(null);
    if (res.status !== "ok") {
      toast.error("Eroare la ștergerea subtitrării", { id: toastId, description: res.error });
      return;
    }
    toast.success("Subtitrare ștearsă", {
      id: toastId,
      description: res.deleted.join(", "),
      duration: 6000,
    });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const { id, hasHash, isActive } = pendingDelete;
    const res = await deleteFn({ data: { id } });
    queryClient.invalidateQueries({ queryKey: ["filelistLog"] });
    if (isActive) {
      if (res.qbitDeleted) toast.success("Descărcare oprită — torrent și fișiere parțiale șterse");
      else
        toast.warning(
          "Șters din log, dar nu am găsit torrentul în qBittorrent (poate s-a terminat între timp)",
        );
    } else if (hasHash) {
      if (res.qbitDeleted) toast.success("Torrent și fișiere șterse din qBittorrent");
      else
        toast.warning("Șters din log, dar nu am putut șterge din qBittorrent (poate deja șters)");
    }
    setPendingDelete(null);
    setSelectedEntry(null);
  }

  if (isLoading || !log || log.length === 0) return null;

  return (
    <div className="mt-3">
      <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center justify-between gap-1">
        <span className="flex items-center gap-1">
          <History className="h-3.5 w-3.5" /> Ultimele torrente descărcate
        </span>
        {isAdmin && (
          <button
            onClick={runBackfill}
            disabled={backfilling}
            className="flex items-center gap-1 rounded-lg px-1.5 py-1 normal-case tracking-normal text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50"
            title="Verifică/corectează subtitrarea română pentru toate descărcările din jurnal"
          >
            {backfilling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Captions className="h-3.5 w-3.5" />
            )}
            Corectează subtitrări
          </button>
        )}
      </h3>
      {backfilling && (
        <div className="mb-2 px-1">
          <Progress value={progress ? (progress.done / Math.max(progress.total, 1)) * 100 : 0} />
          <div className="mt-1 text-[11px] text-muted-foreground">
            {progress ? `${progress.done}/${progress.total} verificate` : "Pornesc verificarea…"}
          </div>
        </div>
      )}
      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="divide-y divide-border/60">
          {log.slice(0, visibleCount).map((e: FilelistLogEntry) => (
            <DownloadLogRow
              key={`${e.id}-${e.downloadedAt}`}
              entry={e}
              onClick={() => setSelectedEntry(e)}
            />
          ))}
        </div>
        {visibleCount < log.length && (
          <button
            onClick={() => setVisibleCount((c) => c + 5)}
            className="mt-3 w-full rounded-xl bg-muted/50 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors"
          >
            Afișează mai mult
          </button>
        )}
      </div>

      {selectedEntry && (
        <DownloadLogEntryDrawer
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          correcting={correctingId === selectedEntry.id}
          deletingSubtitle={deletingSubtitleId === selectedEntry.id}
          isAdmin={isAdmin}
          onCorrectSubtitle={() => correctOne(selectedEntry.id, selectedEntry.name)}
          onDeleteSubtitle={() => deleteSubtitleOne(selectedEntry.id, selectedEntry.name)}
          onDelete={() =>
            setPendingDelete({
              id: selectedEntry.id,
              name: selectedEntry.name,
              hasHash: !!selectedEntry.torrentHash,
              isActive: selectedEntry.completedAt === null,
            })
          }
        />
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete?.isActive
                ? "Oprire descărcare"
                : pendingDelete?.hasHash
                  ? "Ștergere completă"
                  : "Ștergere din log"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.isActive
                ? `Oprești descărcarea în curs și ștergi fișierele parțiale de pe disk?\n\n${pendingDelete.name}`
                : pendingDelete?.hasHash
                  ? `Ștergi torrentul din log, din qBittorrent și fișierele de pe disk?\n\n${pendingDelete.name}`
                  : `Ștergi intrarea din log?\n\n${pendingDelete?.name}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anulează</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {pendingDelete?.isActive ? "Oprește" : "Șterge"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
