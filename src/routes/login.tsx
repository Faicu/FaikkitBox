import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";

import { PageShell } from "@/components/PageShell";
import { adminLogin } from "@/lib/admin.functions";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Autentificare Admin — Monitor Server" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const login = useServerFn(adminLogin);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");

  const m = useMutation({
    mutationFn: () => login({ data: { user, pass } }),
    onSuccess: async (res) => {
      if (!res.ok) {
        toast.error(res.error ?? "Autentificare eșuată");
        return;
      }
      toast.success("Autentificat ca Administrator");
      await qc.invalidateQueries({ queryKey: ["adminStatus"] });
      navigate({ to: "/" });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <PageShell title="Administrator" subtitle="Autentificare pentru funcții extra">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
        className="space-y-3 rounded-2xl border border-border bg-card p-4"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Lock className="h-4 w-4" /> Doar administratorul are acces
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Utilizator</label>
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="username"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Parolă</label>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoComplete="current-password"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <button
          type="submit"
          disabled={m.isPending || !user || !pass}
          className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {m.isPending ? "Se autentifică..." : "Autentificare"}
        </button>
      </form>
    </PageShell>
  );
}
