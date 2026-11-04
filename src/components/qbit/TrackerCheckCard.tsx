import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Meter } from "@/components/Meter";
import { getTrackerCheck, startTrackerCheck } from "@/lib/services/qbit-tracker-check.functions";
import type { TrackerCheckItem } from "@/lib/services/qbit-tracker-check.functions";

const VERDICT: Record<TrackerCheckItem["verdict"], { title: string; cls: string }> = {
  removed: { title: "Șterse de pe tracker", cls: "text-red-400" },
  down: { title: "Tracker indisponibil", cls: "text-amber-400" },
  unknown: { title: "Neverificabile", cls: "text-muted-foreground" },
};

export function TrackerCheckCard() {
  const queryClient = useQueryClient();
  const fetchStatus = useServerFn(getTrackerCheck);
  const start = useServerFn(startTrackerCheck);
  const { data } = useQuery({
    queryKey: ["qbit-tracker-check"],
    queryFn: () => fetchStatus(),
    refetchInterval: (q) => (q.state.data?.running ? 2000 : false),
    staleTime: 0,
  });
  const mutation = useMutation({
    mutationFn: () => start(),
    onSuccess: (res) => {
      if (!res.ok) toast.error(res.error ?? "Verificarea n-a pornit");
      queryClient.invalidateQueries({ queryKey: ["qbit-tracker-check"] });
    },
    onError: (e) => toast.error(`Eroare: ${(e as Error).message}`),
  });

  // Torrentele oprite sunt pornite temporar — lista din qBit se reîmprospătează la final.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && data && !data.running) {
      queryClient.invalidateQueries({ queryKey: ["qbit"] });
    }
    wasRunning.current = !!data?.running;
  }, [data, queryClient]);

  const running = !!data?.running || mutation.isPending;
  const groups = (["removed", "down", "unknown"] as const)
    .map((v) => ({ v, list: (data?.items ?? []).filter((i) => i.verdict === v) }))
    .filter((g) => g.list.length > 0);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <h2 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Verificare trackere
        </h2>
        <button
          onClick={() => mutation.mutate()}
          disabled={running}
          className="rounded-xl border border-sky-500/30 bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-400 transition-transform hover:bg-sky-500/25 active:scale-[0.97] disabled:opacity-50"
        >
          {running ? "Se verifică…" : "Verifică acum"}
        </button>
      </div>

      <div className="space-y-2 rounded-2xl glass-card p-3 text-sm">
        {data?.running ? (
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">{data.phase}</div>
            <Meter
              value={data.total > 0 ? (data.done / data.total) * 100 : 0}
              right={`${data.done}/${data.total}`}
              tone="sky"
              active
            />
            <div className="text-[11px] text-muted-foreground">
              Torrentele oprite sunt pornite temporar și oprite la loc la final.
            </div>
          </div>
        ) : !data?.finishedAt ? (
          <div className="text-muted-foreground">
            Pornește torrentele oprite, cere trackerelor statusul și le oprește la loc. Durează cam
            un minut.
          </div>
        ) : (
          <>
            {data.error && <div className="text-red-400">{data.error}</div>}
            {data.counts && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums">
                <span className="text-emerald-400">{data.counts.ok} în regulă</span>
                <span className={data.counts.removed ? "text-red-400" : "text-muted-foreground"}>
                  {data.counts.removed} șterse
                </span>
                <span className={data.counts.down ? "text-amber-400" : "text-muted-foreground"}>
                  {data.counts.down} tracker indisponibil
                </span>
                <span className="text-muted-foreground">{data.counts.unknown} neverificabile</span>
              </div>
            )}
            <div className="text-[11px] text-muted-foreground">
              Ultima verificare: {new Date(data.finishedAt).toLocaleString("ro-RO")}
            </div>
          </>
        )}
      </div>

      {!data?.running &&
        groups.map(({ v, list }) => (
          <div key={v} className="mt-2">
            <h3 className={`mb-1 px-1 text-xs font-semibold ${VERDICT[v].cls}`}>
              {VERDICT[v].title} ({list.length})
            </h3>
            <ul className="divide-y divide-border rounded-2xl glass-card">
              {list.map((t) => (
                <li key={t.hash} className="px-3 py-2">
                  <div className="truncate text-sm">{t.label ?? t.name}</div>
                  {t.label && (
                    <div className="truncate text-[11px] text-muted-foreground">{t.name}</div>
                  )}
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {t.message}
                    {t.wasStopped ? " · era oprit" : ""}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </section>
  );
}
