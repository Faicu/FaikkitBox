import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PlayCircle, Images, Download, Cpu, ChevronRight, Users, HardDrive, ListChecks, Network } from "lucide-react";

import { PageShell } from "@/components/PageShell";
import { ServicePill } from "@/components/ServicePill";
import { RadialGauge } from "@/components/RadialGauge";
import { plexQuery, immichQuery, qbitQuery, hostQuery } from "@/lib/queries";
import { formatBytes, formatSpeed } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Prezentare generală — Monitor Server" },
      { name: "description", content: "Stare în timp real pentru Plex, Immich, qBittorrent și gazdă." },
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
    <PageShell title="Monitor Server" subtitle="Statistici în timp real">
      <ServiceRow
        to="/plex"
        title="Plex"
        icon={<PlayCircle className="h-5 w-5" />}
        accent="text-amber-400"
        status={plex.isLoading ? "loading" : plex.data?.status ?? "error"}
        error={plex.data?.error}
      >
        {plex.data?.status === "ok" && (
          <div className="space-y-2 text-sm">
            <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
              <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                <Users className="h-3.5 w-3.5" />Se uită acum
              </div>
              <div className="mt-0.5 truncate text-sm font-semibold">
                {plex.data.sessions.length > 0
                  ? plex.data.sessions.map((s) => s.user).join(", ")
                  : "Nimeni"}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Episoade azi" value={String(plex.data.episodesToday ?? 0)} />
              <Metric label="Utilizatori activi azi" value={String(plex.data.activeUsersToday ?? 0)} />
            </div>
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
          <div className="grid grid-cols-3 gap-2 text-sm">
            <Metric label="Fișiere" value={(immich.data.totalAssets ?? 0).toLocaleString()} />
            <Metric icon={<HardDrive className="h-3.5 w-3.5" />} label="Spațiu" value={formatBytes(immich.data.usageBytes ?? 0)} />
            <Metric icon={<ListChecks className="h-3.5 w-3.5" />} label="Sarcini în curs" value={(immich.data.jobQueueDepth ?? 0).toLocaleString()} />
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
            <Metric label="Active" value={`${qbit.data.counts.downloading + qbit.data.counts.seeding} / ${qbit.data.counts.total}`} />
          </div>
        )}
      </ServiceRow>

      <ServiceRow
        to="/host"
        title="Gazdă"
        icon={<Cpu className="h-5 w-5" />}
        accent="text-emerald-400"
        status={host.isLoading ? "loading" : host.data?.status ?? "error"}
        error={host.data?.error}
      >
        {host.data?.status === "ok" && (
          <HostGauges data={host.data} />
        )}
      </ServiceRow>
    </PageShell>
  );
}

function HostGauges({ data }: { data: NonNullable<ReturnType<typeof useQuery<typeof hostQuery>>["data"]> }) {
  const cpu = data.cpuPercent ?? 0;
  const mem = data.memPercent ?? 0;
  const netTotal = (data.net ?? []).reduce((sum, n) => sum + (n.rxSec ?? 0) + (n.txSec ?? 0), 0);
  // Scale network to a rough 100 Mbit/s = 100% reference
  const netRef = 100 * 1024 * 1024 / 8; // bytes/s
  const netPct = Math.min(100, (netTotal / netRef) * 100);
  return (
    <div className="grid grid-cols-3 gap-2">
      <RadialGauge
        label="Procesor"
        value={cpu}
        centerText={`${cpu.toFixed(0)}%`}
        colorClass="text-emerald-400"
      />
      <RadialGauge
        label="Memorie"
        value={mem}
        centerText={`${mem.toFixed(0)}%`}
        sub={data.memUsedBytes != null && data.memTotalBytes != null ? `${formatBytes(data.memUsedBytes)}` : undefined}
        colorClass="text-primary"
      />
      <RadialGauge
        label="Rețea"
        value={netPct}
        centerText={formatSpeed(netTotal)}
        colorClass="text-sky-400"
      />
    </div>
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
