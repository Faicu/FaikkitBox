import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Car, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageShell } from "@/components/PageShell";
import { TehnicSubNav } from "@/components/tehnic/TehnicSubNav";
import { relativeTime } from "@/components/tehnic/utils";
import { vwLogQuery } from "@/lib/queries";
import { clearVwLog, type VwLogEntry } from "@/lib/vw/vw-log.functions";
import { requireAdminBeforeLoad } from "@/lib/auth/admin-route-guard";

export const Route = createFileRoute("/vw")({
  beforeLoad: requireAdminBeforeLoad,
  head: () => ({ meta: [{ title: "VW Welcome — Monitor Server" }] }),
  component: VwPage,
});

// Liniile trimise cu întârziere mare (buffer offline, ceas greșit după boot) primesc o notă.
const LATE_MS = 2 * 60_000;

function lineColor(line: string): string {
  if (line.startsWith("TREZIRE")) return "text-emerald-400 font-semibold";
  if (/PIERDUT|REFUZAT|eroare|nu am putut/i.test(line)) return "text-red-400";
  if (/^(Serviciu|Pornit din autostart|BootReceiver)/.test(line)) return "text-sky-400";
  return "text-foreground/90";
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function VwPage() {
  const [eventsOnly, setEventsOnly] = useState(true);
  const { data, isLoading } = useQuery(vwLogQuery(eventsOnly));
  const entries: VwLogEntry[] = data ?? [];
  const lastReceived = entries.reduce<string | null>(
    (max, e) => (max === null || e.receivedAt > max ? e.receivedAt : max),
    null,
  );

  const qc = useQueryClient();
  const clearFn = useServerFn(clearVwLog);
  const clearMutation = useMutation({
    mutationFn: () => clearFn(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vwLog"] });
      toast.success("Jurnalul VW a fost golit");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <PageShell
      title="VW Welcome"
      subtitle={
        lastReceived
          ? `Jurnal navigație · ultima linie ${relativeTime(lastReceived)}`
          : "Jurnal navigație"
      }
    >
      <TehnicSubNav />

      <Link to="/calatorii" className="text-sm text-sky-400 hover:underline">
        Călătoriile mașinii →
      </Link>

      <div className="flex items-center justify-between rounded-2xl glass-card p-4">
        <div className="flex items-center gap-2.5">
          <Car className="h-5 w-5 text-sky-400" />
          <div>
            <p className="font-semibold">
              {entries.length} linii{eventsOnly ? " · doar evenimente" : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {entries[0]?.version ? `Aplicație ${entries[0].version} · ` : ""}ora afișată e cea de
              pe navigație
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setEventsOnly((v) => !v)}
            className="rounded-lg px-3 py-1.5 text-sm text-sky-400 hover:bg-sky-500/10"
          >
            {eventsOnly ? "Arată și CAN/diagnostic" : "Doar evenimente"}
          </button>
          <button
            type="button"
            disabled={entries.length === 0 || clearMutation.isPending}
            onClick={() => {
              if (confirm("Golești jurnalul VW?")) clearMutation.mutate();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />
            Golește
          </button>
        </div>
      </div>

      {isLoading && <div className="h-40 skeleton-sweep rounded-2xl" />}

      {!isLoading && entries.length === 0 && (
        <p className="rounded-2xl glass-card p-4 text-sm text-muted-foreground">
          Nicio linie primită încă. Activează „Trimite jurnalul la server” în aplicația de pe
          navigație.
        </p>
      )}

      {entries.length > 0 && (
        <div className="rounded-2xl glass-card p-3 font-mono text-xs leading-relaxed">
          {entries.map((e) => {
            const late =
              new Date(e.receivedAt).getTime() - new Date(e.deviceAt).getTime() > LATE_MS;
            return (
              <div key={e.id} className="flex gap-2 border-b border-border/30 py-1 last:border-0">
                <span className="shrink-0 text-muted-foreground">{formatTime(e.deviceAt)}</span>
                <span className={`min-w-0 break-words ${lineColor(e.line)}`}>
                  {e.line}
                  {late && (
                    <span className="ml-1 text-muted-foreground">
                      (primit {formatTime(e.receivedAt)})
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
