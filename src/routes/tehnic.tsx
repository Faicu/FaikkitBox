import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Gauge,
  ArrowDown,
  ArrowUp,
  Activity,
  ScrollText,
  RefreshCw,
  CheckCircle2,
  Server,
  Package,
  GitCommitHorizontal,
  ExternalLink,
  Plus,
  Minus,
  Download,
  Images,
  PlayCircle,
  Cpu,
  Clock,
  Bell,
  Box,
} from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";

import { PageShell } from "@/components/PageShell";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import {
  activityLogQuery,
  recentCommitsQuery,
  commitsFromDbQuery,
  adminStatusQuery,
  lastSpeedtestQuery,
  speedtestHistoryQuery,
} from "@/lib/queries";
import type { ActivityEntry } from "@/lib/activity-log";
import type { GitHubCommit, GitHubCommitDetail } from "@/lib/github.functions";
import { getCommitDetail } from "@/lib/github.functions";
import { runSpeedtest } from "@/lib/speedtest.functions";
import type { SpeedtestHistoryEntry } from "@/lib/speedtest.functions";
import { formatSpeed } from "@/lib/format";

export const Route = createFileRoute("/tehnic")({
  head: () => ({
    meta: [{ title: "Tehnic — Monitor Server" }],
  }),
  component: TehnicPage,
});

function TehnicPage() {
  const admin = useQuery(adminStatusQuery);
  const speedtest = useQuery(lastSpeedtestQuery);
  const speedtestHistory = useQuery(speedtestHistoryQuery);
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
        qc.invalidateQueries({ queryKey: ["speedtestHistory"] });
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

  return (
    <PageShell title="Tehnic" subtitle="Plugin-uri, statistici și diagnostice">
      {/* Plugin-uri active */}
      <PluginStatusSection />

      {/* Statistici commit-uri */}
      <CommitStatsSection />

      {/* Speedtest */}
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
          <span className="text-xs text-muted-foreground">›</span>
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

            {(speedtestHistory.data?.length ?? 0) > 0 && (
              <SpeedtestChart history={speedtestHistory.data!} />
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {/* Jurnal activitate */}
      <ActivityLogSection />
    </PageShell>
  );
}

// ── Plugin Status ────────────────────────────────────────────────────────────

const PLUGINS = [
  {
    id: "plex-session-tracker",
    label: "Plex Session Tracker",
    description: "Urmărire sesiuni & vizionări",
    icon: <PlayCircle className="h-4 w-4 text-amber-400" />,
    activityType: "plex_watch_start",
  },
  {
    id: "pinned-watcher",
    label: "Pinned Watcher",
    description: "Notificări torrente / episoade / Plex",
    icon: <Bell className="h-4 w-4 text-sky-400" />,
    activityType: "pinned_update",
  },
  {
    id: "github-commit-tracker",
    label: "GitHub Commit Tracker",
    description: "Sincronizare commit-uri din GitHub",
    icon: <GitCommitHorizontal className="h-4 w-4 text-purple-400" />,
    activityType: null,
  },
];

function PluginStatusSection() {
  const { data: log } = useQuery(activityLogQuery);
  const { data: commitsData } = useQuery(commitsFromDbQuery);

  function lastActivity(type: string | null): string | null {
    if (!type || !log) return null;
    const entry = log.find((e) => e.type === type);
    return entry ? entry.timestamp : null;
  }

  function lastCommitSync(): string | null {
    if (commitsData?.status !== "ok" || !commitsData.commits.length) return null;
    return commitsData.commits[0].date;
  }

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <Box className="h-3.5 w-3.5" /> Plugin-uri active
      </h2>
      <div className="rounded-2xl border border-border bg-card divide-y divide-border/50">
        {PLUGINS.map((p) => {
          const lastTs = p.id === "github-commit-tracker" ? lastCommitSync() : lastActivity(p.activityType);
          return (
            <div key={p.id} className="flex items-center gap-3 px-3 py-3">
              <div className="shrink-0">{p.icon}</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium leading-tight">{p.label}</div>
                <div className="text-[11px] text-muted-foreground">{p.description}</div>
              </div>
              <div className="shrink-0 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#4ade80]" />
                {lastTs && (
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {relativeTime(lastTs)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Commit Stats ─────────────────────────────────────────────────────────────

function CommitStatsSection() {
  useQuery(recentCommitsQuery);
  const { data: commitsData, isLoading } = useQuery(commitsFromDbQuery);

  const commits = commitsData?.status === "ok" ? commitsData.commits : [];
  const total = commits.length;

  const todayStr = new Date().toISOString().slice(0, 10);
  const today = commits.filter((c) => c.date.startsWith(todayStr)).length;

  const thisWeekStart = new Date();
  thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());
  const thisWeek = commits.filter((c) => new Date(c.date) >= thisWeekStart).length;

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <GitCommitHorizontal className="h-3.5 w-3.5" /> Statistici commit-uri
      </h2>
      <div className="rounded-2xl border border-border bg-card">
        {isLoading ? (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">Se încarcă...</div>
        ) : (
          <div className="grid grid-cols-3 divide-x divide-border/50">
            <StatCell label="Total" value={String(total)} icon={<GitCommitHorizontal className="h-3.5 w-3.5 text-sky-400" />} />
            <StatCell label="Azi" value={String(today)} icon={<Clock className="h-3.5 w-3.5 text-emerald-400" />} />
            <StatCell label="Săptămâna" value={String(thisWeek)} icon={<Activity className="h-3.5 w-3.5 text-amber-400" />} />
          </div>
        )}
      </div>
    </section>
  );
}

function StatCell({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 px-3 py-4">
      {icon}
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

// ── Jurnal activitate ────────────────────────────────────────────────────────

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
    <Drawer open onOpenChange={(o) => { if (!o) onClose(); }}>
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
          <div className="text-xs text-muted-foreground">
            {commit.author} · {commit.date ? fmtDate(commit.date) : ""}
          </div>

          {body.length > 0 && (
            <div className="rounded-xl bg-muted/40 border border-border px-3 py-2.5 text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {body.join("\n")}
            </div>
          )}

          {isLoading && (
            <div className="text-xs text-muted-foreground animate-pulse">Se încarcă detaliile...</div>
          )}
          {data?.status === "ok" && (
            <>
              <div className="flex items-center gap-4 text-xs">
                <span className="text-muted-foreground">
                  {data.filesChanged} fișier{data.filesChanged !== 1 ? "e" : ""} modificat{data.filesChanged !== 1 ? "e" : ""}
                </span>
                <span className="flex items-center gap-1 text-emerald-400">
                  <Plus className="h-3 w-3" />{data.additions}
                </span>
                <span className="flex items-center gap-1 text-red-400">
                  <Minus className="h-3 w-3" />{data.deletions}
                </span>
              </div>

              <div className="rounded-xl border border-border divide-y divide-border/50 overflow-hidden">
                {data.files.map((f) => (
                  <div key={f.filename} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                    <span className={`font-mono font-bold w-4 text-center shrink-0 ${statusColor(f.status)}`}>
                      {statusLabel(f.status)}
                    </span>
                    <span className="font-mono min-w-0 truncate text-muted-foreground flex-1">{f.filename}</span>
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
            <div className="text-xs text-red-400">Nu s-au putut încărca detaliile: {data.error}</div>
          )}

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

const FILTER_GROUPS: { key: string; label: string }[] = [
  { key: "all", label: "Toate" },
  { key: "server", label: "Server" },
  { key: "plex", label: "Plex" },
  { key: "torrente", label: "Torrente" },
  { key: "immich", label: "Immich" },
  { key: "updates", label: "Updates" },
  { key: "commits", label: "Commits" },
  { key: "lansari", label: "Lansări" },
];

const TYPE_TO_GROUP: Record<string, string> = {
  server_start: "server", server_stop: "server",
  plex_watch_start: "plex", plex_watch_stop: "plex",
  torrent_added: "torrente", torrent_complete: "torrente", qbit_action: "torrente",
  immich_upload: "immich",
  service_restart: "updates", service_update: "updates", ubuntu_update: "updates",
  pinned_update: "lansari",
};

function ActivityLogSection() {
  const { data: log, isLoading: logLoading } = useQuery(activityLogQuery);
  useQuery(recentCommitsQuery);
  const { data: commitsData, isLoading: commitsLoading } = useQuery(commitsFromDbQuery);
  const [visible, setVisible] = useState(10);
  const [filter, setFilter] = useState("all");
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
    pinned_update: <Bell className="h-3.5 w-3.5 text-sky-400" />,
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

  const filtered = filter === "all" ? timeline : timeline.filter((item) => {
    if (item.kind === "commit") return filter === "commits";
    return TYPE_TO_GROUP[item.entry.type] === filter;
  });

  useEffect(() => { setVisible(10); }, [filter]);

  const shown = filtered.slice(0, visible);
  const hasMore = filtered.length > visible;

  return (
    <>
      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <ScrollText className="h-3.5 w-3.5" /> Jurnal activitate
        </h2>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          {FILTER_GROUPS.map((g) => (
            <button
              key={g.key}
              onClick={() => setFilter(g.key)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === g.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="rounded-2xl border border-border bg-card divide-y divide-border/50">
          {isLoading && (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">Se încarcă...</div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              {filter === "all" ? "Nicio activitate înregistrată încă." : "Nicio activitate pentru acest filtru."}
            </div>
          )}
          {shown.map((item) => {
            if (item.kind === "activity") {
              const entry = item.entry;
              return (
                <div key={entry.id} className="flex items-start gap-2.5 px-3 py-2.5">
                  <div className="mt-0.5 shrink-0">
                    {iconMap[entry.type] ?? <Activity className="h-3.5 w-3.5 text-muted-foreground" />}
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
              Afișează încă 10 ({filtered.length - visible} rămase)
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

function SpeedtestChart({ history }: { history: SpeedtestHistoryEntry[] }) {
  const sorted = [...history].reverse();
  const BAR_H = 80; // px — înălțimea maximă a barelor
  const maxDl = Math.max(...sorted.map((h) => h.download), 1);
  const maxUp = Math.max(...sorted.map((h) => h.upload), 1);
  const maxAll = Math.max(maxDl, maxUp);

  const fmt = (v: number) => {
    const mb = v / 1_000_000;
    return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB/s` : `${mb.toFixed(0)} MB/s`;
  };

  const fmtDate = (ts: string) =>
    new Date(ts).toLocaleDateString("ro-RO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Istoric ({sorted.length} teste)
      </div>
      <div className="rounded-xl border border-border bg-card p-3">
        {/* Grafic bare */}
        <div className="flex items-end gap-1.5" style={{ height: BAR_H }}>
          {sorted.map((h) => {
            const dlH = Math.max(4, Math.round((h.download / maxAll) * BAR_H));
            const upH = Math.max(4, Math.round((h.upload / maxAll) * BAR_H));
            return (
              <div key={h.id} className="flex-1 flex flex-row items-end gap-px group relative">
                <div
                  className="flex-1 rounded-t bg-sky-500/70 group-hover:bg-sky-400 transition-colors"
                  style={{ height: dlH }}
                />
                <div
                  className="flex-1 rounded-t bg-emerald-500/70 group-hover:bg-emerald-400 transition-colors"
                  style={{ height: upH }}
                />
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                  <div className="rounded-lg bg-popover border border-border px-2.5 py-1.5 text-[10px] whitespace-nowrap shadow-lg space-y-0.5">
                    <div className="text-sky-400">↓ {fmt(h.download)}</div>
                    <div className="text-emerald-400">↑ {fmt(h.upload)}</div>
                    <div className="text-muted-foreground border-t border-border/50 pt-0.5 mt-0.5">{fmtDate(h.timestamp)}</div>
                  </div>
                  <div className="w-1.5 h-1.5 bg-popover border-b border-r border-border rotate-45 -mt-1" />
                </div>
              </div>
            );
          })}
        </div>
        {/* Legendă + valori min/max */}
        <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-sky-500/70" />Download</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500/70" />Upload</span>
          </div>
          <span>max {fmt(maxAll)}</span>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 px-2.5 py-2 text-center">
      {icon && <div className="flex justify-center mb-1 text-muted-foreground">{icon}</div>}
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
