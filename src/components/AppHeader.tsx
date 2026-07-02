import { RefreshCw, Lock, LogOut, ShieldCheck } from "lucide-react";
import { useIsFetching, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { adminStatusQuery } from "@/lib/queries";
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
            <h1 className="text-lg font-semibold leading-tight">{title}</h1>
            {admin.data?.isAdmin && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                <ShieldCheck className="h-3 w-3" /> Admin
              </span>
            )}
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