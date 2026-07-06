import { RefreshCw, Lock, LogOut, ShieldCheck, GitBranch, Rocket } from "lucide-react";
import { useEffect, useRef } from "react";
import { useIsFetching, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { adminStatusQuery, deployStatusQuery } from "@/lib/queries";
import { adminLogout } from "@/lib/admin.functions";
import { getDeployLog } from "@/lib/agent.functions";
import type { DeployStatus } from "@/lib/deploy.functions";

interface Props {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

export function AppHeader({ title, subtitle, right }: Props) {
  const qc = useQueryClient();
  const isFetching = useIsFetching() > 0;
  const admin = useQuery(adminStatusQuery);
  const deploy = useQuery(deployStatusQuery);
  const logoutFn = useServerFn(adminLogout);
  const getLogFn = useServerFn(getDeployLog);
  const logout = useMutation({
    mutationFn: () => logoutFn(),
    onSuccess: async () => {
      toast.success("Deconectat");
      await qc.invalidateQueries({ queryKey: ["adminStatus"] });
    },
  });

  // Countdown auto-deploy
  const toastIdRef = useRef<string | number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deployingRef = useRef(false);
  const lastRemoteShaRef = useRef<string | null>(null);

  useEffect(() => {
    const data = deploy.data;
    if (!data || data.status === "error" || data.upToDate) {
      // La zi — dacă era un toast activ, îl închidem
      if (toastIdRef.current) {
        toast.dismiss(toastIdRef.current);
        toastIdRef.current = null;
      }
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      deployingRef.current = false;
      lastRemoteShaRef.current = data?.remoteSha ?? null;
      return;
    }

    // Dacă e același commit remote ca înainte, nu relansa toast-ul
    if (data.remoteSha === lastRemoteShaRef.current) return;
    lastRemoteShaRef.current = data.remoteSha ?? null;

    // Dacă deja am pornit un deploy, nu mai facem nimic
    if (deployingRef.current) return;
    if (toastIdRef.current) return;

    let seconds = 10;

    async function triggerDeploy() {
      deployingRef.current = true;
      if (countdownRef.current) clearInterval(countdownRef.current);

      // Lansăm deploy detașat
      const { runAgentCommand } = await import("@/lib/agent.functions");
      runAgentCommand({ data: { cmd: "deploy_app" } }).catch(() => {});

      // Polling log până la final
      const toastId = toast.loading("🚀 Deploy în curs...", {
        description: `Commit: ${data.remoteShortSha} — ${data.remoteMessage}`,
        duration: Infinity,
      });
      toastIdRef.current = toastId;

      const poll = setInterval(async () => {
        try {
          const res = await getLogFn();
          const done = res.lines.includes("[deploy] gata:") || res.lines.includes("[deploy] nimic nou.");
          if (done) {
            clearInterval(poll);
            toast.success("✅ Deploy finalizat!", {
              id: toastId,
              description: `Commit ${data.remoteShortSha} aplicat cu succes.`,
              duration: 6000,
            });
            toastIdRef.current = null;
            deployingRef.current = false;
            qc.invalidateQueries({ queryKey: ["deployStatus"] });
            qc.invalidateQueries({ queryKey: ["recentCommits"] });
          }
        } catch {}
      }, 3000);

      // Oprire forțată după 15 minute
      setTimeout(() => clearInterval(poll), 15 * 60_000);
    }

    function startCountdown() {
      const id = toast.warning(
        `🔄 Commit nou detectat — deploy automat în ${seconds}s`,
        {
          description: `${data.remoteShortSha} — ${data.remoteMessage}`,
          duration: Infinity,
          action: {
            label: "Anulează",
            onClick: () => {
              if (countdownRef.current) clearInterval(countdownRef.current);
              countdownRef.current = null;
              toastIdRef.current = null;
              lastRemoteShaRef.current = data.remoteSha ?? null;
              toast.dismiss(id);
            },
          },
        },
      );
      toastIdRef.current = id;

      countdownRef.current = setInterval(() => {
        seconds -= 1;
        if (seconds <= 0) {
          clearInterval(countdownRef.current!);
          countdownRef.current = null;
          toast.dismiss(id);
          toastIdRef.current = null;
          triggerDeploy();
        } else {
          toast.warning(
            `🔄 Commit nou detectat — deploy automat în ${seconds}s`,
            {
              id,
              description: `${data.remoteShortSha} — ${data.remoteMessage}`,
              duration: Infinity,
              action: {
                label: "Anulează",
                onClick: () => {
                  if (countdownRef.current) clearInterval(countdownRef.current);
                  countdownRef.current = null;
                  toastIdRef.current = null;
                  lastRemoteShaRef.current = data.remoteSha ?? null;
                  toast.dismiss(id);
                },
              },
            },
          );
        }
      }, 1000);
    }

    startCountdown();

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [deploy.data, getLogFn, qc]);

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
            {deploy.data && <DeployBadge data={deploy.data} />}
          </div>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {right}
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

function DeployBadge({ data }: { data: DeployStatus }) {
  if (data.status === "error") {
    return (
      <button
        type="button"
        onClick={() => toast.error("Nu pot verifica versiunea", { description: data.error })}
        title={data.error}
        className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border"
      >
        <GitBranch className="h-3 w-3" /> ?
      </button>
    );
  }

  const upToDate = data.upToDate;
  const fmtDate = (iso?: string) =>
    iso ? new Date(iso).toLocaleString("ro-RO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

  const showDetails = () => {
    if (upToDate) {
      toast.success("Server la zi cu GitHub", {
        description: `${data.localShortSha} · ${data.localMessage} · ${fmtDate(data.localDate)}`,
      });
    } else {
      toast.warning("Actualizare disponibilă pe GitHub", {
        description: `Server: ${data.localShortSha} (${fmtDate(data.localDate)})\nGitHub: ${data.remoteShortSha} — ${data.remoteMessage} (${fmtDate(data.remoteDate)})`,
      });
    }
  };

  return (
    <button
      type="button"
      onClick={showDetails}
      title={upToDate ? "Server la zi cu GitHub" : "Există o actualizare pe GitHub, neaplicată încă pe server"}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${
        upToDate
          ? "bg-emerald-500/15 text-emerald-400 ring-emerald-500/25"
          : "bg-amber-500/15 text-amber-400 ring-amber-500/25"
      }`}
    >
      <GitBranch className="h-3 w-3" />
      {upToDate ? "La zi" : "Update disponibil"}
    </button>
  );
}