import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Box, GitCommitHorizontal, PlayCircle, Bell, RefreshCw } from "lucide-react";

import { activityLogQuery, commitsFromDbQuery } from "@/lib/queries";
import { getPinnedWatcherStatus, triggerPinnedWatcherCheck } from "@/lib/pinned.functions";
import { PinnedWatcherNextRun } from "../PinnedWatcherNextRun";
import { relativeTime } from "../utils";

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

export function PluginStatusSection() {
  const { data: log } = useQuery(activityLogQuery);
  const { data: commitsData } = useQuery(commitsFromDbQuery);
  const watcherStatusFn = useServerFn(getPinnedWatcherStatus);
  const triggerFn = useServerFn(triggerPinnedWatcherCheck);
  const queryClient = useQueryClient();
  const [triggerState, setTriggerState] = useState<"idle" | "pending" | "running">("idle");
  const [triggerCountdown, setTriggerCountdown] = useState(0);

  const { data: watcherStatus } = useQuery({
    queryKey: ["pinnedWatcherStatus"],
    queryFn: () => watcherStatusFn(),
    refetchInterval: 30_000,
  });

  async function handleTrigger() {
    if (triggerState !== "idle") return;
    setTriggerState("pending");
    setTriggerCountdown(10);
    await triggerFn();
    const interval = setInterval(() => {
      setTriggerCountdown((c) => {
        if (c <= 1) {
          clearInterval(interval);
          setTriggerState("running");
          // Refresh status după 15s (timp să ruleze checkAll)
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ["pinnedWatcherStatus"] });
            queryClient.invalidateQueries({ queryKey: ["activityLog"] });
            setTriggerState("idle");
          }, 15_000);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

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
          const lastTs =
            p.id === "github-commit-tracker" ? lastCommitSync() : lastActivity(p.activityType);
          const isPinnedWatcher = p.id === "pinned-watcher";
          return (
            <div key={p.id} className="flex items-center gap-3 px-3 py-3">
              <div className="shrink-0">{p.icon}</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium leading-tight">{p.label}</div>
                <div className="text-[11px] text-muted-foreground">{p.description}</div>
                {isPinnedWatcher && (
                  <button
                    onClick={handleTrigger}
                    disabled={triggerState !== "idle"}
                    className="mt-1.5 flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground transition hover:border-sky-500/40 hover:text-sky-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RefreshCw
                      className={`h-2.5 w-2.5 ${triggerState === "running" ? "animate-spin" : ""}`}
                    />
                    {triggerState === "idle" && "Verifică acum"}
                    {triggerState === "pending" && `Se pornește în ${triggerCountdown}s…`}
                    {triggerState === "running" && "Se verifică…"}
                  </button>
                )}
              </div>
              <div className="shrink-0 flex flex-col items-end gap-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#4ade80]" />
                  {isPinnedWatcher
                    ? watcherStatus?.lastRun && (
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {relativeTime(watcherStatus.lastRun)}
                        </span>
                      )
                    : lastTs && (
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {relativeTime(lastTs)}
                        </span>
                      )}
                </div>
                {isPinnedWatcher && watcherStatus?.nextRun && (
                  <PinnedWatcherNextRun nextRun={watcherStatus.nextRun} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
