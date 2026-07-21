import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { GitCommitHorizontal, ExternalLink, Plus, Minus } from "lucide-react";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import type { GitHubCommit } from "@/lib/github.functions";
import { getCommitDetail } from "@/lib/github.functions";

export function CommitDrawer({ commit, onClose }: { commit: GitHubCommit; onClose: () => void }) {
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
          <div className="text-xs text-muted-foreground">
            {commit.author} · {commit.date ? fmtDate(commit.date) : ""}
          </div>

          {body.length > 0 && (
            <div className="rounded-xl bg-muted/40 border border-border px-3 py-2.5 text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {body.join("\n")}
            </div>
          )}

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
