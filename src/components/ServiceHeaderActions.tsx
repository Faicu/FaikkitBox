import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpCircle, ExternalLink, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { logAgentActivity, runAgentCommand, type AgentCommand, type AgentResult } from "@/lib/agent.functions";
import { adminStatusQuery, versionsQuery } from "@/lib/queries";
import { ServicePill } from "@/components/ServicePill";

type Service = "plex" | "immich";

const serviceConfig = {
  plex: { restartCmd: "restart_plex" as AgentCommand, updateCmd: "update_plex" as AgentCommand },
  immich: { restartCmd: "restart_immich" as AgentCommand, updateCmd: "update_immich" as AgentCommand },
};

type Props = {
  service: Service;
  status: "ok" | "error" | "loading";
  onRestart?: () => void;
  onCommandResult?: (command: AgentCommand, result: AgentResult) => void;
};

export function ServiceHeaderActions({ service, status, onRestart, onCommandResult }: Props) {
  const versions = useQuery(versionsQuery);
  const admin = useQuery(adminStatusQuery);
  const run = useServerFn(runAgentCommand);
  const config = serviceConfig[service];
  const version = versions.data?.[service];
  const canManage = admin.data?.isAdmin === true;

  const mutation = useMutation({
    mutationFn: (command: AgentCommand) => run({ data: { cmd: command } }),
    onMutate: (command) => {
      if (command === config.restartCmd) onRestart?.();
    },
    onSuccess: (result, command) => {
      logAgentActivity(command, result.ok).catch(() => {});
      onCommandResult?.(command, result);
      if (result.ok) toast.success(`Comanda ${command} a rulat cu succes`);
      else toast.error(`Comanda ${command} a eșuat: ${result.error ?? `exit ${result.exit_code}`}`);
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const running = mutation.isPending ? mutation.variables : null;

  return (
    <div className="flex items-center gap-2">
      {canManage && version?.changelog && (
        <a
          href={version.changelog}
          target="_blank"
          rel="noreferrer"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          title="Changelog"
          aria-label="Changelog"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      )}
      {canManage && (
        <button
          type="button"
          onClick={() => mutation.mutate(config.restartCmd)}
          disabled={running === config.restartCmd}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground disabled:opacity-50"
          title={running === config.restartCmd ? "Se repornește..." : "Repornește"}
          aria-label="Repornește"
        >
          <RotateCcw className={`h-4 w-4 ${running === config.restartCmd ? "animate-spin" : ""}`} />
        </button>
      )}
      {canManage && version?.upToDate === false && (
        <button
          type="button"
          onClick={() => {
            if (confirm(`Actualizezi ${version.name}? Serviciul va fi oprit, actualizat și repornit.`)) {
              mutation.mutate(config.updateCmd);
            }
          }}
          disabled={running === config.updateCmd}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 disabled:opacity-50"
          title={running === config.updateCmd ? "Se actualizează..." : "Actualizare disponibilă"}
          aria-label="Actualizează"
        >
          <ArrowUpCircle className="h-4 w-4" />
        </button>
      )}
      <ServicePill status={status} />
    </div>
  );
}

export function CommandOutput({ command, result }: { command: AgentCommand; result: AgentResult }) {
  return (
    <div className="rounded-2xl border border-border bg-black/40 p-3">
      <div className={`mb-2 text-xs ${result.ok ? "text-emerald-400" : "text-red-400"}`}>
        {result.ok ? "✓ Succes" : "✗ Eșec"} {result.exit_code != null && `· exit ${result.exit_code}`}
        {result.error && ` · ${result.error}`}
      </div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-[11px] text-muted-foreground">
        {`${result.stdout ?? ""}${result.stderr ? `\n${result.stderr}` : ""}`}
      </pre>
    </div>
  );
}
