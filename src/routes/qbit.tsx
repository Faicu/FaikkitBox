import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, HardDrive, Percent } from "lucide-react";

import { PageShell } from "@/components/PageShell";
import { ServicePill } from "@/components/ServicePill";
import { StatCard } from "@/components/StatCard";
import { Meter } from "@/components/Meter";
import { ErrorCard } from "@/components/ErrorCard";
import { qbitQuery } from "@/lib/queries";
import { formatBytes, formatSpeed, formatEta } from "@/lib/format";

export const Route = createFileRoute("/qbit")({
  head: () => ({ meta: [{ title: "qBittorrent — Server Monitor" }] }),
  component: QbitPage,
});

function stateBadge(state: string) {
  const s = state.toLowerCase();
  if (s.includes("download")) return { text: "Down", cls: "bg-sky-500/20 text-sky-400" };
  if (s.includes("up") || s === "uploading" || s === "stalledup") return { text: "Seed", cls: "bg-emerald-500/20 text-emerald-400" };
  if (s.includes("paus")) return { text: "Paused", cls: "bg-muted text-muted-foreground" };
  if (s.includes("error")) return { text: "Error", cls: "bg-red-500/20 text-red-400" };
  if (s.includes("stall")) return { text: "Stalled", cls: "bg-amber-500/20 text-amber-400" };
  return { text: state, cls: "bg-muted text-muted-foreground" };
}

function QbitPage() {
  const { data, isLoading } = useQuery(qbitQuery);
  const status = isLoading ? "loading" : data?.status ?? "error";

  return (
    <PageShell
      title="qBittorrent"
      subtitle={data?.status === "ok" ? `v${data.version} · ${data.counts.total} torrents` : "Torrent client"}
      right={<ServicePill status={status} />}
    >
      {data?.status === "error" && <ErrorCard title="qBittorrent unreachable" message={data.error ?? "Unknown error"} />}

      {data?.status === "ok" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatCard label="Download" value={formatSpeed(data.dlSpeed)} sub={`Total ${formatBytes(data.totalDl)}`} icon={<ArrowDown className="h-4 w-4" />} accent="text-sky-400" />
            <StatCard label="Upload" value={formatSpeed(data.upSpeed)} sub={`Total ${formatBytes(data.totalUp)}`} icon={<ArrowUp className="h-4 w-4" />} accent="text-emerald-400" />
            <StatCard label="Ratio" value={data.globalRatio.toFixed(2)} icon={<Percent className="h-4 w-4" />} accent="text-sky-400" />
            <StatCard label="Free disk" value={formatBytes(data.freeSpaceOnDisk)} icon={<HardDrive className="h-4 w-4" />} accent="text-sky-400" />
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl bg-sky-500/15 py-2 text-sky-400"><b className="block text-lg">{data.counts.downloading}</b>Downloading</div>
            <div className="rounded-xl bg-emerald-500/15 py-2 text-emerald-400"><b className="block text-lg">{data.counts.seeding}</b>Seeding</div>
            <div className="rounded-xl bg-muted py-2 text-muted-foreground"><b className="block text-lg">{data.counts.paused}</b>Paused</div>
          </div>

          <section>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Torrents ({data.torrents.length})
            </h2>
            {data.torrents.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">No torrents.</div>
            ) : (
              <div className="space-y-2">
                {data.torrents.map((t) => {
                  const b = stateBadge(t.state);
                  return (
                    <div key={t.hash} className="rounded-2xl border border-border bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</div>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${b.cls}`}>{b.text}</span>
                      </div>
                      <div className="mt-2">
                        <Meter value={t.progress * 100} right={`${(t.progress * 100).toFixed(1)}%`} tone="default" />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                        <span>{formatBytes(t.size * t.progress)} / {formatBytes(t.size)}</span>
                        <span className="flex items-center gap-2">
                          <span className="text-sky-400">↓ {formatSpeed(t.dlspeed)}</span>
                          <span className="text-emerald-400">↑ {formatSpeed(t.upspeed)}</span>
                          <span>{formatEta(t.eta)}</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </PageShell>
  );
}