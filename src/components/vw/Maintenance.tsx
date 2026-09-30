import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Wrench } from "lucide-react";
import { toast } from "sonner";

import {
  deleteVwReminder,
  markVwReminderDone,
  saveVwReminder,
  type VwReminder,
  type VwReminderInput,
} from "@/lib/vw/vw-car.functions";

// Mentenanța Golf-ului după kilometraj și/sau dată. Aplicația de pe navigație o citește
// prin /api/vw-status și o anunță în salutul vorbit.
const PRESETS: VwReminderInput[] = [
  {
    title: "Schimb ulei și filtre",
    everyKm: 15000,
    everyMonths: 12,
    lastKm: null,
    lastDate: null,
    dueDate: null,
  },
  { title: "ITP", everyKm: null, everyMonths: 24, lastKm: null, lastDate: null, dueDate: null },
  { title: "RCA", everyKm: null, everyMonths: 12, lastKm: null, lastDate: null, dueDate: null },
  {
    title: "Rovinietă",
    everyKm: null,
    everyMonths: 12,
    lastKm: null,
    lastDate: null,
    dueDate: null,
  },
  {
    title: "Kit distribuție",
    everyKm: 90000,
    everyMonths: null,
    lastKm: null,
    lastDate: null,
    dueDate: null,
  },
];

const EMPTY: VwReminderInput = {
  title: "",
  everyKm: null,
  everyMonths: null,
  lastKm: null,
  lastDate: null,
  dueDate: null,
};

function describe(r: VwReminder): string {
  const parts: string[] = [];
  if (r.kmLeft !== null) {
    parts.push(
      r.kmLeft <= 0
        ? `depășit cu ${(-r.kmLeft).toLocaleString("ro-RO")} km`
        : `peste ${r.kmLeft.toLocaleString("ro-RO")} km`,
    );
  }
  if (r.daysLeft !== null && r.nextDate) {
    const date = new Date(`${r.nextDate}T00:00:00`).toLocaleDateString("ro-RO", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    parts.push(r.daysLeft <= 0 ? `expirat pe ${date}` : `pe ${date} (${r.daysLeft} zile)`);
  }
  return parts.length ? parts.join(" · ") : "completează ultimul km sau data";
}

export function Maintenance({
  reminders,
  odometer,
}: {
  reminders: VwReminder[];
  odometer: number | null;
}) {
  const [form, setForm] = useState<VwReminderInput | null>(null);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["vwCar"] });
  const saveFn = useServerFn(saveVwReminder);
  const deleteFn = useServerFn(deleteVwReminder);
  const doneFn = useServerFn(markVwReminderDone);
  const save = useMutation({
    mutationFn: (data: VwReminderInput) => saveFn({ data }),
    onSuccess: () => {
      setForm(null);
      refresh();
      toast.success("Salvat");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteFn({ data: { id } }),
    onSuccess: refresh,
  });
  const done = useMutation({
    mutationFn: (id: number) => doneFn({ data: { id } }),
    onSuccess: () => {
      refresh();
      toast.success("Marcat ca făcut azi");
    },
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between rounded-2xl glass-card p-4">
        <div className="flex items-center gap-2.5">
          <Wrench className="h-5 w-5 text-sky-400" />
          <div>
            <p className="font-semibold">Mentenanță</p>
            <p className="text-xs text-muted-foreground">
              Kilometraj:{" "}
              {odometer !== null ? `${odometer.toLocaleString("ro-RO")} km` : "necunoscut încă"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setForm(form ? null : { ...EMPTY, lastKm: odometer })}
          className="rounded-lg px-3 py-1.5 text-sm text-sky-400 hover:bg-sky-500/10"
        >
          {form ? "Renunță" : "+ Adaugă"}
        </button>
      </div>

      {form && (
        <div className="space-y-3 rounded-2xl glass-card p-4 text-sm">
          {!form.id && (
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.title}
                  type="button"
                  onClick={() => setForm({ ...p, lastKm: p.everyKm ? odometer : null })}
                  className="rounded-full bg-muted px-3 py-1 text-xs hover:text-foreground"
                >
                  {p.title}
                </button>
              ))}
            </div>
          )}
          <Field label="Ce" value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
          <div className="grid grid-cols-2 gap-2">
            <Field
              label="La fiecare (km)"
              type="number"
              value={form.everyKm ?? ""}
              onChange={(v) => setForm({ ...form, everyKm: v ? Number(v) : null })}
            />
            <Field
              label="La fiecare (luni)"
              type="number"
              value={form.everyMonths ?? ""}
              onChange={(v) => setForm({ ...form, everyMonths: v ? Number(v) : null })}
            />
            <Field
              label="Ultima dată făcut la (km)"
              type="number"
              value={form.lastKm ?? ""}
              onChange={(v) => setForm({ ...form, lastKm: v ? Number(v) : null })}
            />
            <Field
              label="Ultima dată făcut pe"
              type="date"
              value={form.lastDate ?? ""}
              onChange={(v) => setForm({ ...form, lastDate: v || null })}
            />
            <Field
              label="Sau expiră pe (ITP, RCA...)"
              type="date"
              value={form.dueDate ?? ""}
              onChange={(v) => setForm({ ...form, dueDate: v || null })}
            />
          </div>
          <button
            type="button"
            disabled={save.isPending || !form.title.trim()}
            onClick={() => save.mutate(form)}
            className="w-full rounded-lg bg-sky-500 px-3 py-2 font-semibold text-slate-950 disabled:opacity-40"
          >
            Salvează
          </button>
        </div>
      )}

      {reminders.length === 0 && !form && (
        <p className="rounded-2xl glass-card p-4 text-sm text-muted-foreground">
          Nicio notificare de mentenanță. Adaugă schimbul de ulei, ITP-ul, RCA-ul...
        </p>
      )}

      {reminders.map((r) => (
        <div key={r.id} className="rounded-2xl glass-card p-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{r.title}</span>
            <span
              className={`text-xs ${r.overdue ? "text-red-400" : r.soon ? "text-amber-400" : "text-muted-foreground"}`}
            >
              {r.overdue ? "depășit" : r.soon ? "în curând" : "ok"}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{describe(r)}</p>
          <div className="mt-2 flex gap-1 text-xs">
            <button
              type="button"
              onClick={() => done.mutate(r.id)}
              className="rounded-lg px-2 py-1 text-emerald-400 hover:bg-emerald-500/10"
            >
              Făcut azi
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...r })}
              className="rounded-lg px-2 py-1 text-sky-400 hover:bg-sky-500/10"
            >
              Editează
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm(`Ștergi „${r.title}”?`)) remove.mutate(r.id);
              }}
              className="rounded-lg px-2 py-1 text-red-400 hover:bg-red-500/10"
            >
              Șterge
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border/40 bg-background/40 px-3 py-2"
      />
    </label>
  );
}
