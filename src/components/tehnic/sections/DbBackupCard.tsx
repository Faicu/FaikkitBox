// Starea backup-urilor bazei de date + buton de backup manual.
//
// Backup-ul rulează singur (server/plugins/db-backup.ts), deci cardul nu e
// despre a-l declanșa, ci despre a răspunde la o singură întrebare: "chiar
// se face?". De-asta vârful cardului e vechimea ultimei copii, nu lista.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { DatabaseBackup, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { dbBackupQuery } from "@/lib/queries";
import { runDbBackupNow } from "@/lib/system/db-backup.functions";
import { formatBytes } from "@/lib/format";
import { relativeTime } from "../utils";

// Peste atât, ultima copie e prea veche pentru un plugin care rulează zilnic —
// semn că backup-ul nu mai merge, nu că am avut o zi liniștită.
const STALE_MS = 36 * 60 * 60 * 1000;

export function DbBackupCard() {
  const qc = useQueryClient();
  const status = useQuery(dbBackupQuery);
  const backupNow = useServerFn(runDbBackupNow);

  const run = useMutation({
    mutationFn: () => backupNow(),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error ?? "Backup-ul a eșuat");
        return;
      }
      toast.success("Backup făcut", {
        description: `${res.file.name} · ${formatBytes(res.file.size)}`,
      });
      qc.invalidateQueries({ queryKey: ["dbBackup"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const d = status.data;
  const lastAt = d?.lastAt ?? null;
  const stale = !lastAt || Date.now() - new Date(lastAt).getTime() > STALE_MS;

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <DatabaseBackup className="h-3.5 w-3.5" /> Backup bază de date
      </h2>
      <div className="rounded-2xl glass-card p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {stale ? (
              <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" />
            ) : (
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">
                {lastAt ? `Ultimul backup ${relativeTime(lastAt)}` : "Niciun backup încă"}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {d
                  ? `${d.backups.length}/${d.keep} copii · ${formatBytes(d.totalSize)}`
                  : "se încarcă…"}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => run.mutate()}
            disabled={run.isPending}
            className="shrink-0 rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-50"
          >
            {run.isPending ? "Se face…" : "Backup acum"}
          </button>
        </div>

        {/* Calea contează: backup-ul stă lângă bază, pe același disc — bun
            pentru o migrare greșită, inutil pentru un disc mort. Arătând-o,
            limita se vede, nu se presupune. */}
        {d && <div className="text-[11px] text-muted-foreground/70 truncate">{d.dir}</div>}
      </div>
    </section>
  );
}
