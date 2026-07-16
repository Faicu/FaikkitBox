import { Lock, ShieldCheck, GitBranch } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { adminStatusQuery, githubSyncQuery } from "@/lib/queries";
import { adminLogout } from "@/lib/admin.functions";
import { onUpdateDetected } from "@/lib/update-signal";

interface Props {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

export function AppHeader({ title, subtitle, right }: Props) {
  const qc = useQueryClient();
  const admin = useQuery(adminStatusQuery);
  const sync = useQuery(githubSyncQuery);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => onUpdateDetected(() => setUpdateAvailable(true)), []);

  const logoutFn = useServerFn(adminLogout);
  const logout = useMutation({
    mutationFn: () => logoutFn(),
    onSuccess: async () => {
      toast.success("Deconectat");
      await qc.invalidateQueries({ queryKey: ["adminStatus"] });
    },
  });

  function startLongPress() {
    longPressTimer.current = setTimeout(() => {
      logout.mutate();
    }, 600);
  }

  function cancelLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }

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
              <span
                className="inline-flex cursor-pointer select-none items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400 ring-1 ring-emerald-500/25 active:bg-emerald-500/30"
                title="Ține apăsat pentru deconectare"
                onMouseDown={startLongPress}
                onMouseUp={cancelLongPress}
                onMouseLeave={cancelLongPress}
                onTouchStart={startLongPress}
                onTouchEnd={cancelLongPress}
              >
                <ShieldCheck className="h-3 w-3" /> Admin
              </span>
            )}
          </div>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {right}
          {sync.data?.status === "ok" &&
            (() => {
              const s = sync.data.data;
              const orange = updateAvailable || !s.isSynced;
              return (
                <button
                  type="button"
                  onClick={() =>
                    toast(
                      updateAvailable
                        ? "Actualizare detectată — reîncărcare în curs..."
                        : s.isSynced
                          ? "GitHub: sincronizat"
                          : `GitHub: ${s.commitsBehind} commit${s.commitsBehind !== 1 ? "s" : ""} în urmă`,
                      {
                        description: `deployed ${s.deployedShortSha} · github ${s.latestShortSha}`,
                        icon: (
                          <GitBranch
                            className={`h-4 w-4 ${orange ? "text-amber-400" : "text-emerald-400"}`}
                          />
                        ),
                        duration: 4000,
                      },
                    )
                  }
                  className={`flex h-7 w-7 items-center justify-center rounded-full border transition-colors ${
                    orange
                      ? "border-amber-500/30 bg-amber-500/15 text-amber-400"
                      : "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                  }`}
                  title={
                    updateAvailable
                      ? "Actualizare disponibilă"
                      : s.isSynced
                        ? "Sincronizat cu GitHub"
                        : `${s.commitsBehind} commits în urmă`
                  }
                >
                  <GitBranch className="h-3.5 w-3.5" />
                </button>
              );
            })()}
          {!admin.data?.isAdmin && (
            <Link
              to="/login"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
              aria-label="Autentificare admin"
              title="Autentificare admin"
            >
              <Lock className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
