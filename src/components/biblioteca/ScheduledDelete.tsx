import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Trash2, Undo2 } from "lucide-react";

import { cancelMediaDeletion } from "@/lib/filelist.functions";
import { deleteTimeLabel } from "./utils";

// Ștergerea programată a unui titlu (vezi src/lib/media/scheduled-delete.ts):
// insigna cu timer din listă și cardul din drawer, cu renunțarea la ștergere.

const sqliteMs = (v: string) => new Date(`${v.replace(" ", "T")}Z`).getTime();

// Ora curentă, reîmprospătată periodic — null până la montare, ca randarea de
// pe server și hidratarea să nu difere prin minutul afișat.
function useNow(intervalMs = 10_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// „5 h 12 min” / „12 min” / „sub un minut”; compact: „5h 12m” / „12m” / „<1m”.
function remainingLabel(ms: number, compact: boolean): string {
  const totalMin = Math.ceil(ms / 60_000);
  if (ms < 60_000) return compact ? "<1m" : "sub un minut";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (compact) return h > 0 ? `${h}h ${m}m` : `${m}m`;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function DeleteTimerBadge({ at }: { at: string }) {
  const now = useNow();
  const left = now == null ? null : sqliteMs(at) - now;
  return (
    <span
      title={`Se șterge la ${deleteTimeLabel(at)}`}
      className="flex shrink-0 items-center gap-0.5 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-red-400"
    >
      <Trash2 className="h-2.5 w-2.5" />
      {left != null && (left > 0 ? remainingLabel(left, true) : "acum")}
    </span>
  );
}

export function ScheduledDeleteCard({
  mediaId,
  at,
  byUsername,
  isCancel,
  onCancelled,
}: {
  mediaId: number;
  at: string;
  byUsername: string | null;
  // Descărcarea e încă în curs — „anulare” în loc de „ștergere”.
  isCancel: boolean;
  onCancelled: () => void;
}) {
  const now = useNow();
  const cancelFn = useServerFn(cancelMediaDeletion);
  const [busy, setBusy] = useState(false);
  const left = now == null ? null : sqliteMs(at) - now;
  const due = left != null && left <= 0;

  async function cancel() {
    setBusy(true);
    const res = await cancelFn({ data: { mediaId } }).catch((e) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    setBusy(false);
    if (!res.ok) {
      toast.error("Nu am putut renunța la ștergere", { description: res.error });
      return;
    }
    toast.success("Ai renunțat la ștergere — titlul e acum al tău");
    onCancelled();
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs">
      <div className="flex items-start gap-2">
        <Trash2 className="mt-px h-3.5 w-3.5 shrink-0 text-red-400" />
        <div className="min-w-0 flex-1 leading-snug">
          <div className="font-medium text-foreground">
            {due
              ? "Se șterge acum…"
              : left == null
                ? `Se șterge la ${deleteTimeLabel(at)}`
                : `Se șterge în ${remainingLabel(left, false)}`}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {isCancel ? "Anulare" : "Ștergere"} programată
            {byUsername ? ` de ${byUsername}` : ""} pentru {deleteTimeLabel(at)} — Filelist
            consideră hit and run un torrent șters în primele 24 de ore. Până atunci torrentul
            continuă să se descarce și să facă seed.
          </div>
        </div>
      </div>
      {!due && (
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-muted/40 py-2 text-xs font-medium text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Undo2 className="h-3.5 w-3.5" />
          )}
          Renunță la ștergere
        </button>
      )}
    </div>
  );
}
