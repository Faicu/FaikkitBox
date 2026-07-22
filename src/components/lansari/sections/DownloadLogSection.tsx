import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  History,
  Film,
  Tv,
  HardDrive,
  Zap,
  ShieldCheck,
  CheckCircle2,
  Loader2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { filelistLogQuery } from "@/lib/queries";
import { deleteFilelistLogEntry } from "@/lib/filelist.functions";
import type { FilelistLogEntry } from "@/lib/filelist.functions";
import { formatBytes } from "@/lib/format";

export function DownloadLogSection() {
  const queryClient = useQueryClient();
  const { data: log, isLoading } = useQuery(filelistLogQuery);
  const deleteFn = useServerFn(deleteFilelistLogEntry);
  const [visibleCount, setVisibleCount] = useState(3);
  const isMovie = (catId: number, catName = "") =>
    [1, 2, 3, 4, 6, 19, 26].includes(catId) || (catId === 0 && /film|movie/i.test(catName));

  async function handleDelete(id: number, name: string, hasHash: boolean) {
    const msg = hasHash
      ? `Ștergi torrentul din log, din qBittorrent și fișierele de pe disk?\n\n${name}`
      : `Ștergi intrarea din log?\n\n${name}`;
    if (!confirm(msg)) return;
    const res = await deleteFn({ data: { id } });
    queryClient.invalidateQueries({ queryKey: ["filelistLog"] });
    if (hasHash) {
      if (res.qbitDeleted) toast.success("Torrent și fișiere șterse din qBittorrent");
      else
        toast.warning("Șters din log, dar nu am putut șterge din qBittorrent (poate deja șters)");
    }
  }

  if (isLoading || !log || log.length === 0) return null;

  return (
    <div className="mt-3">
      <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <History className="h-3.5 w-3.5" /> Ultimele torrente descărcate
      </h3>
      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="divide-y divide-border/60">
          {log.slice(0, visibleCount).map((e: FilelistLogEntry) => (
            <div
              key={`${e.id}-${e.downloadedAt}`}
              className="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0"
            >
              <div className="mt-0.5 shrink-0">
                {isMovie(e.category, e.categoryName) ? (
                  <Film className="h-4 w-4 text-amber-400" />
                ) : (
                  <Tv className="h-4 w-4 text-blue-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium leading-tight break-words">{e.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span>
                    {new Date(e.downloadedAt).toLocaleString("ro-RO", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Europe/Bucharest",
                    })}
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
                    {e.categoryName}
                  </span>
                  {e.size > 0 && (
                    <span className="flex items-center gap-0.5">
                      <HardDrive className="h-3 w-3" /> {formatBytes(e.size)}
                    </span>
                  )}
                  {e.freeleech && (
                    <span className="flex items-center gap-0.5 rounded bg-yellow-500/15 px-1.5 py-0.5 font-medium text-yellow-400">
                      <Zap className="h-3 w-3" /> Freeleech
                    </span>
                  )}
                  {e.internal && (
                    <span className="flex items-center gap-0.5 rounded bg-purple-500/15 px-1.5 py-0.5 font-medium text-purple-400">
                      <ShieldCheck className="h-3 w-3" /> Internal
                    </span>
                  )}
                </div>
                <div className="mt-1">
                  {e.completedAt ? (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" /> Complet —{" "}
                      {new Date(e.completedAt).toLocaleString("ro-RO", {
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
              <button
                onClick={() => handleDelete(e.id, e.name, !!e.torrentHash)}
                className="shrink-0 mt-0.5 rounded-lg p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title={e.torrentHash ? "Șterge din log + qBit + disk" : "Șterge din log"}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
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
    </div>
  );
}
