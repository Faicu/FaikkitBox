import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { PageShell } from "@/components/PageShell";
import { TehnicSubNav } from "@/components/tehnic/TehnicSubNav";
import { ContributionProgressBar } from "@/components/principala/SupportWidget";
import { formatDateTime } from "@/components/tehnic/utils";
import { pluralRo } from "@/lib/format";
import { requireAdminBeforeLoad } from "@/lib/auth/admin-route-guard";
import { contributionsOverviewQuery } from "@/lib/queries";
import {
  addManualContribution,
  confirmContribution,
  deleteContribution,
  rejectContribution,
  setContributionExempt,
  setContributionTarget,
  type AdminPayment,
  type ContributionsOverview,
  type ContributorRow,
} from "@/lib/contributions/contributions.functions";
import {
  MAX_MONTHS,
  METHOD_LABELS,
  MIN_PER_MONTH,
  RECOMMENDED_PER_MONTH,
  addMonths,
  monthLabel,
  monthsRangeLabel,
  type PaymentMethod,
} from "@/lib/contributions/months";

export const Route = createFileRoute("/contributii")({
  beforeLoad: requireAdminBeforeLoad,
  head: () => ({ meta: [{ title: "Contribuții — Monitor Server" }] }),
  component: ContributiiPage,
});

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["contributions"] });
}

function ContributiiPage() {
  // null = luna curentă (calculată pe server, în ora României).
  const [month, setMonth] = useState<string | null>(null);
  const { data, isLoading } = useQuery(contributionsOverviewQuery(month));

  return (
    <PageShell title="Contribuții" subtitle="Contribuția lunară a utilizatorilor">
      <TehnicSubNav />

      {isLoading || !data ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 skeleton-sweep rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <MonthSection data={data} onMonth={setMonth} />
          <PendingSection pending={data.pending} />
          <ContributorsSection data={data} />
          <AddPaymentSection data={data} />
          <HistorySection history={data.history} />
        </>
      )}
    </PageShell>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
      {icon} {children}
    </h2>
  );
}

function MonthSection({
  data,
  onMonth,
}: {
  data: ContributionsOverview;
  onMonth: (m: string) => void;
}) {
  const invalidate = useInvalidate();
  const targetFn = useServerFn(setContributionTarget);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(data.currentTarget));

  const targetMutation = useMutation({
    mutationFn: (target: number) => targetFn({ data: { target } }),
    onSuccess: () => {
      toast.success("Ținta a fost actualizată");
      setEditing(false);
      invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const isCurrent = data.month === data.currentMonth;
  const paidCount = data.contributors.filter((c) => c.status === "confirmed").length;
  const expected = data.contributors.filter((c) => !c.exempt).length;

  return (
    <section className="glass-card rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onMonth(addMonths(data.month, -1))}
          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground"
          aria-label="Luna anterioară"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <div className="text-sm font-semibold capitalize">{monthLabel(data.month)}</div>
          {!isCurrent && (
            <button
              type="button"
              onClick={() => onMonth(data.currentMonth)}
              className="text-[11px] text-primary"
            >
              Înapoi la luna curentă
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => onMonth(addMonths(data.month, 1))}
          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground"
          aria-label="Luna următoare"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <ContributionProgressBar progress={data.progress} />

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Au plătit {paidCount} din {expected}
        </span>
        {editing ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              targetMutation.mutate(Number(value));
            }}
          >
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-20 rounded-md border border-border/60 bg-background px-2 py-1 text-xs"
              autoFocus
            />
            <span>lei</span>
            <button
              type="submit"
              disabled={targetMutation.isPending}
              className="rounded-md bg-primary p-1 text-primary-foreground disabled:opacity-40"
              title="Salvează"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md bg-muted/60 p-1"
              title="Renunță"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setValue(String(data.currentTarget));
              setEditing(true);
            }}
            className="inline-flex items-center gap-1 hover:text-foreground"
            title="Ținta se aplică de la luna curentă înainte"
          >
            Ținta: {data.currentTarget} lei <Pencil className="h-3 w-3" />
          </button>
        )}
      </div>
    </section>
  );
}

function PaymentLine({ p }: { p: AdminPayment }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-sm font-medium">
        {p.username} · {p.total} lei
      </div>
      <div className="text-[11px] text-muted-foreground">
        {p.months.length > 0 ? monthsRangeLabel(p.months) : pluralRo(p.monthsCount, "lună", "luni")}
        {p.monthsCount > 1 ? ` · ${p.perMonth} lei/lună` : ""} · {METHOD_LABELS[p.method]}
      </div>
      <div className="text-[11px] text-muted-foreground">
        {formatDateTime(p.declaredAt)}
        {p.note ? ` · ${p.note}` : ""}
      </div>
    </div>
  );
}

function PendingSection({ pending }: { pending: AdminPayment[] }) {
  const invalidate = useInvalidate();
  const confirmFn = useServerFn(confirmContribution);
  const rejectFn = useServerFn(rejectContribution);

  const confirmMutation = useMutation({
    mutationFn: (id: number) => confirmFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Plată confirmată");
      invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const rejectMutation = useMutation({
    mutationFn: (id: number) => rejectFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Plată respinsă");
      invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (pending.length === 0) return null;
  const busy = confirmMutation.isPending || rejectMutation.isPending;

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-amber-400 flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5" /> De confirmat ({pending.length})
      </h2>
      <div className="glass-card rounded-2xl divide-y divide-amber-500/15 stagger-in">
        {pending.map((p) => (
          <div key={p.id} className="flex items-start justify-between gap-2 px-3 py-3">
            <PaymentLine p={p} />
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => confirmMutation.mutate(p.id)}
                disabled={busy}
                title="Confirmă primirea banilor"
                className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-1.5 text-emerald-400 transition-transform hover:bg-emerald-500/20 active:scale-90 disabled:opacity-30"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Respingi plata de ${p.total} lei a lui "${p.username}"?`)) {
                    rejectMutation.mutate(p.id);
                  }
                }}
                disabled={busy}
                title="Respinge"
                className="rounded-md border border-red-500/30 bg-red-500/10 p-1.5 text-red-400 transition-transform hover:bg-red-500/20 active:scale-90 disabled:opacity-30"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const STATUS_STYLE: Record<ContributorRow["status"], { label: string; className: string }> = {
  confirmed: { label: "Plătit", className: "bg-emerald-500/15 text-emerald-400" },
  pending: { label: "În așteptare", className: "bg-amber-500/15 text-amber-400" },
  unpaid: { label: "Neplătit", className: "bg-red-500/15 text-red-400" },
  exempt: { label: "Scutit", className: "bg-muted text-muted-foreground" },
};

function ContributorsSection({ data }: { data: ContributionsOverview }) {
  const invalidate = useInvalidate();
  const exemptFn = useServerFn(setContributionExempt);
  const exemptMutation = useMutation({
    mutationFn: (v: { userId: number; exempt: boolean }) => exemptFn({ data: v }),
    onSuccess: (_, v) => {
      toast.success(v.exempt ? "Utilizator scutit" : "Scutire anulată");
      invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <section className="space-y-2">
      <SectionTitle icon={<Users className="h-3.5 w-3.5" />}>
        Situația pe {monthLabel(data.month, false)} ({data.contributors.length})
      </SectionTitle>
      <div className="glass-card rounded-2xl divide-y divide-border/50 stagger-in">
        {data.contributors.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            Niciun utilizator aprobat.
          </div>
        ) : (
          data.contributors.map((c) => {
            const style = STATUS_STYLE[c.status];
            return (
              <div key={c.userId} className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{c.username}</div>
                  <button
                    type="button"
                    onClick={() => {
                      const msg = c.exempt
                        ? `Anulezi scutirea lui "${c.username}"?`
                        : `Scutești pe "${c.username}" de contribuție?`;
                      if (confirm(msg)) {
                        exemptMutation.mutate({ userId: c.userId, exempt: !c.exempt });
                      }
                    }}
                    disabled={exemptMutation.isPending}
                    className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    {c.exempt ? "Anulează scutirea" : "Scutește"}
                  </button>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {c.amount > 0 && (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {c.amount} lei
                    </span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${style.className}`}
                  >
                    {style.label}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function AddPaymentSection({ data }: { data: ContributionsOverview }) {
  const invalidate = useInvalidate();
  const addFn = useServerFn(addManualContribution);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<number | "">("");
  const [startMonth, setStartMonth] = useState(data.month);
  const [months, setMonths] = useState(1);
  const [perMonth, setPerMonth] = useState(String(RECOMMENDED_PER_MONTH));
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [note, setNote] = useState("");

  const amount = Number(perMonth);
  const valid =
    userId !== "" &&
    Number.isInteger(amount) &&
    amount >= MIN_PER_MONTH &&
    months >= 1 &&
    months <= MAX_MONTHS;

  const mutation = useMutation({
    mutationFn: () =>
      addFn({
        data: {
          userId: userId as number,
          startMonth,
          months,
          perMonth: amount,
          method,
          note,
        },
      }),
    onSuccess: (res) => {
      toast.success(`Plată adăugată pentru ${monthsRangeLabel(res.months)}`);
      setOpen(false);
      setUserId("");
      setNote("");
      invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // Luna de start: câteva luni în urmă (restanțe) și câteva înainte.
  const monthOptions = Array.from({ length: 18 }, (_, i) => addMonths(data.currentMonth, i - 12));

  const field = "w-full rounded-lg border border-border/60 bg-background px-2 py-1.5 text-xs";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setStartMonth(data.month);
          setOpen(true);
        }}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 bg-card py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted/60"
      >
        <Plus className="h-4 w-4" /> Adaugă plată
      </button>
    );
  }

  return (
    <section className="glass-card rounded-2xl p-4 space-y-3">
      <div className="text-sm font-semibold">Adaugă plată (confirmată direct)</div>
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 space-y-1 text-[11px] text-muted-foreground">
          Utilizator
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : "")}
            className={field}
          >
            <option value="">Alege…</option>
            {data.contributors.map((c) => (
              <option key={c.userId} value={c.userId}>
                {c.username}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[11px] text-muted-foreground">
          De la luna
          <select
            value={startMonth}
            onChange={(e) => setStartMonth(e.target.value)}
            className={field}
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[11px] text-muted-foreground">
          Nr. luni
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            className={field}
          >
            {Array.from({ length: MAX_MONTHS }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[11px] text-muted-foreground">
          Lei pe lună
          <input
            type="number"
            inputMode="numeric"
            min={MIN_PER_MONTH}
            value={perMonth}
            onChange={(e) => setPerMonth(e.target.value)}
            className={field}
          />
        </label>
        <label className="space-y-1 text-[11px] text-muted-foreground">
          Metodă
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            className={field}
          >
            {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 space-y-1 text-[11px] text-muted-foreground">
          Notă (opțional)
          <input value={note} onChange={(e) => setNote(e.target.value)} className={field} />
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Lunile deja acoperite ale utilizatorului se sar automat.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex-1 rounded-xl bg-muted/60 py-2 text-xs font-medium text-muted-foreground"
        >
          Renunță
        </button>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={!valid || mutation.isPending}
          className="flex-[2] rounded-xl bg-primary py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
        >
          Adaugă {valid ? `${amount * months} lei` : ""}
        </button>
      </div>
    </section>
  );
}

function HistorySection({ history }: { history: AdminPayment[] }) {
  const invalidate = useInvalidate();
  const deleteFn = useServerFn(deleteContribution);
  const [visible, setVisible] = useState(15);
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Plată ștearsă");
      invalidate();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (history.length === 0) return null;

  return (
    <section className="space-y-2">
      <SectionTitle icon={<History className="h-3.5 w-3.5" />}>Istoric plăți</SectionTitle>
      <div className="glass-card rounded-2xl divide-y divide-border/50">
        {history.slice(0, visible).map((p) => (
          <div key={p.id} className="flex items-start justify-between gap-2 px-3 py-2.5">
            <PaymentLine p={p} />
            <div className="flex shrink-0 items-center gap-1.5">
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  p.status === "confirmed"
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-red-500/15 text-red-400"
                }`}
                title={p.decidedBy ? `de ${p.decidedBy}` : undefined}
              >
                {p.status === "confirmed"
                  ? p.addedByAdmin
                    ? "Adăugată"
                    : "Confirmată"
                  : "Respinsă"}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Ștergi plata de ${p.total} lei a lui "${p.username}"?`)) {
                    deleteMutation.mutate(p.id);
                  }
                }}
                disabled={deleteMutation.isPending}
                title="Șterge"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:text-red-400 disabled:opacity-30"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
      {history.length > visible && (
        <button
          type="button"
          onClick={() => setVisible((v) => v + 15)}
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Arată mai multe
        </button>
      )}
    </section>
  );
}
