// Starea legăturii Ethernet + buton de renegociere, în drawer-ul Speedtest.
//
// Problema pe care o rezolvă: la atingerea fizică a cablului, auto-negocierea
// se reașază pe 100 Mb/s și rămâne acolo. Cardul arată mereu viteza curentă,
// ca să se vadă dinainte dacă butonul chiar e necesar.

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Cable, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { networkLinkQuery } from "@/lib/queries";
import { renegotiateNetworkLink } from "@/lib/system/network-link.functions";

function fmtSpeed(mbps: number | null): string {
  if (mbps == null) return "—";
  return mbps >= 1000 ? `${(mbps / 1000).toFixed(mbps % 1000 === 0 ? 0 : 1)} Gb/s` : `${mbps} Mb/s`;
}

// Cât urmărim revenirea legăturii după renegociere. `ethtool -r` o face să cadă
// și să revină în 2-5s, dar lăsăm marjă pentru switch-uri mai lente.
const WATCH_MS = 45_000;
const WATCH_INTERVAL_MS = 2000;

export function NetworkLinkCard() {
  const qc = useQueryClient();
  const link = useQuery(networkLinkQuery);
  const renegotiate = useServerFn(renegotiateNetworkLink);
  const [watching, setWatching] = useState(false);
  const watchUntil = useRef(0);

  // După renegociere, legătura pică și revine — reinterogăm des până se așază,
  // altfel utilizatorul ar vedea "100 Mb/s" încă un minut și ar crede că n-a
  // funcționat.
  useEffect(() => {
    if (!watching) return;
    const id = setInterval(() => {
      if (Date.now() > watchUntil.current) {
        setWatching(false);
        return;
      }
      qc.invalidateQueries({ queryKey: ["networkLink"] });
    }, WATCH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [watching, qc]);

  const run = useMutation({
    mutationFn: () => renegotiate(),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error ?? "Renegocierea a eșuat");
        return;
      }
      toast.success("Auto-negociere repornită", {
        description: "Legătura cade și revine în câteva secunde. Urmăresc viteza.",
      });
      watchUntil.current = Date.now() + WATCH_MS;
      setWatching(true);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const d = link.data;
  const degraded = !!d?.degraded;

  return (
    <div className="rounded-xl glass-card p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Cable className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Legătură Ethernet</span>
        </div>
        {link.isLoading ? (
          <span className="h-5 w-16 skeleton-sweep rounded" />
        ) : (
          <span
            className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              degraded ? "bg-amber-500/15 text-amber-400" : "bg-emerald-500/15 text-emerald-400"
            }`}
          >
            {degraded ? (
              <AlertTriangle className="h-3 w-3" />
            ) : (
              <CheckCircle2 className="h-3 w-3" />
            )}
            {fmtSpeed(d?.speedMbps ?? null)}
          </span>
        )}
      </div>

      <div className="text-[11px] leading-snug text-muted-foreground">
        {d?.error ? (
          <span className="text-amber-400">{d.error}</span>
        ) : degraded ? (
          <>
            Negociat la{" "}
            <span className="font-semibold text-amber-400">{fmtSpeed(d.speedMbps)}</span>, deși
            legătura suportă {fmtSpeed(d.expectedMbps)}. Se întâmplă după ce cablul e atins fizic.
            Butonul repornește doar auto-negocierea.
          </>
        ) : d?.speedMbps != null ? (
          <>
            {d.iface} · {fmtSpeed(d.speedMbps)}
            {d.duplex ? ` · ${d.duplex} duplex` : ""}
            {d.expectedMbps != null ? ` · maximul posibil pe această legătură` : ""}
          </>
        ) : (
          "Viteză necunoscută."
        )}
      </div>

      <button
        type="button"
        onClick={() => run.mutate()}
        disabled={run.isPending || watching}
        className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors active:scale-[0.99] disabled:opacity-60 ${
          degraded
            ? "border-amber-500/40 bg-amber-500/15 text-amber-400 hover:bg-amber-500/25"
            : "border-border bg-background text-muted-foreground hover:bg-muted/60"
        }`}
      >
        <RefreshCw className={`h-4 w-4 ${run.isPending || watching ? "animate-spin" : ""}`} />
        {watching
          ? "Aștept revenirea legăturii…"
          : run.isPending
            ? "Se trimite…"
            : "Renegociază conexiunea"}
      </button>

      {watching && (
        <p className="text-[11px] text-muted-foreground">
          Legătura e jos câteva secunde — e normal ca aplicația să pară blocată în acest timp.
        </p>
      )}
    </div>
  );
}
