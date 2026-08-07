import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { loginUser } from "../lib/users.functions";
import { PosterBackground } from "@/components/poster-background";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await loginUser({ data: form });
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
        <h1 className="text-2xl font-bold">Client Existent</h1>
        {error && (
          <p className="rounded-lg border border-red-900/50 bg-red-950/60 p-3 text-sm text-red-300">
            {error}
          </p>
        )}
        <Input
          placeholder="Username"
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
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
          {loading ? "Se autentifică..." : "Autentificare"}
        </Button>
        <p className="text-center text-sm text-neutral-500">
          Nu ai cont încă?{" "}
          <Link to="/register" className="text-sky-400 underline">
            Înregistrează-te
          </Link>
        </p>
      </form>
    </div>
  );
}
