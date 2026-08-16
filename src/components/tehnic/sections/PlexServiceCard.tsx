import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlayCircle } from "lucide-react";

import { plexQuery } from "@/lib/queries";
import { ServiceHeaderActions, CommandOutput } from "@/components/ServiceHeaderActions";
import { useServiceRecovery } from "@/components/useServiceRecovery";
import type { AgentCommand, AgentResult } from "@/lib/system/agent.functions";

// Control pentru serviciul Plex (restart/actualizare) — mutat aici de pe
// fosta pagină dedicată /plex (ștearsă, vezi planul de unificare: sesiunile/
// bibliotecile/adăugate-recent erau deja duplicate pe Acasă/Bibliotecă, iar
// Top-uri/istoric vizionări au fost eliminate ca funcționalitate, nu doar
// mutate). Acest panou de control (unicul lucru fără duplicat) capătă loc
// aici, în Tehnic — la fel cum /qbit și /immich au fiecare propriul panou.
export function PlexServiceCard() {
  const { data, isLoading } = useQuery(plexQuery);
  const status = isLoading ? "loading" : (data?.status ?? "error");
  const { recovering, startRecovery } = useServiceRecovery(data?.status);
  const [lastCmd, setLastCmd] = useState<{ command: AgentCommand; result: AgentResult } | null>(
    null,
  );

  return (
    <div className="space-y-2">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="text-amber-400">
              <PlayCircle className="h-5 w-5" />
            </span>
            <div>
              <div className="font-semibold">Plex</div>
              <div className="text-xs text-muted-foreground">
                {data?.status === "ok"
                  ? `${data.serverName ?? "Server"} · v${data.version ?? ""}`
                  : recovering
                    ? "Se repornește…"
                    : "Server media"}
              </div>
            </div>
          </div>
          <ServiceHeaderActions
            service="plex"
            status={status}
            onRestart={startRecovery}
            onCommandResult={(command, result) => setLastCmd({ command, result })}
          />
        </div>
      </div>
      {lastCmd && <CommandOutput command={lastCmd.command} result={lastCmd.result} />}
    </div>
  );
}
