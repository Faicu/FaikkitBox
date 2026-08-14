import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { UserPlus, Lock, User, Mail, Phone, Eye, EyeOff, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { PageShell } from "@/components/PageShell";
import { registerUser } from "@/lib/registration.functions";

export const Route = createFileRoute("/register")({
  head: () => ({ meta: [{ title: "Înregistrare — Monitor Server" }] }),
  component: RegisterPage,
});

function RegisterPage() {
  const register = useServerFn(registerUser);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [done, setDone] = useState(false);

  const m = useMutation({
    mutationFn: () => register({ data: { username, password: pass, email, phone } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error ?? "Înregistrare eșuată");
        return;
      }
      setDone(true);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (done) {
    return (
      <PageShell title="Înregistrare">
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-500/25">
            <CheckCircle2 className="h-7 w-7 text-emerald-400" />
          </div>
          <h1 className="text-lg font-semibold">Cerere trimisă</h1>
          <p className="text-sm text-muted-foreground">
            Contul tău a fost creat și așteaptă aprobare din partea unui administrator. Vei putea
            să te autentifici după aprobare.
          </p>
          <Link
            to="/login"
            className="mt-1 rounded-xl border border-border bg-muted/40 px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/60"
          >
            Înapoi la Autentificare
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="Înregistrare">
      <div className="flex flex-col items-center pt-6 pb-2">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 ring-1 ring-primary/25">
          <UserPlus className="h-7 w-7 text-primary" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-gradient-primary">Creează un cont</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          Username-ul sau email-ul trebuie să corespundă unui cont din biblioteca Plex
        </p>
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
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Email</label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Telefon <span className="text-muted-foreground/60">(WhatsApp)</span>
          </label>
          <div className="relative">
            <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
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
              autoComplete="new-password"
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
          <p className="text-[11px] text-muted-foreground">Minim 8 caractere.</p>
        </div>

        <button
          type="submit"
          disabled={m.isPending || !username || !email || !phone || pass.length < 8}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {m.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Se trimite...
            </>
          ) : (
            "Înregistrare"
          )}
        </button>

        <p className="text-center text-xs text-muted-foreground">
          Ai deja cont?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Autentifică-te
          </Link>
        </p>
      </form>
    </PageShell>
  );
}
