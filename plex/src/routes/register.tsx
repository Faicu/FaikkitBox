import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { registerUser } from "../lib/users.functions";

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
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold">Client Nou</h1>
        <p className="text-sm text-neutral-400">
          Folosește același username/email cu care ai cont pe Plex.
        </p>
        {error && <p className="rounded bg-red-950 p-2 text-sm text-red-300">{error}</p>}
        <input
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
          placeholder="Username Plex"
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
          required
        />
        <input
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
          placeholder="Email"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />
        <input
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
          placeholder="WhatsApp"
          value={form.whatsapp}
          onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
          required
        />
        <input
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
          placeholder="Parolă"
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
        />
        <button
          disabled={loading}
          className="w-full rounded bg-sky-600 px-4 py-2 font-medium hover:bg-sky-500 disabled:opacity-50"
        >
          {loading ? "Se trimite..." : "Creează cont"}
        </button>
      </form>
    </div>
  );
}
