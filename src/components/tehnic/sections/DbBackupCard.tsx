// Starea backup-urilor bazei de date. Un backup manual se face din Watcher
// (sarcina „Backup bază de date” → Rulează acum), nu de aici — un singur
// buton pentru același lucru.
//
// Backup-ul rulează singur (sarcina db-backup din Watcher), deci cardul nu e
// despre a-l declanșa, ci despre a răspunde la o singură întrebare: "chiar
// se face?". De-asta vârful cardului e vechimea ultimei copii, nu lista.

import { useQuery } from "@tanstack/react-query";
import { DatabaseBackup, ShieldAlert, ShieldCheck } from "lucide-react";

import { dbBackupQuery } from "@/lib/queries";
import { formatBytes } from "@/lib/format";
import { relativeTime } from "../utils";

// Peste atât, ultima copie e prea veche pentru un plugin care rulează zilnic —
// semn că backup-ul nu mai merge, nu că am avut o zi liniștită.
const STALE_MS = 36 * 60 * 60 * 1000;

export function DbBackupCard() {
  const status = useQuery(dbBackupQuery);

  const d = status.data;
  const lastAt = d?.lastAt ?? null;
  const stale = !lastAt || Date.now() - new Date(lastAt).getTime() > STALE_MS;

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <DatabaseBackup className="h-3.5 w-3.5" /> Backup bază de date
      </h2>
      {/* stagger-in ca la celelalte secțiuni din Tehnic. Copiii direcți sunt
          rândul de stare și linia cu calea — niciunul n-are clasă care setează
          `animation`, deci nu calcă animația de intrare (vezi nota din
          styles.css: shorthand-ul ar lăsa copilul invizibil). */}
      <div className="rounded-2xl glass-card p-3 space-y-3 stagger-in">
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
        </div>

        {/* Calea contează: backup-ul stă lângă bază, pe același disc — bun
            pentru o migrare greșită, inutil pentru un disc mort. Arătând-o,
            limita se vede, nu se presupune. */}
        {d && <div className="text-[11px] text-muted-foreground/70 truncate">{d.dir}</div>}
      </div>
    </section>
  );
}
