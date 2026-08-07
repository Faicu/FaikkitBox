import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCurrentUser } from "../lib/users.functions";
import {
  listPendingUsers,
  listAllUsers,
  approveUser,
  rejectUser,
  setUserBlocked,
  resetUserPassword,
} from "../lib/users.functions";
import {
  listPendingAlerts,
  resolveAlert,
  getAllMediaContent,
  deleteMediaAdmin,
  getActivityLog,
  getSettings,
  updateSettings,
  syncLibraryNow,
} from "../lib/media.functions";
import { getErrorLogs, clearErrorLogs } from "../lib/error-log";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

type Section = "media" | "users" | "activity" | "alerts" | "errors" | "settings";

function AdminPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [section, setSection] = useState<Section>("alerts");

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (!u || (u as { role: string }).role !== "admin") navigate({ to: "/app" });
      else setReady(true);
    });
  }, [navigate]);

  if (!ready) return <div className="p-8">Se încarcă...</div>;

  const tabs: Array<{ id: Section; label: string }> = [
    { id: "media", label: "Conținut media" },
    { id: "users", label: "Utilizatori" },
    { id: "activity", label: "Activitate" },
    { id: "alerts", label: "Alerte" },
    { id: "errors", label: "Erori aplicație" },
    { id: "settings", label: "Setări" },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Panou Admin</h1>
        <Link to="/app" className="text-sm text-sky-400 underline">
          Înapoi la aplicație
        </Link>
      </header>
      <nav className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Button
            key={t.id}
            size="sm"
            variant={section === t.id ? "default" : "outline"}
            onClick={() => setSection(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </nav>
      <div>
        {section === "users" && <UsersSection />}
        {section === "alerts" && <AlertsSection />}
        {section === "errors" && <ErrorsSection />}
        {section === "media" && <MediaSection />}
        {section === "activity" && <ActivitySection />}
        {section === "settings" && <SettingsSection />}
      </div>
    </div>
  );
}

interface PendingUser {
  id: number;
  username: string;
  email: string;
  whatsapp: string;
}
interface AllUser {
  id: number;
  username: string;
  role: string;
  status: string;
  blocked: number;
}

function UsersSection() {
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [all, setAll] = useState<AllUser[]>([]);

  async function load() {
    setPending((await listPendingUsers()) as PendingUser[]);
    setAll((await listAllUsers()) as AllUser[]);
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Conturi noi în așteptare</CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 && <p className="text-sm text-muted-foreground">Niciunul.</p>}
          <ul className="space-y-2">
            {pending.map((u) => (
              <li key={u.id} className="flex items-center justify-between rounded-lg bg-muted/40 p-2">
                <span>
                  {u.username} — {u.email} — {u.whatsapp}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => approveUser({ data: { userId: u.id } }).then(load)}>
                    Aprobare Cont
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => rejectUser({ data: { userId: u.id } }).then(load)}
                  >
                    Ștergere Cont
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Toți utilizatorii</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {all.map((u) => (
              <li key={u.id} className="flex items-center justify-between rounded-lg bg-muted/40 p-2">
                <span>
                  {u.username} — {u.role} — {u.status} {u.blocked ? "(blocat)" : ""}
                </span>
                {u.role !== "admin" && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setUserBlocked({ data: { userId: u.id, blocked: !u.blocked } }).then(load)
                      }
                    >
                      {u.blocked ? "Deblochează" : "Blochează"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const pass = prompt("Parolă nouă:");
                        if (pass) resetUserPassword({ data: { userId: u.id, newPassword: pass } });
                      }}
                    >
                      Resetează parola
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

interface Alert {
  id: number;
  reason: string;
  title: string;
  options_json: string;
}

function AlertsSection() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  async function load() {
    setAlerts((await listPendingAlerts()) as Alert[]);
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alerte descărcare</CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 && <p className="text-sm text-muted-foreground">Nicio alertă activă.</p>}
        <ul className="space-y-2">
          {alerts.map((a) => {
            const options = JSON.parse(a.options_json) as {
              candidates?: Array<{ id: number; name: string; seeders: number }>;
            };
            return (
              <li key={a.id} className="rounded-lg bg-muted/40 p-3">
                <p className="mb-2">
                  <strong>{a.title}</strong> — {a.reason}
                </p>
                <ul className="mb-2 space-y-1 text-xs text-muted-foreground">
                  {(options.candidates ?? []).slice(0, 5).map((c) => (
                    <li key={c.id} className="flex items-center gap-2">
                      {c.name} — {c.seeders} seederi
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-6 px-2 py-0"
                        onClick={() =>
                          resolveAlert({ data: { alertId: a.id, torrentId: c.id } }).then(load)
                        }
                      >
                        Alege
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => resolveAlert({ data: { alertId: a.id, cancel: true } }).then(load)}
                >
                  Anulează
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

interface ErrorRow {
  id: string;
  timestamp: string;
  source: string;
  level: string;
  message: string;
  count: number;
}

function ErrorsSection() {
  const [errors, setErrors] = useState<ErrorRow[]>([]);
  async function load() {
    setErrors((await getErrorLogs()) as ErrorRow[]);
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Erori aplicație</CardTitle>
        <Button size="sm" variant="outline" onClick={() => clearErrorLogs().then(load)}>
          Curăță
        </Button>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-sm">
          {errors.map((e) => (
            <li key={e.id} className="rounded-lg bg-muted/40 p-2">
              <span className="text-muted-foreground">
                [{e.level}] {e.source} × {e.count}
              </span>{" "}
              {e.message}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

interface MediaContentRow {
  id: number;
  username: string;
  title: string;
  media_type: string;
  season: number | null;
  is_owner: number;
  qualities: Array<{ id: number; quality: string; subtitle_source: string | null; torrent_name: string | null }>;
}

function MediaSection() {
  const [items, setItems] = useState<MediaContentRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setItems((await getAllMediaContent()) as MediaContentRow[]);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function remove(id: number, quality?: string) {
    if (!confirm("Sigur ștergi acest conținut (Plex + qBit + fișiere disk)?")) return;
    await deleteMediaAdmin({ data: { ownershipId: id, quality } });
    load();
  }

  if (loading) return <p className="text-sm text-muted-foreground">Se încarcă...</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conținut media (toți userii)</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 && <p className="text-sm text-muted-foreground">Niciun conținut.</p>}
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.id} className="rounded-lg bg-muted/40 p-3">
              <div className="flex items-center justify-between">
                <span>
                  <strong>{it.title}</strong> {it.season ? `S${it.season}` : ""}{" "}
                  <span className="text-xs text-muted-foreground">
                    owner: {it.username} {it.is_owner ? "" : "(doar în listă)"}
                  </span>
                </span>
                {!!it.is_owner && (
                  <Button size="sm" variant="destructive" onClick={() => remove(it.id)}>
                    Șterge tot
                  </Button>
                )}
              </div>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {it.qualities.map((q) => (
                  <li key={q.id} className="flex items-center justify-between">
                    <span>
                      {q.quality} — sub: {q.subtitle_source ?? "?"} — {q.torrent_name ?? "necunoscut"}
                    </span>
                    {!!it.is_owner && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-6 px-2 py-0"
                        onClick={() => remove(it.id, q.quality)}
                      >
                        Șterge calitate
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

interface ActivityRow {
  id: number;
  action: string;
  title: string | null;
  username: string | null;
  detail: string | null;
  created_at: string;
}

function ActivitySection() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const pageSize = 30;

  async function load(p: number) {
    const r = (await getActivityLog({ data: { page: p, pageSize } })) as unknown as {
      rows: ActivityRow[];
      total: number;
    };
    setRows(r.rows);
    setTotal(r.total);
    setPage(p);
  }
  useEffect(() => {
    load(0);
  }, []);

  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activitate</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg bg-muted/40 p-2">
              <span className="text-muted-foreground">{r.created_at}</span> — {r.username ?? "sistem"} —{" "}
              <strong>{r.action}</strong> {r.title ? `„${r.title}”` : ""} {r.detail ?? ""}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <Button size="sm" variant="secondary" disabled={page <= 0} onClick={() => load(page - 1)}>
            ← Anterior
          </Button>
          <span>
            Pagina {page + 1} / {maxPage + 1}
          </span>
          <Button size="sm" variant="secondary" disabled={page >= maxPage} onClick={() => load(page + 1)}>
            Următor →
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface AlertSettings {
  min_seeders: number;
  ambiguous_seeders_pct: number;
  max_titles_per_user: number;
  default_quality: string;
  default_season_mode: string;
  library_sync_interval_min: number;
  push_enabled: number;
  require_approval: number;
}

function SettingsSection() {
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  async function load() {
    setSettings((await getSettings()) as AlertSettings);
  }
  useEffect(() => {
    load();
  }, []);

  function set<K extends keyof AlertSettings>(key: K, value: AlertSettings[K]) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      await updateSettings({ data: settings });
    } finally {
      setSaving(false);
    }
  }

  async function syncNow() {
    setSyncMsg("Se sincronizează...");
    const r = (await syncLibraryNow()) as { scanned: number; inserted: number };
    setSyncMsg(`${r.scanned} titluri scanate, ${r.inserted} adăugate.`);
  }

  if (!settings) return <p className="text-sm text-muted-foreground">Se încarcă...</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Setări</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <fieldset className="space-y-2 rounded-md border p-3">
          <legend className="px-1 text-muted-foreground">Alerte automate</legend>
          <label className="flex items-center justify-between gap-2">
            Prag minim seederi
            <Input
              type="number"
              className="w-24"
              value={settings.min_seeders}
              onChange={(e) => set("min_seeders", Number(e.target.value))}
            />
          </label>
          <label className="flex items-center justify-between gap-2">
            Procent ambiguitate seederi
            <Input
              type="number"
              step="0.05"
              className="w-24"
              value={settings.ambiguous_seeders_pct}
              onChange={(e) => set("ambiguous_seeders_pct", Number(e.target.value))}
            />
          </label>
        </fieldset>

        <fieldset className="space-y-2 rounded-md border p-3">
          <legend className="px-1 text-muted-foreground">Limite</legend>
          <label className="flex items-center justify-between gap-2">
            Titluri active maxime / user
            <Input
              type="number"
              className="w-24"
              value={settings.max_titles_per_user}
              onChange={(e) => set("max_titles_per_user", Number(e.target.value))}
            />
          </label>
        </fieldset>

        <fieldset className="space-y-2 rounded-md border p-3">
          <legend className="px-1 text-muted-foreground">Descărcări</legend>
          <label className="flex items-center justify-between gap-2">
            Calitate implicită
            <Input
              className="w-32"
              value={settings.default_quality}
              onChange={(e) => set("default_quality", e.target.value)}
            />
          </label>
          <label className="flex items-center justify-between gap-2">
            Mod implicit seriale
            <select
              className="rounded-md border border-input bg-transparent px-2 py-1"
              value={settings.default_season_mode}
              onChange={(e) => set("default_season_mode", e.target.value)}
            >
              <option value="season">Un sezon</option>
              <option value="all">Tot serialul</option>
            </select>
          </label>
        </fieldset>

        <fieldset className="space-y-2 rounded-md border p-3">
          <legend className="px-1 text-muted-foreground">Bibliotecă</legend>
          <label className="flex items-center justify-between gap-2">
            Interval sincronizare (minute)
            <Input
              type="number"
              className="w-24"
              value={settings.library_sync_interval_min}
              onChange={(e) => set("library_sync_interval_min", Number(e.target.value))}
            />
          </label>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={syncNow}>
              Sincronizează acum
            </Button>
            {syncMsg && <span className="text-muted-foreground">{syncMsg}</span>}
          </div>
        </fieldset>

        <fieldset className="space-y-2 rounded-md border p-3">
          <legend className="px-1 text-muted-foreground">Notificări</legend>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!settings.push_enabled}
              onChange={(e) => set("push_enabled", e.target.checked ? 1 : 0)}
            />
            Push activ global pentru clienți
          </label>
        </fieldset>

        <fieldset className="space-y-2 rounded-md border p-3">
          <legend className="px-1 text-muted-foreground">Conturi</legend>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!settings.require_approval}
              onChange={(e) => set("require_approval", e.target.checked ? 1 : 0)}
            />
            Aprobare manuală obligatorie
          </label>
        </fieldset>

        <Button onClick={save} disabled={saving}>
          {saving ? "Se salvează..." : "Salvează setările"}
        </Button>
      </CardContent>
    </Card>
  );
}
