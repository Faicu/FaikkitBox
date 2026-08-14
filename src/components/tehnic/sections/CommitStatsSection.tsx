import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { GitCommitHorizontal, Clock, Activity, UploadCloud } from "lucide-react";
import { toast } from "sonner";

import {
  recentCommitsQuery,
  commitsFromDbQuery,
  githubPushStatusQuery,
  unpushedCommitsQuery,
} from "@/lib/queries";
import { pushToGitHub, type UnpushedCommit } from "@/lib/github.functions";
import { StatCell } from "../StatCell";
import { CommitDrawer } from "../CommitDrawer";

export function CommitStatsSection() {
  useQuery(recentCommitsQuery);
  const { data: commitsData, isLoading } = useQuery(commitsFromDbQuery);
  const pushStatus = useQuery(githubPushStatusQuery);
  const unpushed = useQuery(unpushedCommitsQuery);
  const [selectedUnpushed, setSelectedUnpushed] = useState<UnpushedCommit | null>(null);

  const qc = useQueryClient();
  const pushFn = useServerFn(pushToGitHub);
  const pushMutation = useMutation({
    mutationFn: () => pushFn(),
    onSuccess: (res) => {
      if (res.status === "ok") {
        toast.success(
          res.pushedCommits > 0
            ? `Trimis pe GitHub: ${res.pushedCommits} commit${res.pushedCommits !== 1 ? "-uri" : ""}`
            : "Nimic de trimis — deja sincronizat",
        );
        qc.invalidateQueries({ queryKey: ["githubPushStatus"] });
        qc.invalidateQueries({ queryKey: ["githubSync"] });
        qc.invalidateQueries({ queryKey: ["unpushedCommits"] });
      } else {
        toast.error(`Push eșuat: ${res.error}`);
      }
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const commits = commitsData?.status === "ok" ? commitsData.commits : [];
  const total = commits.length;

  const todayStr = new Date().toISOString().slice(0, 10);
  const today = commits.filter((c) => c.date.startsWith(todayStr)).length;

  const thisWeekStart = new Date();
  thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());
  const thisWeek = commits.filter((c) => new Date(c.date) >= thisWeekStart).length;

  const ahead = pushStatus.data?.status === "ok" ? pushStatus.data.data.ahead : 0;

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

      {ahead > 0 && unpushed.data?.status === "ok" && unpushed.data.commits.length > 0 && (
        <div className="rounded-2xl border border-border bg-card divide-y divide-border/50">
          {unpushed.data.commits.map((c) => (
            <button
              key={c.sha}
              type="button"
              onClick={() => setSelectedUnpushed(c)}
              className="w-full px-3 py-2 text-xs text-left hover:bg-muted/40 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-muted-foreground">{c.shortSha}</span>
                <span className="truncate text-foreground">{c.message}</span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {c.author} · {new Date(c.date).toLocaleString("ro-RO")}
              </div>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => pushMutation.mutate()}
        disabled={pushMutation.isPending || ahead === 0}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/15 px-3 py-2.5 text-sm font-medium text-sky-400 hover:bg-sky-500/25 disabled:opacity-50"
      >
        <UploadCloud className="h-4 w-4" />
        {pushMutation.isPending
          ? "Se trimite pe GitHub..."
          : ahead > 0
            ? `Trimite pe GitHub (${ahead} commit${ahead !== 1 ? "-uri" : ""})`
            : "Sincronizat cu GitHub"}
      </button>

      {selectedUnpushed && (
        <CommitDrawer
          commit={selectedUnpushed}
          local
          onClose={() => setSelectedUnpushed(null)}
        />
      )}
    </section>
  );
}
