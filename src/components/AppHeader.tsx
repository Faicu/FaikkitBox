import { RefreshCw, Lock, LogOut, ShieldCheck, GitBranch } from "lucide-react";
import { useIsFetching, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { adminStatusQuery, githubSyncQuery } from "@/lib/queries";
import { adminLogout } from "@/lib/admin.functions";

interface Props {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

export function AppHeader({ title, subtitle, right }: Props) {
  const qc = useQueryClient();
  const isFetching = useIsFetching() > 0;
  const admin = useQuery(adminStatusQuery);
  const sync = useQuery(githubSyncQuery);
  const logoutFn = useServerFn(adminLogout);
  const logout = useMutation({
    mutationFn: () => logoutFn(),
    onSuccess: async () => {
      toast.success("Deconectat");
      await qc.invalidateQueries({ queryKey: ["adminStatus"] });
    },
  });

  return (
    <header
      className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold leading-tight text-gradient-primary">{title}</h1>
            {admin.data?.isAdmin && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400 ring-1 ring-emerald-500/25">
                <ShieldCheck className="h-3 w-3" /> Admin
              </span>
            )}
          </div>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {right}
          {sync.data?.status === "ok" && (() => {
            const s = sync.data.data;
            const synced = s.isSynced;
            return (
              <button
                type="button"
                onClick={() => toast(
                  synced ? "GitHub: sincronizat" : `GitHub: ${s.commitsBehind} commit${s.commitsBehind !== 1 ? "s" : ""} în urmă`,
                  {
                    description: `deployed ${s.deployedShortSha} · github ${s.latestShortSha}`,
                    icon: <GitBranch className={`h-4 w-4 ${synced ? "text-emerald-400" : "text-amber-400"}`} />,
                    duration: 4000,
                  }
                )}
                className={`flex h-7 w-7 items-center justify-center rounded-full border ${
                  synced
                    ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                    : "border-amber-500/30 bg-amber-500/15 text-amber-400"
                }`}
                title={synced ? "Sincronizat cu GitHub" : `${s.commitsBehind} commits în urmă`}
              >
                <GitBranch className="h-3.5 w-3.5" />
              </button>
            );
          })()}
          {admin.data?.isAdmin ? (
            <button
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground disabled:opacity-50"
              aria-label="Deconectare admin"
              title="Deconectare admin"
            >
              <LogOut className="h-4 w-4" />
            </button>
          ) : (
            <Link
              to="/login"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
              aria-label="Autentificare admin"
              title="Autentificare admin"
            >
              <Lock className="h-4 w-4" />
            </Link>
          )}
          <button
            onClick={() => qc.invalidateQueries()}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
            aria-label="Reîmprospătează"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>
    </header>
  );
}
