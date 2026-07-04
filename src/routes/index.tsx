import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PlayCircle, Images, Download, Cpu, ChevronRight, Users, HardDrive, ListChecks, Gauge, ArrowDown, ArrowUp, Activity } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageShell } from "@/components/PageShell";
import { ServicePill } from "@/components/ServicePill";
import { RadialGauge } from "@/components/RadialGauge";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { plexQuery, immichQuery, qbitQuery, hostQuery, adminStatusQuery, lastSpeedtestQuery } from "@/lib/queries";
import type { HostData } from "@/lib/services.functions";
import { runSpeedtest } from "@/lib/speedtest.functions";
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
  const admin = useQuery(adminStatusQuery);
  const speedtest = useQuery(lastSpeedtestQuery);
  const [plexDrawer, setPlexDrawer] = useState<"views" | "users" | null>(null);
  const [speedtestDrawer, setSpeedtestDrawer] = useState(false);

  const qc = useQueryClient();
  const runSpeedtestFn = useServerFn(runSpeedtest);
  const speedtestMutation = useMutation({
    mutationFn: () => runSpeedtestFn(),
    onSuccess: (res) => {
      if (res.ok) {
        qc.setQueryData(["speedtest"], res);
        toast.success("Test de viteză finalizat");
      } else {
        toast.error(`Testul a eșuat: ${res.error}`);
      }
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };

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
              <MetricButton
                label="Vizionate Azi"
                value={String(plex.data.episodesToday ?? 0)}
                onClick={stop(() => setPlexDrawer("views"))}
              />
              <MetricButton
                label="Utilizatori activi azi"
                value={String(plex.data.activeUsersToday ?? 0)}
                onClick={stop(() => setPlexDrawer("users"))}
              />
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

      <button
        type="button"
        onClick={() => setSpeedtestDrawer(true)}
        className="block w-full rounded-2xl border border-border bg-card p-4 text-left active:scale-[0.99] transition-transform"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-rose-400"><Gauge className="h-5 w-5" /></span>
            <span className="font-semibold">Speedtest</span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
        {speedtest.data ? (
          <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <Metric icon={<ArrowDown className="h-3.5 w-3.5" />} label="Download" value={formatSpeed(speedtest.data.download)} />
            <Metric icon={<ArrowUp className="h-3.5 w-3.5" />} label="Upload" value={formatSpeed(speedtest.data.upload)} />
            <Metric icon={<Activity className="h-3.5 w-3.5" />} label="Ping" value={`${speedtest.data.ping.latency.toFixed(0)} ms`} />
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            {speedtest.isLoading ? "Se încarcă..." : "Niciun test efectuat încă."}
          </p>
        )}
        {speedtest.data && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Ultimul test: {new Date(speedtest.data.timestamp).toLocaleString()}
          </p>
        )}
      </button>

      <Drawer open={plexDrawer === "views"} onOpenChange={(o) => !o && setPlexDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>Vizionate Azi</DrawerTitle>
            <DrawerDescription>
              {plex.data?.status === "ok" ? `${plex.data.todayViews?.length ?? 0} vizionări` : ""}
            </DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-6">
            {plex.data?.status === "ok" && (plex.data.todayViews?.length ?? 0) > 0 ? (
              <ul className="rounded-2xl border border-border bg-card divide-y divide-border">
                {plex.data.todayViews!.map((e, i) => {
                  const seasonEp =
                    e.season != null && e.episode != null
                      ? `S${String(e.season).padStart(2, "0")}E${String(e.episode).padStart(2, "0")}`
                      : null;
                  const heading = e.show
                    ? `${e.show}${seasonEp ? ` — ${seasonEp}` : ""}${e.title ? ` · ${e.title}` : ""}`
                    : e.title;
                  return (
                    <li key={i} className="px-3 py-2 text-sm">
                      <div className="truncate">{heading}</div>
                      <div className="mt-0.5 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span className="truncate">{e.user ?? "—"}</span>
                        <span className="tabular-nums shrink-0 pl-2">
                          {e.viewedAt > 0 ? new Date(e.viewedAt * 1000).toLocaleTimeString() : "—"}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                Nicio vizionare azi.
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer open={plexDrawer === "users"} onOpenChange={(o) => !o && setPlexDrawer(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>Utilizatori activi azi</DrawerTitle>
            <DrawerDescription>
              {plex.data?.status === "ok" ? `${plex.data.activeUsersTodayList?.length ?? 0} utilizatori` : ""}
            </DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-6">
            {plex.data?.status === "ok" && (plex.data.activeUsersTodayList?.length ?? 0) > 0 ? (
              <ul className="rounded-2xl border border-border bg-card divide-y divide-border">
                {plex.data.activeUsersTodayList!.map((u, i) => (
                  <li key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="truncate">{u.user}</span>
                    <span className="shrink-0 pl-2 text-xs font-medium tabular-nums text-muted-foreground">
                      {u.count} {u.count === 1 ? "vizionare" : "vizionări"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                Niciun utilizator activ azi.
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer open={speedtestDrawer} onOpenChange={setSpeedtestDrawer}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>Speedtest</DrawerTitle>
            <DrawerDescription>
              {speedtest.data
                ? `Ultimul test: ${new Date(speedtest.data.timestamp).toLocaleString()}`
                : "Niciun test efectuat încă."}
            </DrawerDescription>
          </DrawerHeader>
          <div className="space-y-4 px-4 pb-6">
            {speedtest.data && (
              <div className="grid grid-cols-3 gap-2 text-sm">
                <Metric icon={<ArrowDown className="h-3.5 w-3.5" />} label="Download" value={formatSpeed(speedtest.data.download)} />
                <Metric icon={<ArrowUp className="h-3.5 w-3.5" />} label="Upload" value={formatSpeed(speedtest.data.upload)} />
                <Metric icon={<Activity className="h-3.5 w-3.5" />} label="Ping" value={`${speedtest.data.ping.latency.toFixed(0)} ms`} />
              </div>
            )}
            {speedtest.data?.server && (
              <div className="rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">
                <div>Server: {speedtest.data.server.name ?? "—"} {speedtest.data.server.location ? `(${speedtest.data.server.location})` : ""}</div>
                {speedtest.data.isp && <div>ISP: {speedtest.data.isp}</div>}
                {speedtest.data.packetLoss != null && <div>Pierdere pachete: {speedtest.data.packetLoss}%</div>}
                {speedtest.data.resultUrl && (
                  <a href={speedtest.data.resultUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-primary underline">
                    Raport complet Ookla
                  </a>
                )}
              </div>
            )}

            {admin.data?.isAdmin ? (
              <button
                type="button"
                onClick={() => speedtestMutation.mutate()}
                disabled={speedtestMutation.isPending}
                className="w-full rounded-xl border border-rose-500/30 bg-rose-500/15 px-3 py-2.5 text-sm font-medium text-rose-400 hover:bg-rose-500/25 disabled:opacity-50"
              >
                {speedtestMutation.isPending ? "Se rulează testul... (poate dura 30-60s)" : "Rulează test nou"}
              </button>
            ) : (
              <div className="rounded-xl border border-border bg-muted/30 p-3 text-center text-xs text-muted-foreground">
                Necesită autentificare admin pentru a rula un test nou.{" "}
                <Link to="/login" className="text-primary underline">
                  Autentificare
                </Link>
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </PageShell>
  );
}

function HostGauges({ data }: { data: HostData }) {
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

function MetricButton({
  label,
  value,
  icon,
  onClick,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg bg-muted/40 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/60 active:bg-muted"
    >
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}{label}
      </div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </button>
  );
}
