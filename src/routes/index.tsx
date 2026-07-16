import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  PlayCircle,
  Images,
  Download,
  Cpu,
  ChevronRight,
  Users,
  HardDrive,
  ListChecks,
  Gauge,
  ArrowDown,
  ArrowUp,
  Activity,
  Tv,
  Film,
  ScrollText,
  RefreshCw,
  CheckCircle2,
  Server,
  Package,
  GitCommitHorizontal,
  ExternalLink,
  Plus,
  Minus,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageShell } from "@/components/PageShell";
import { ServicePill } from "@/components/ServicePill";
import { RadialGauge } from "@/components/RadialGauge";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import {
  plexQuery,
  immichQuery,
  qbitQuery,
  hostQuery,
  adminStatusQuery,
  lastSpeedtestQuery,
  activityLogQuery,
  recentCommitsQuery,
  commitsFromDbQuery,
} from "@/lib/queries";
import type { ActivityEntry } from "@/lib/activity-log";
import type { GitHubCommit, GitHubCommitDetail } from "@/lib/github.functions";
import { getCommitDetail } from "@/lib/github.functions";
import type { HostData } from "@/lib/services.functions";
import { runSpeedtest } from "@/lib/speedtest.functions";
import { formatBytes, formatSpeed } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Prezentare generală — Monitor Server" },
      {
        name: "description",
        content: "Stare în timp real pentru Plex, Immich, qBittorrent și gazdă.",
      },
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
  const [speedtestError, setSpeedtestError] = useState<string | null>(null);
  const speedtestMutation = useMutation({
    mutationFn: () => {
      setSpeedtestError(null);
      return runSpeedtestFn();
    },
    onSuccess: (res) => {
      if (res.ok) {
        qc.setQueryData(["speedtest"], res);
        toast.success("Test de viteză finalizat");
      } else {
        setSpeedtestError(res.error);
        toast.error(`Testul a eșuat: ${res.error}`);
      }
    },
    onError: (e) => {
      setSpeedtestError((e as Error).message);
      toast.error((e as Error).message);
    },
  });

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };

  return (
    <PageShell title="FaikkitBox Dashboard" subtitle="Totul în timp real">
      <ServiceRow
        to="/plex"
        title="Plex"
        icon={<PlayCircle className="h-5 w-5" />}
        accent="text-amber-400"
        status={plex.isLoading ? "loading" : (plex.data?.status ?? "error")}
        error={plex.data?.error}
      >
        {plex.data?.status === "ok" && (
          <div className="space-y-2 text-sm">
            {plex.data.sessions.length > 0 ? (
              <div className="space-y-1.5">
                {plex.data.sessions.map((s, i) => {
                  const pct =
                    s.durationMs > 0 ? Math.round((s.viewOffsetMs / s.durationMs) * 100) : 0;
                  const fmt = (ms: number) => {
                    const t = Math.floor(ms / 1000);
                    const h = Math.floor(t / 3600);
                    const m = Math.floor((t % 3600) / 60);
                    const sec = t % 60;
                    return h > 0
                      ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
                      : `${m}:${String(sec).padStart(2, "0")}`;
                  };
                  const isEpisode = !!s.grandparentTitle;
                  return (
                    <div key={i} className="rounded-lg bg-muted/40 px-2.5 py-2 space-y-1.5">
                      <div className="flex items-start gap-1.5">
                        {isEpisode ? (
                          <Tv className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-400" />
                        ) : (
                          <Film className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <div className="truncate text-sm font-semibold leading-tight">
                              {isEpisode ? s.grandparentTitle : s.title}
                            </div>
                            {s.playerState === "paused" ? (
                              <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                                ⏸ Pauză
                              </span>
                            ) : (
                              <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                                ▶ Redare
                              </span>
                            )}
                          </div>
                          {isEpisode && (
                            <div className="truncate text-[11px] text-muted-foreground">
                              {s.title}
                            </div>
                          )}
                          <div className="text-[11px] text-muted-foreground">
                            {s.user} · {s.player}
                          </div>
                        </div>
                      </div>
                      {s.durationMs > 0 && (
                        <div className="space-y-0.5">
                          <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-amber-400 transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-[10px] text-muted-foreground">
                            <span>{fmt(s.viewOffsetMs)}</span>
                            <span>{pct}%</span>
                            <span>{fmt(s.durationMs)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  Se uită acum
                </div>
                <div className="mt-0.5 text-sm font-semibold">Nimeni</div>
              </div>
            )}
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
        status={immich.isLoading ? "loading" : (immich.data?.status ?? "error")}
        error={immich.data?.error}
      >
        {immich.data?.status === "ok" && (
          <div className="grid grid-cols-3 gap-2 text-sm">
            <Metric label="Fișiere" value={(immich.data.totalAssets ?? 0).toLocaleString()} />
            <Metric
              icon={<HardDrive className="h-3.5 w-3.5" />}
              label="Spațiu"
              value={formatBytes(immich.data.usageBytes ?? 0)}
            />
            <Metric
              icon={<ListChecks className="h-3.5 w-3.5" />}
              label="Sarcini în curs"
              value={(immich.data.jobQueueDepth ?? 0).toLocaleString()}
            />
          </div>
        )}
      </ServiceRow>

      <ServiceRow
        to="/qbit"
        title="qBittorrent"
        icon={<Download className="h-5 w-5" />}
        accent="text-sky-400"
        status={qbit.isLoading ? "loading" : (qbit.data?.status ?? "error")}
        error={qbit.data?.error}
      >
        {qbit.data?.status === "ok" && (
          <div className="grid grid-cols-3 gap-2 text-sm">
            <Metric label="↓" value={formatSpeed(qbit.data.dlSpeed)} />
            <Metric label="↑" value={formatSpeed(qbit.data.upSpeed)} />
            <Metric
              label="Active"
              value={`${qbit.data.counts.downloading + qbit.data.counts.seeding} / ${qbit.data.counts.total}`}
            />
          </div>
        )}
      </ServiceRow>

      <ServiceRow
        to="/sistem"
        title="Sistem"
        icon={<Cpu className="h-5 w-5" />}
        accent="text-emerald-400"
        status={host.isLoading ? "loading" : (host.data?.status ?? "error")}
        error={host.data?.error}
      >
        {host.data?.status === "ok" && <HostGauges data={host.data} />}
      </ServiceRow>

      <button
        type="button"
        onClick={() => setSpeedtestDrawer(true)}
        className="block w-full rounded-2xl border border-border bg-card p-4 text-left active:scale-[0.99] transition-transform"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-rose-400">
              <Gauge className="h-5 w-5" />
            </span>
            <span className="font-semibold">Speedtest</span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
        {speedtest.data ? (
          <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <Metric
              icon={<ArrowDown className="h-3.5 w-3.5" />}
              label="Download"
              value={formatSpeed(speedtest.data.download)}
            />
            <Metric
              icon={<ArrowUp className="h-3.5 w-3.5" />}
              label="Upload"
              value={formatSpeed(speedtest.data.upload)}
            />
            <Metric
              icon={<Activity className="h-3.5 w-3.5" />}
              label="Ping"
              value={`${speedtest.data.ping.latency.toFixed(0)} ms`}
            />
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
              {plex.data?.status === "ok"
                ? `${plex.data.activeUsersTodayList?.length ?? 0} utilizatori`
                : ""}
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
                <Metric
                  icon={<ArrowDown className="h-3.5 w-3.5" />}
                  label="Download"
                  value={formatSpeed(speedtest.data.download)}
                />
                <Metric
                  icon={<ArrowUp className="h-3.5 w-3.5" />}
                  label="Upload"
                  value={formatSpeed(speedtest.data.upload)}
                />
                <Metric
                  icon={<Activity className="h-3.5 w-3.5" />}
                  label="Ping"
                  value={`${speedtest.data.ping.latency.toFixed(0)} ms`}
                />
              </div>
            )}
            {speedtest.data?.server && (
              <div className="rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">
                <div>
                  Server: {speedtest.data.server.name ?? "—"}{" "}
                  {speedtest.data.server.location ? `(${speedtest.data.server.location})` : ""}
                </div>
                {speedtest.data.isp && <div>ISP: {speedtest.data.isp}</div>}
                {speedtest.data.packetLoss != null && (
                  <div>Pierdere pachete: {speedtest.data.packetLoss}%</div>
                )}
                {speedtest.data.resultUrl && (
                  <a
                    href={speedtest.data.resultUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-primary underline"
                  >
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
                {speedtestMutation.isPending
                  ? "Se rulează testul... (poate dura 30-60s)"
                  : "Rulează test nou"}
              </button>
            ) : (
              <div className="rounded-xl border border-border bg-muted/30 p-3 text-center text-xs text-muted-foreground">
                Necesită autentificare admin pentru a rula un test nou.{" "}
                <Link to="/login" className="text-primary underline">
                  Autentificare
                </Link>
              </div>
            )}

            {speedtestError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                <div className="font-semibold">Testul a eșuat</div>
                <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all">
                  {speedtestError}
                </pre>
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
      <ActivityLogSection />
    </PageShell>
  );
}

function HostGauges({ data }: { data: HostData }) {
  const cpu = data.cpuPercent ?? 0;
  const mem = data.memPercent ?? 0;
  const netTotal = (data.net ?? []).reduce((sum, n) => sum + (n.rxSec ?? 0) + (n.txSec ?? 0), 0);
  // Scale network to a rough 100 Mbit/s = 100% reference
  const netRef = (100 * 1024 * 1024) / 8; // bytes/s
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
        sub={
          data.memUsedBytes != null && data.memTotalBytes != null
            ? `${formatBytes(data.memUsedBytes)}`
            : undefined
        }
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
  to,
  title,
  icon,
  accent,
  status,
  error,
  children,
}: {
  to: "/plex" | "/immich" | "/qbit" | "/sistem";
  title: string;
  icon: React.ReactNode;
  accent: string;
  status: "ok" | "error" | "loading";
  error?: string;
  children?: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="block rounded-2xl border border-border bg-card p-4 active:scale-[0.99] transition-transform"
    >
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
        {icon}
        {label}
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
        {icon}
        {label}
      </div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </button>
  );
}

type TimelineItem =
  | { kind: "activity"; ts: number; entry: ActivityEntry }
  | { kind: "commit"; ts: number; commit: GitHubCommit };

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "acum";
  const m = Math.floor(s / 60);
  if (m < 60) return `acum ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `acum ${h}h`;
  const d = Math.floor(h / 24);
  return `acum ${d}z`;
}

function CommitDrawer({ commit, onClose }: { commit: GitHubCommit; onClose: () => void }) {
  const getDetail = useServerFn(getCommitDetail);
  const { data, isLoading } = useQuery({
    queryKey: ["commitDetail", commit.sha],
    queryFn: () => getDetail({ data: { sha: commit.sha } }),
    staleTime: 5 * 60_000,
  });

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString("ro-RO", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Bucharest",
    });

  const statusColor = (s: string) =>
    s === "added" ? "text-emerald-400" : s === "removed" ? "text-red-400" : "text-amber-400";
  const statusLabel = (s: string) => (s === "added" ? "A" : s === "removed" ? "D" : "M");

  const lines = (data?.status === "ok" ? data.message : commit.message).split("\n").filter(Boolean);
  const title = lines[0] ?? "";
  const body = lines.slice(1);

  return (
    <Drawer
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DrawerContent>
        <DrawerHeader className="pb-2">
          <DrawerTitle className="flex items-center gap-2 text-base">
            <GitCommitHorizontal className="h-4 w-4 text-sky-400 shrink-0" />
            <span className="font-mono text-sky-400 text-sm">{commit.shortSha}</span>
          </DrawerTitle>
          <DrawerDescription className="text-left text-sm font-medium text-foreground leading-snug mt-1">
            {title}
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-6 space-y-4 overflow-y-auto max-h-[60vh]">
          {/* Meta */}
          <div className="text-xs text-muted-foreground">
            {commit.author} · {commit.date ? fmtDate(commit.date) : ""}
          </div>

          {/* Corp mesaj */}
          {body.length > 0 && (
            <div className="rounded-xl bg-muted/40 border border-border px-3 py-2.5 text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {body.join("\n")}
            </div>
          )}

          {/* Stats */}
          {isLoading && (
            <div className="text-xs text-muted-foreground animate-pulse">
              Se încarcă detaliile...
            </div>
          )}
          {data?.status === "ok" && (
            <>
              <div className="flex items-center gap-4 text-xs">
                <span className="text-muted-foreground">
                  {data.filesChanged} fișier{data.filesChanged !== 1 ? "e" : ""} modificat
                  {data.filesChanged !== 1 ? "e" : ""}
                </span>
                <span className="flex items-center gap-1 text-emerald-400">
                  <Plus className="h-3 w-3" />
                  {data.additions}
                </span>
                <span className="flex items-center gap-1 text-red-400">
                  <Minus className="h-3 w-3" />
                  {data.deletions}
                </span>
              </div>

              {/* Lista fișiere */}
              <div className="rounded-xl border border-border divide-y divide-border/50 overflow-hidden">
                {data.files.map((f) => (
                  <div key={f.filename} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                    <span
                      className={`font-mono font-bold w-4 text-center shrink-0 ${statusColor(f.status)}`}
                    >
                      {statusLabel(f.status)}
                    </span>
                    <span className="font-mono min-w-0 truncate text-muted-foreground flex-1">
                      {f.filename}
                    </span>
                    <span className="shrink-0 flex items-center gap-1.5 text-[11px]">
                      {f.additions > 0 && <span className="text-emerald-400">+{f.additions}</span>}
                      {f.deletions > 0 && <span className="text-red-400">−{f.deletions}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
          {data?.status === "error" && (
            <div className="text-xs text-red-400">
              Nu s-au putut încărca detaliile: {data.error}
            </div>
          )}

          {/* Link GitHub */}
          <a
            href={commit.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3 w-3" /> Vezi pe GitHub
          </a>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function ActivityLogSection() {
  const { data: log, isLoading: logLoading } = useQuery(activityLogQuery);
  useQuery(recentCommitsQuery); // fetch periodic GitHub → upsert DB
  const { data: commitsData, isLoading: commitsLoading } = useQuery(commitsFromDbQuery);
  const [visible, setVisible] = useState(10);
  const [selectedCommit, setSelectedCommit] = useState<GitHubCommit | null>(null);

  const iconMap: Record<string, React.ReactNode> = {
    server_start: <Server className="h-3.5 w-3.5 text-emerald-400" />,
    server_stop: <Server className="h-3.5 w-3.5 text-red-400" />,
    plex_watch_start: <PlayCircle className="h-3.5 w-3.5 text-amber-400" />,
    plex_watch_stop: <PlayCircle className="h-3.5 w-3.5 text-muted-foreground" />,
    torrent_added: <Download className="h-3.5 w-3.5 text-blue-400" />,
    torrent_complete: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
    immich_upload: <Images className="h-3.5 w-3.5 text-purple-400" />,
    service_restart: <RefreshCw className="h-3.5 w-3.5 text-sky-400" />,
    service_update: <Package className="h-3.5 w-3.5 text-amber-400" />,
    ubuntu_update: <Package className="h-3.5 w-3.5 text-orange-400" />,
    qbit_action: <Download className="h-3.5 w-3.5 text-sky-400" />,
  };

  const timeline: TimelineItem[] = [
    ...(log ?? []).map((entry): TimelineItem => ({
      kind: "activity",
      ts: new Date(entry.timestamp).getTime(),
      entry,
    })),
    ...(commitsData?.status === "ok" ? commitsData.commits : []).map((commit): TimelineItem => ({
      kind: "commit",
      ts: new Date(commit.date).getTime(),
      commit,
    })),
  ].sort((a, b) => b.ts - a.ts);

  const isLoading = logLoading || commitsLoading;
  const shown = timeline.slice(0, visible);
  const hasMore = timeline.length > visible;

  return (
    <>
      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <ScrollText className="h-3.5 w-3.5" /> Jurnal activitate
        </h2>
        <div className="rounded-2xl border border-border bg-card divide-y divide-border/50">
          {isLoading && (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">Se încarcă...</div>
          )}
          {!isLoading && timeline.length === 0 && (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              Nicio activitate înregistrată încă.
            </div>
          )}
          {shown.map((item) => {
            if (item.kind === "activity") {
              const entry = item.entry;
              return (
                <div key={entry.id} className="flex items-start gap-2.5 px-3 py-2.5">
                  <div className="mt-0.5 shrink-0">
                    {iconMap[entry.type] ?? (
                      <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm leading-tight">{entry.message}</div>
                  </div>
                  <div className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">
                    {relativeTime(entry.timestamp)}
                  </div>
                </div>
              );
            }
            const c = item.commit;
            return (
              <button
                key={c.sha}
                onClick={() => setSelectedCommit(c)}
                className="w-full flex items-start gap-2.5 px-3 py-2.5 hover:bg-muted/40 transition-colors group text-left"
              >
                <div className="mt-0.5 shrink-0">
                  <GitCommitHorizontal className="h-3.5 w-3.5 text-sky-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm leading-tight group-hover:text-sky-400 transition-colors">
                    {c.message}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {c.author} · <span className="font-mono">{c.shortSha}</span>
                  </div>
                </div>
                <div className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">
                  {relativeTime(c.date)}
                </div>
              </button>
            );
          })}
          {hasMore && (
            <button
              onClick={() => setVisible((v) => v + 10)}
              className="w-full px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors text-center"
            >
              Afișează încă 10 ({timeline.length - visible} rămase)
            </button>
          )}
        </div>
      </section>

      {selectedCommit && (
        <CommitDrawer commit={selectedCommit} onClose={() => setSelectedCommit(null)} />
      )}
    </>
  );
}
