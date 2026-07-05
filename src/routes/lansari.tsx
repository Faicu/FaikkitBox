import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Flame, CheckCircle2, XCircle, HelpCircle } from "lucide-react";

import { PageShell } from "@/components/PageShell";
import { ServicePill } from "@/components/ServicePill";
import { ErrorCard } from "@/components/ErrorCard";
import { showStatusQuery, camatariiStatusQuery } from "@/lib/queries";
import type { ShowStatusData } from "@/lib/services.functions";

export const Route = createFileRoute("/lansari")({
  head: () => ({ meta: [{ title: "Lansări — Monitor Server" }] }),
  component: LansariPage,
});

function LansariPage() {
  const { data: hotdData, isLoading: isHotdLoading } = useQuery(showStatusQuery);
  const { data: camatariiData, isLoading: isCamatariiLoading } = useQuery(camatariiStatusQuery);
  const status =
    isHotdLoading || isCamatariiLoading
      ? "loading"
      : hotdData?.status === "error" || camatariiData?.status === "error"
        ? "error"
        : "ok";

  return (
    <PageShell title="Lansări" subtitle="Calendar seriale" right={<ServicePill status={status} />}>
      {hotdData?.status === "error" && <ErrorCard title="House of the Dragon indisponibil" message={hotdData.error ?? "Eroare necunoscută"} />}
      {hotdData?.status === "ok" && <ShowStatusCard data={hotdData} />}
      {camatariiData?.status === "error" && <ErrorCard title="Camatarii indisponibil" message={camatariiData.error ?? "Eroare necunoscută"} />}
      {camatariiData?.status === "ok" && <ShowStatusCard data={camatariiData} />}
    </PageShell>
  );
}

function useCountdown(targetIso: string) {
  const [remaining, setRemaining] = useState(() => new Date(targetIso).getTime() - Date.now());
  useEffect(() => {
    const id = setInterval(() => setRemaining(new Date(targetIso).getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  return remaining;
}

function ShowStatusCard({ data }: { data: ShowStatusData }) {
  const remainingMs = useCountdown(data.next?.airDateIso ?? new Date().toISOString());
  const past = remainingMs <= 0;
  const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Flame className="h-3.5 w-3.5 text-orange-400" /> {data.show}
      </h2>
      <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
        {data.lastAired ? (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Ultimul episod lansat</div>
            <div className="mt-1 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  E{data.lastAired.episode} — {data.lastAired.title}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(data.lastAired.airDateIso).toLocaleDateString("ro-RO", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </div>
              </div>
              <LibraryBadge inLibrary={data.lastAired.inLibrary} />
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Sezonul nu a început încă.</div>
        )}

        {data.next && (
          <div className="border-t border-border pt-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Următorul episod — E{data.next.episode}
            </div>
            {past ? (
              <div className="mt-1 text-sm font-medium text-emerald-400">Ar trebui să fi apărut deja</div>
            ) : (
              <div className="mt-1.5 flex items-center gap-2 tabular-nums">
                {[
                  { v: days, l: "zile" },
                  { v: hours, l: "ore" },
                  { v: minutes, l: "min" },
                  { v: seconds, l: "sec" },
                ].map((u) => (
                  <div key={u.l} className="flex-1 rounded-xl bg-muted px-2 py-1.5 text-center">
                    <div className="text-lg font-semibold leading-none">{String(u.v).padStart(2, "0")}</div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{u.l}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              {new Date(data.next.airDateIso).toLocaleString("ro-RO", {
                weekday: "long",
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function LibraryBadge({ inLibrary }: { inLibrary: boolean | null }) {
  if (inLibrary === true) {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-lg bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> În bibliotecă
      </span>
    );
  }
  if (inLibrary === false) {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-lg bg-red-500/15 px-2 py-1 text-[11px] font-medium text-red-400">
        <XCircle className="h-3.5 w-3.5" /> Nu e încă
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-lg bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
      <HelpCircle className="h-3.5 w-3.5" /> Necunoscut
    </span>
  );
}
