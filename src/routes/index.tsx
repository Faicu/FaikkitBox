import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PlayCircle, Images, Download, Cpu, ChevronRight, Users, HardDrive } from "lucide-react";

import { PageShell } from "@/components/PageShell";
import { ServicePill } from "@/components/ServicePill";
import { Meter } from "@/components/Meter";
import { plexQuery, immichQuery, qbitQuery, hostQuery } from "@/lib/queries";
import { formatBytes, formatSpeed } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Overview — Server Monitor" },
      { name: "description", content: "Live status of Plex, Immich, qBittorrent, and host." },
    ],
  }),
  component: Overview,
});

function Overview() {
  const plex = useQuery(plexQuery);
  const immich = useQuery(immichQuery);
  const qbit = useQuery(qbitQuery);
  const host = useQuery(hostQuery);

  return (
    <PageShell title="Server Monitor" subtitle="Statististici în Timp Real">
      <ServiceRow
        to="/plex"
        title="Plex"
        icon={<PlayCircle className="h-5 w-5" />}
        accent="text-amber-400"
        status={plex.isLoading ? "loading" : plex.data?.status ?? "error"}
        error={plex.data?.error}
      >
        {plex.data?.status === "ok" && (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Metric icon={<Users className="h-3.5 w-3.5" />} label="Now playing" value={String(plex.data.sessions.length)} />
            <Metric label="Libraries" value={String(plex.data.libraries.length)} />
          </div>
        )}
      </ServiceRow>

      <ServiceRow
        to="/immich"
        title="Immich"
        icon={<Images className="h-5 w-5" />}
        accent="text-purple-400"
        status={immich.isLoading ? "loading" : immich.data?.status ?? "error"}
        error={immich.data?.error}
      >
        {immich.data?.status === "ok" && (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Metric label="Assets" value={(immich.data.totalAssets ?? 0).toLocaleString()} />
            <Metric icon={<HardDrive className="h-3.5 w-3.5" />} label="Storage" value={formatBytes(immich.data.usageBytes ?? 0)} />
          </div>
        )}
      </ServiceRow>

      <ServiceRow
        to="/qbit"
        title="qBittorrent"
        icon={<Download className="h-5 w-5" />}
        accent="text-sky-400"
        status={qbit.isLoading ? "loading" : qbit.data?.status ?? "error"}
        error={qbit.data?.error}
      >
        {qbit.data?.status === "ok" && (
          <div className="grid grid-cols-3 gap-2 text-sm">
            <Metric label="↓" value={formatSpeed(qbit.data.dlSpeed)} />
            <Metric label="↑" value={formatSpeed(qbit.data.upSpeed)} />
            <Metric label="Active" value={String(qbit.data.counts.total)} />
          </div>
        )}
      </ServiceRow>

      <ServiceRow
        to="/host"
        title="Host"
        icon={<Cpu className="h-5 w-5" />}
        accent="text-emerald-400"
        status={host.isLoading ? "loading" : host.data?.status ?? "error"}
        error={host.data?.error}
      >
        {host.data?.status === "ok" && (
          <div className="space-y-2">
            <Meter label="CPU" right={`${(host.data.cpuPercent ?? 0).toFixed(0)}%`} value={host.data.cpuPercent ?? 0} />
            <Meter
              label="Memory"
              right={`${formatBytes(host.data.memUsedBytes ?? 0)} / ${formatBytes(host.data.memTotalBytes ?? 0)}`}
              value={host.data.memPercent ?? 0}
            />
          </div>
        )}
      </ServiceRow>
    </PageShell>
  );
}

function ServiceRow({
  to, title, icon, accent, status, error, children,
}: {
  to: "/plex" | "/immich" | "/qbit" | "/host";
  title: string;
  icon: React.ReactNode;
  accent: string;
  status: "ok" | "error" | "loading";
  error?: string;
  children?: React.ReactNode;
}) {
  return (
    <Link to={to} className="block rounded-2xl border border-border bg-card p-4 active:scale-[0.99] transition-transform">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={`${accent}`}>{icon}</span>
          <span className="font-semibold">{title}</span>
          <ServicePill status={status} />
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
      {status === "error" && error && (
        <p className="mt-2 text-xs text-red-400 break-words">{error}</p>
      )}
      {children && <div className="mt-3">{children}</div>}
    </Link>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}{label}
      </div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
