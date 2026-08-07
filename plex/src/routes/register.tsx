import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { registerUser } from "../lib/users.functions";
import { PosterBackground } from "@/components/poster-background";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/register")({
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", password: "", email: "", whatsapp: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await registerUser({ data: form });
      navigate({ to: "/app" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-12">
      <PosterBackground />
      <form
        onSubmit={onSubmit}
        className="glass-card w-full max-w-sm space-y-4 rounded-2xl p-8 shadow-2xl"
      >
        <div>
          <h1 className="text-2xl font-bold">Client Nou</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Folosește același username/email cu care ai cont pe Plex.
          </p>
        </div>
        {error && (
          <p className="rounded-lg border border-red-900/50 bg-red-950/60 p-3 text-sm text-red-300">
            {error}
          </p>
        )}
        <Input
          placeholder="Username Plex"
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
          required
        />
        <Input
          placeholder="Email"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />
        <Input
          placeholder="WhatsApp"
          value={form.whatsapp}
          onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
          required
        />
        <Input
          placeholder="Parolă"
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
        />
        <Button
          disabled={loading}
          className="w-full bg-gradient-to-r from-sky-500 to-indigo-500 hover:opacity-90"
        >
          {loading ? "Se trimite..." : "Creează cont"}
        </Button>
        <p className="text-center text-sm text-neutral-500">
          Ai deja cont?{" "}
          <Link to="/login" className="text-sky-400 underline">
            Autentifică-te
          </Link>
        </p>
      </form>
    </div>
  );
}
