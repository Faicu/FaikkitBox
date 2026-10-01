import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fuel } from "lucide-react";
import { toast } from "sonner";

import {
  deleteVwRefuel,
  saveVwRefuel,
  type VwFuelSummary,
  type VwRefuelInput,
} from "@/lib/vw/vw-fuel.functions";

// Jurnalul de alimentări: consumul real între două plinuri și calibrarea estimării
// de combustibil pe călătorie (lib/vw/vw-fuel-model.ts).

interface Form {
  id?: number;
  at: string; // datetime-local
  liters: string;
  price: string;
  odo: string;
  full: boolean;
  note: string;
}

function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function toLocal(iso: string): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function fmt(n: number, digits = 1): string {
  return n.toLocaleString("ro-RO", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function FuelLog({ fuel }: { fuel: VwFuelSummary }) {
  const [form, setForm] = useState<Form | null>(null);
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["vwFuel"] });
    qc.invalidateQueries({ queryKey: ["vwTrips"] });
  };
  const saveFn = useServerFn(saveVwRefuel);
  const deleteFn = useServerFn(deleteVwRefuel);
  const save = useMutation({
    mutationFn: (data: VwRefuelInput) => saveFn({ data }),
    onSuccess: () => {
      setForm(null);
      refresh();
      toast.success("Alimentare salvată");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteFn({ data: { id } }),
    onSuccess: refresh,
  });

  const liters = form ? Number(form.liters.replace(",", ".")) : NaN;
  const price = form ? Number(form.price.replace(",", ".")) : NaN;
  const total = Number.isFinite(liters) && Number.isFinite(price) ? liters * price : null;

  function submit() {
    if (!form) return;
    save.mutate({
      id: form.id,
      at: new Date(form.at).toISOString(),
      liters,
      price: form.price.trim() ? price : null,
      odo: form.odo.trim() ? Number(form.odo) : null,
      full: form.full,
      note: form.note.trim() || null,
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between rounded-2xl glass-card p-4">
        <div className="flex items-center gap-2.5">
          <Fuel className="h-5 w-5 text-sky-400" />
          <div>
            <p className="font-semibold">Alimentări</p>
            <p className="text-xs text-muted-foreground">
              {fuel.avgLPer100 !== null
                ? `Consum real ${fmt(fuel.avgLPer100)} L/100 km`
                : "Consumul real apare după două plinuri"}
              {" · "}
              {fuel.calibrated
                ? `estimare calibrată (×${fmt(fuel.factor, 2)})`
                : "estimare necalibrată"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            setForm(
              form
                ? null
                : {
                    at: localNow(),
                    liters: "",
                    price: fuel.lastPrice !== null ? String(fuel.lastPrice) : "",
                    odo: "",
                    full: true,
                    note: "",
                  },
            )
          }
          className="rounded-lg px-3 py-1.5 text-sm text-sky-400 hover:bg-sky-500/10"
        >
          {form ? "Renunță" : "+ Adaugă"}
        </button>
      </div>

      {form && (
        <div className="space-y-3 rounded-2xl glass-card p-4 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <Field
              label="Data și ora"
              type="datetime-local"
              value={form.at}
              onChange={(v) => setForm({ ...form, at: v })}
            />
            <Field
              label="Litri"
              type="number"
              value={form.liters}
              onChange={(v) => setForm({ ...form, liters: v })}
            />
            <Field
              label="Preț (lei/L)"
              type="number"
              value={form.price}
              onChange={(v) => setForm({ ...form, price: v })}
            />
            <Field
              label="Kilometraj (gol = automat)"
              type="number"
              value={form.odo}
              onChange={(v) => setForm({ ...form, odo: v })}
            />
          </div>
          <Field
            label="Notă (benzinărie...)"
            value={form.note}
            onChange={(v) => setForm({ ...form, note: v })}
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.full}
              onChange={(e) => setForm({ ...form, full: e.target.checked })}
            />
            <span>Plin (până la oprirea pistolului)</span>
          </label>
          <p className="text-xs text-muted-foreground">
            {total !== null ? `Total ${fmt(total, 2)} lei. ` : ""}
            Doar plinurile dau consumul real; alimentările parțiale dintre ele se adună la următorul
            plin.
          </p>
          <button
            type="button"
            disabled={save.isPending || !(liters > 0) || !form.at}
            onClick={submit}
            className="w-full rounded-lg bg-sky-500 px-3 py-2 font-semibold text-slate-950 disabled:opacity-40"
          >
            Salvează
          </button>
        </div>
      )}

      {fuel.refuels.length === 0 && !form && (
        <p className="rounded-2xl glass-card p-4 text-sm text-muted-foreground">
          Nicio alimentare. Adaugă fiecare plin: din ele ies consumul real și costul fiecărui drum.
          Până atunci, litrii pe călătorie sunt doar estimați.
        </p>
      )}

      {fuel.refuels.map((r) => (
        <div key={r.id} className="rounded-2xl glass-card p-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold">
              {new Date(r.at).toLocaleDateString("ro-RO", { day: "2-digit", month: "short" })} ·{" "}
              {fmt(r.liters, 2)} L{r.full ? " · plin" : ""}
            </span>
            <span className="text-sm text-sky-400">
              {r.price !== null ? `${fmt(r.liters * r.price, 2)} lei` : ""}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[
              r.price !== null ? `${fmt(r.price, 2)} lei/L` : null,
              r.odo !== null ? `${r.odo.toLocaleString("ro-RO")} km` : null,
              r.lPer100 !== null ? `${fmt(r.lPer100)} L/100 km de la plinul anterior` : null,
              r.note,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="mt-2 flex gap-1 text-xs">
            <button
              type="button"
              onClick={() =>
                setForm({
                  id: r.id,
                  at: toLocal(r.at),
                  liters: String(r.liters),
                  price: r.price !== null ? String(r.price) : "",
                  odo: r.odo !== null ? String(r.odo) : "",
                  full: r.full,
                  note: r.note ?? "",
                })
              }
              className="rounded-lg px-2 py-1 text-sky-400 hover:bg-sky-500/10"
            >
              Editează
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm("Ștergi alimentarea?")) remove.mutate(r.id);
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
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type={type}
        step={type === "number" ? "any" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border/40 bg-background/40 px-3 py-2"
      />
    </label>
  );
}
