import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, CircleHelp, XCircle } from "lucide-react";

import {
  setDeviceHdr,
  type HdrDeviceHint as DeviceHint,
} from "@/lib/services/device-hdr.functions";
import { HDR_HINT_QUERY_KEY, useHdrDeviceHint } from "./useHdrDeviceHint";

// Indiciul din întrebarea HDR: pe ce se uită de obicei utilizatorul (și pe ce
// s-a uitat ultima dată, dacă e altceva) și dacă acel ecran are HDR. Doar
// informează — nu răspunde la întrebare în locul lui. Fără cont Plex legat
// sau fără vizionări nu apare nimic.
export function HdrDeviceHint() {
  const { data } = useHdrDeviceHint();
  if (!data) return null;
  return (
    <div className="space-y-1.5 rounded-lg border border-border/60 bg-background/40 p-2">
      <DeviceLine label="De obicei te uiți pe" hint={data.usual} />
      {data.last && <DeviceLine label="Ultima dată te-ai uitat pe" hint={data.last} />}
    </div>
  );
}

function verdictLabel(h: DeviceHint): string {
  if (h.verdict === "unknown") return "Nu știu sigur";
  if (h.verdict === "yes") return h.sure ? "Are HDR" : "Probabil da";
  return h.sure ? "Fără HDR" : "Probabil nu";
}

function DeviceLine({ label, hint }: { label: string; hint: DeviceHint }) {
  const queryClient = useQueryClient();
  const setFn = useServerFn(setDeviceHdr);
  const [busy, setBusy] = useState(false);

  async function answer(hasHdr: boolean | null) {
    setBusy(true);
    try {
      await setFn({ data: { clientId: hint.clientId, hasHdr } });
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: HDR_HINT_QUERY_KEY });
    }
  }

  const Icon = hint.verdict === "yes" ? CheckCircle2 : hint.verdict === "no" ? XCircle : CircleHelp;
  const tone =
    hint.verdict === "yes"
      ? "text-emerald-300"
      : hint.verdict === "no"
        ? "text-amber-300"
        : "text-muted-foreground";

  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-start gap-1.5">
        <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} />
        <p className="text-muted-foreground">
          {label} <span className="font-medium text-foreground">{hint.name}</span> —{" "}
          <span className={`font-medium ${tone}`}>{verdictLabel(hint)}</span>: {hint.reason}.
        </p>
      </div>
      {!hint.sure && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 pl-5">
          <button
            type="button"
            disabled={busy}
            onClick={() => answer(true)}
            className="text-cyan-300 underline-offset-2 hover:underline disabled:opacity-40"
          >
            Știu că are HDR
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => answer(false)}
            className="text-cyan-300 underline-offset-2 hover:underline disabled:opacity-40"
          >
            Știu că nu are HDR
          </button>
        </div>
      )}
      {hint.source === "user" && (
        <div className="pl-5">
          <button
            type="button"
            disabled={busy}
            onClick={() => answer(null)}
            className="text-muted-foreground underline-offset-2 hover:underline disabled:opacity-40"
          >
            Anulează confirmarea
          </button>
        </div>
      )}
    </div>
  );
}
