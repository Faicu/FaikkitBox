import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Heart,
  ExternalLink,
  Landmark,
  Copy,
  CheckCircle2,
  Clock,
  CircleAlert,
  Minus,
  Plus,
  X,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

import { myContributionQuery } from "@/lib/queries";
import {
  cancelMyContribution,
  declareContribution,
  type ContributionProgress,
  type MyContribution,
} from "@/lib/contributions/contributions.functions";
import {
  MAX_MONTHS,
  METHOD_LABELS,
  MIN_PER_MONTH,
  RECOMMENDED_PER_MONTH,
  monthLabel,
  monthsRangeLabel,
} from "@/lib/contributions/months";

// Datele de plată sunt fixe și publice — nu au ce căuta în DB sau în env.
const REVOLUT_URL = "https://revolut.me/faicu";
const REVOLUT_LABEL = "revolut.me/faicu";
const IBAN = "RO47RZBR0000060020633193";
const IBAN_HOLDER = "ANDREI PRODAN";
const IBAN_BANK = "Raiffeisen Bank";

// IBAN-ul se citește greu într-un șir continuu; îl grupăm câte 4 doar la
// afișare — în clipboard ajunge forma fără spații, cea acceptată de bănci.
const ibanGrouped = IBAN.replace(/(.{4})/g, "$1 ").trim();

// `navigator.clipboard` există doar în context securizat. Prin proxy (HTTPS) e
// acolo, dar cine deschide aplicația direct pe IP-ul din rețea, pe portul 3000,
// primește HTTP — și atunci API-ul lipsește cu totul. Fallback-ul vechi cu
// `execCommand` nu mai e recomandat, dar aici e singura variantă care
// funcționează, iar alternativa e un buton care nu face nimic.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // cădem pe varianta de mai jos
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

// Cardul de contribuție de pe Acasă. Utilizatorii văd starea lunii curente,
// progresul total spre țintă (fără nume sau sume ale altora) și declară
// „Am plătit"; adminii văd doar un rezumat cu link spre /contributii.
export function SupportWidget() {
  const { data } = useQuery(myContributionQuery);
  if (data?.kind === "admin") return <AdminSummary data={data} />;
  return <UserCard data={data?.kind === "user" ? data : null} />;
}

export function ContributionProgressBar({ progress }: { progress: ContributionProgress }) {
  const { target, confirmed, pending } = progress;
  const pct = (v: number) => (target > 0 ? Math.min(100, (v / target) * 100) : 0);
  const confirmedPct = pct(confirmed);
  const pendingPct = Math.min(100 - confirmedPct, pct(pending));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>Strâns în {monthLabel(progress.month, false)}</span>
        <span className="tabular-nums">
          <span className="font-semibold text-foreground">{confirmed}</span> / {target} lei
        </span>
      </div>
      <div className="relative flex h-2 w-full overflow-hidden rounded-full bg-muted/60">
        <div
          className="h-full bg-emerald-500 transition-[width] duration-700 ease-out"
          style={{ width: `${confirmedPct}%` }}
        />
        <div
          className="h-full bg-emerald-500/35 transition-[width] duration-700 ease-out"
          style={{ width: `${pendingPct}%` }}
        />
      </div>
      {pending > 0 && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          + {pending} lei în așteptarea confirmării
        </div>
      )}
    </div>
  );
}

function AdminSummary({ data }: { data: Extract<MyContribution, { kind: "admin" }> }) {
  return (
    <Link
      to="/contributii"
      className="block rounded-2xl border border-primary/30 bg-primary/5 p-4 press-tile"
    >
      <div className="flex items-center gap-2">
        <Heart className="h-4 w-4 text-primary" />
        <h2 className="flex-1 text-sm font-semibold text-foreground">Contribuții</h2>
        {data.pendingCount > 0 && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
            {data.pendingCount} de confirmat
          </span>
        )}
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-3">
        <ContributionProgressBar progress={data.progress} />
      </div>
    </Link>
  );
}

function UserCard({ data }: { data: Extract<MyContribution, { kind: "user" }> | null }) {
  const [formOpen, setFormOpen] = useState(false);
  const qc = useQueryClient();
  const cancelFn = useServerFn(cancelMyContribution);
  const cancelMutation = useMutation({
    mutationFn: (id: number) => cancelFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Declarația a fost anulată");
      qc.invalidateQueries({ queryKey: ["contributions"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const copyIban = async () => {
    if (await copyToClipboard(IBAN)) toast.success("IBAN copiat");
    else toast.error("Nu am putut copia IBAN-ul");
  };

  const exempt = data?.exempt ?? false;
  const covered = data?.status === "confirmed" || data?.status === "pending";

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2">
        <Heart className="h-4 w-4 text-primary" />
        <h2 className="flex-1 text-sm font-semibold text-foreground">Contribuția lunară</h2>
        {data && <StatusBadge data={data} />}
      </div>

      {exempt ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Contul tău e scutit de contribuție. Dacă vrei totuși să susții serverul, datele de plată
          sunt mai jos.
        </p>
      ) : (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Serverul, curentul și abonamentele se plătesc lunar. Strângem împreună{" "}
          {data?.progress.target ?? 250} lei pe lună: minimum {MIN_PER_MONTH} lei de persoană,
          recomandat {RECOMMENDED_PER_MONTH} lei. Poți plăti și pentru mai multe luni în avans.
        </p>
      )}

      {data && !exempt && data.coveredUntil && (
        <p className="mt-2 text-xs text-foreground">
          {data.status === "confirmed" ? "Plătit" : "Declarat"} până în{" "}
          <span className="font-semibold">{monthLabel(data.coveredUntil)}</span>.
        </p>
      )}

      {data && (
        <div className="mt-3">
          <ContributionProgressBar progress={data.progress} />
        </div>
      )}

      {data && data.pendingPayments.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {data.pendingPayments.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-[11px]"
            >
              <Clock className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground">
                  {p.total} lei · {METHOD_LABELS[p.method]}
                </div>
                <div className="text-muted-foreground">
                  {monthsRangeLabel(p.months)} · așteaptă confirmarea adminului
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirm("Anulezi declarația de plată?")) cancelMutation.mutate(p.id);
                }}
                disabled={cancelMutation.isPending}
                title="Anulează"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:text-red-400 disabled:opacity-30"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 space-y-2">
        <a
          href={REVOLUT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 rounded-xl glass-card glass-card-hover press-tile px-3 py-2.5"
        >
          <ExternalLink className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-foreground">Revolut</div>
            <div className="truncate text-[11px] text-muted-foreground">{REVOLUT_LABEL}</div>
          </div>
        </a>

        <button
          type="button"
          onClick={copyIban}
          className="flex w-full items-center gap-2.5 rounded-xl glass-card glass-card-hover press-tile px-3 py-2.5 text-left"
        >
          <Landmark className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-foreground">Transfer bancar (IBAN)</div>
            <div className="truncate font-mono text-[11px] text-foreground/80">{ibanGrouped}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {IBAN_HOLDER} · {IBAN_BANK}
            </div>
          </div>
          <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </div>

      {data && !exempt && (
        <div className="mt-3">
          {formOpen ? (
            <DeclareForm onDone={() => setFormOpen(false)} advance={covered} />
          ) : (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className={`w-full rounded-xl py-2.5 text-sm font-semibold transition-colors active:scale-[0.99] ${
                covered
                  ? "glass-card glass-card-hover text-foreground"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              }`}
            >
              {covered ? "Plătește în avans" : "Am plătit"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ data }: { data: Extract<MyContribution, { kind: "user" }> }) {
  const month = monthLabel(data.progress.month, false);
  switch (data.status) {
    case "confirmed":
      return (
        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
          <CheckCircle2 className="h-3 w-3" /> Plătit pe {month}
        </span>
      );
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
          <Clock className="h-3 w-3" /> În așteptare
        </span>
      );
    case "unpaid":
      return (
        <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
          <CircleAlert className="h-3 w-3" /> Neplătit pe {month}
        </span>
      );
    case "exempt":
      return (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          Scutit
        </span>
      );
  }
}

const AMOUNT_CHIPS = [MIN_PER_MONTH, RECOMMENDED_PER_MONTH];

function DeclareForm({ onDone, advance }: { onDone: () => void; advance: boolean }) {
  const qc = useQueryClient();
  const declareFn = useServerFn(declareContribution);
  const [months, setMonths] = useState(1);
  const [perMonth, setPerMonth] = useState(RECOMMENDED_PER_MONTH);
  const [custom, setCustom] = useState("");
  const [method, setMethod] = useState<"revolut" | "iban">("revolut");

  const customMode = custom !== "";
  const amount = customMode ? Number(custom) : perMonth;
  const amountValid = Number.isInteger(amount) && amount >= MIN_PER_MONTH;
  const total = amountValid ? amount * months : 0;

  const mutation = useMutation({
    mutationFn: () => declareFn({ data: { months, perMonth: amount, method } }),
    onSuccess: (res) => {
      toast.success(`Plată declarată pentru ${monthsRangeLabel(res.months)}`, {
        description: "Adminul o va confirma după ce primește banii.",
      });
      qc.invalidateQueries({ queryKey: ["contributions"] });
      onDone();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const chip = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
      active
        ? "bg-primary text-primary-foreground"
        : "bg-muted/60 text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="space-y-3 rounded-xl glass-card p-3">
      <div className="text-xs font-semibold text-foreground">
        {advance ? "Plată în avans" : "Declară plata"}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Câte luni</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMonths((m) => Math.max(1, m - 1))}
            disabled={months <= 1}
            className="rounded-md bg-muted/60 p-1.5 disabled:opacity-30"
            aria-label="Mai puține luni"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-6 text-center text-sm font-semibold tabular-nums">{months}</span>
          <button
            type="button"
            onClick={() => setMonths((m) => Math.min(MAX_MONTHS, m + 1))}
            disabled={months >= MAX_MONTHS}
            className="rounded-md bg-muted/60 p-1.5 disabled:opacity-30"
            aria-label="Mai multe luni"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="text-xs text-muted-foreground">Sumă pe lună</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {AMOUNT_CHIPS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setPerMonth(v);
                setCustom("");
              }}
              className={chip(!customMode && perMonth === v)}
            >
              {v} lei{v === RECOMMENDED_PER_MONTH ? " (recomandat)" : ""}
            </button>
          ))}
          <input
            type="number"
            inputMode="numeric"
            min={MIN_PER_MONTH}
            step={1}
            placeholder="Altă sumă"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className={`w-24 rounded-lg border bg-background px-2 py-1.5 text-xs ${
              customMode && !amountValid ? "border-red-500/60" : "border-border/60"
            }`}
          />
        </div>
        {customMode && !amountValid && (
          <div className="text-[11px] text-red-400">
            Minimum {MIN_PER_MONTH} lei, sumă întreagă.
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <span className="text-xs text-muted-foreground">Am plătit prin</span>
        <div className="flex gap-1.5">
          {(["revolut", "iban"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={chip(method === m)}
            >
              {METHOD_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border/50 pt-2 text-xs">
        <span className="text-muted-foreground">Total</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">{total} lei</span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onDone}
          className="flex-1 rounded-xl bg-muted/60 py-2 text-xs font-medium text-muted-foreground"
        >
          Renunță
        </button>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={!amountValid || mutation.isPending}
          className="flex-[2] rounded-xl bg-primary py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          Confirm că am plătit {total} lei
        </button>
      </div>
    </div>
  );
}
