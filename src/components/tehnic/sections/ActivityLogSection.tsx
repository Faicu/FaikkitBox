import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ScrollText,
  Server,
  PlayCircle,
  Download,
  CheckCircle2,
  Images,
  RefreshCw,
  Package,
  Bell,
  Activity,
  GitCommitHorizontal,
} from "lucide-react";

import { activityLogQuery, recentCommitsQuery, commitsFromDbQuery } from "@/lib/queries";
import type { ActivityEntry } from "@/lib/activity-log";
import type { GitHubCommit } from "@/lib/github.functions";
import { CommitDrawer } from "../CommitDrawer";
import { relativeTime } from "../utils";

type TimelineItem =
  | { kind: "activity"; ts: number; entry: ActivityEntry }
  | { kind: "commit"; ts: number; commit: GitHubCommit };

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
  server_start: "server",
  server_stop: "server",
  plex_watch_start: "plex",
  plex_watch_stop: "plex",
  torrent_added: "torrente",
  torrent_complete: "torrente",
  qbit_action: "torrente",
  immich_upload: "immich",
  service_restart: "updates",
  service_update: "updates",
  ubuntu_update: "updates",
  pinned_update: "lansari",
};

export function ActivityLogSection() {
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

  const filtered =
    filter === "all"
      ? timeline
      : timeline.filter((item) => {
          if (item.kind === "commit") return filter === "commits";
          return TYPE_TO_GROUP[item.entry.type] === filter;
        });

  useEffect(() => {
    setVisible(10);
  }, [filter]);

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
              {filter === "all"
                ? "Nicio activitate înregistrată încă."
                : "Nicio activitate pentru acest filtru."}
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
