import { useQuery } from "@tanstack/react-query";
import { GitCommitHorizontal, Clock, Activity } from "lucide-react";

import { recentCommitsQuery, commitsFromDbQuery } from "@/lib/queries";
import { StatCell } from "../StatCell";

export function CommitStatsSection() {
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
            <StatCell
              label="Total"
              value={String(total)}
              icon={<GitCommitHorizontal className="h-3.5 w-3.5 text-sky-400" />}
            />
            <StatCell
              label="Azi"
              value={String(today)}
              icon={<Clock className="h-3.5 w-3.5 text-emerald-400" />}
            />
            <StatCell
              label="Săptămâna"
              value={String(thisWeek)}
              icon={<Activity className="h-3.5 w-3.5 text-amber-400" />}
            />
          </div>
        )}
      </div>
    </section>
  );
}
