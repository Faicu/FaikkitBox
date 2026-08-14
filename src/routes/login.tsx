import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Lock, ShieldCheck, User, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { PageShell } from "@/components/PageShell";
import { adminLogin } from "@/lib/admin.functions";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Autentificare — Monitor Server" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const login = useServerFn(adminLogin);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);

  const m = useMutation({
    mutationFn: () => login({ data: { user, pass } }),
    onSuccess: async (res) => {
      if (!res.ok) {
        toast.error(res.error ?? "Autentificare eșuată");
        return;
      }
      toast.success("Autentificat cu succes");
      await qc.invalidateQueries({ queryKey: ["adminStatus"] });
      navigate({ to: "/" });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <PageShell title="Autentificare">
      <div className="flex flex-col items-center pt-6 pb-2">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 ring-1 ring-primary/25">
          <ShieldCheck className="h-7 w-7 text-primary" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-gradient-primary">Bine ai revenit</h1>
        <p className="mt-1 text-sm text-muted-foreground">Autentifică-te ca să continui</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
        className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm"
      >
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Utilizator</label>
          <div className="relative">
            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              autoComplete="username"
              autoFocus
              className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Parolă</label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type={showPass ? "text" : "password"}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoComplete="current-password"
              className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-9 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              tabIndex={-1}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showPass ? "Ascunde parola" : "Arată parola"}
            >
              {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={m.isPending || !user || !pass}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {m.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Se autentifică...
            </>
          ) : (
            "Autentificare"
          )}
        </button>

        <p className="text-center text-xs text-muted-foreground">
          Nu ai cont?{" "}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Înregistrează-te
          </Link>
        </p>
      </form>
    </PageShell>
  );
}
