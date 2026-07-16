import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpCircle, Images, PlayCircle } from "lucide-react";
import { toast } from "sonner";

import { logAgentActivity, runAgentCommand, type AgentCommand, type AgentResult } from "@/lib/agent.functions";
import { adminStatusQuery, versionsQuery } from "@/lib/queries";
import type { ServiceVersion } from "@/lib/versions.functions";

type ServiceVersionWidgetProps = {
  service: "plex" | "immich";
};

const serviceConfig = {
  plex: {
    icon: <PlayCircle className="h-5 w-5 text-amber-400" />,
    restartCmd: "restart_plex",
    updateCmd: "update_plex",
  },
  immich: {
    icon: <Images className="h-5 w-5 text-purple-400" />,
    restartCmd: "restart_immich",
    updateCmd: "update_immich",
  },
} as const satisfies Record<ServiceVersionWidgetProps["service"], {
  icon: React.ReactNode;
  restartCmd: AgentCommand;
  updateCmd: AgentCommand;
}>;

export function ServiceVersionWidget({ service }: ServiceVersionWidgetProps) {
  const versions = useQuery(versionsQuery);
  const admin = useQuery(adminStatusQuery);
  const run = useServerFn(runAgentCommand);
  const mutation = useMutation({
    mutationFn: (command: AgentCommand) => run({ data: { cmd: command } }),
    onSuccess: (result, command) => {
      logAgentActivity(command, result.ok).catch(() => {});
      if (result.ok) toast.success(`Comanda ${command} a rulat cu succes`);
      else toast.error(`Comanda ${command} a eșuat: ${result.error ?? `exit ${result.exit_code}`}`);
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const version = versions.data?.[service];
  if (!version) return null;

  const config = serviceConfig[service];
  const running = mutation.isPending ? mutation.variables : null;
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Versiune serviciu</h2>
      <VersionCard
        icon={config.icon}
        version={version}
        restartCmd={config.restartCmd}
        updateCmd={config.updateCmd}
        running={running}
        canManage={admin.data?.isAdmin === true}
        onRun={mutation.mutate}
      />
      {mutation.data && <CommandOutput command={mutation.variables} result={mutation.data} />}
    </section>
  );
}

function VersionCard({
  icon,
  version,
  restartCmd,
  updateCmd,
  running,
  canManage,
  onRun,
}: {
  icon: React.ReactNode;
  version: ServiceVersion;
  restartCmd: AgentCommand;
  updateCmd: AgentCommand;
  running: AgentCommand | null;
  canManage: boolean;
  onRun: (command: AgentCommand) => void;
}) {
  const badge = version.upToDate === undefined
    ? { text: "Necunoscut", className: "bg-muted text-muted-foreground" }
    : version.upToDate
      ? { text: "La zi", className: "bg-emerald-500/20 text-emerald-400" }
      : { text: "Actualizare disponibilă", className: "bg-amber-500/20 text-amber-400" };

  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">{icon}<div className="text-sm font-semibold">{version.name}</div></div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.className}`}>{badge.text}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <VersionValue label="Curentă" value={version.current} />
        <VersionValue label="Ultima" value={version.latest} />
      </div>
      {version.error && <div className="mt-2 text-[11px] text-red-400">{version.error}</div>}
      <div className="mt-2 flex flex-wrap gap-2">
        {version.changelog && <a href={version.changelog} target="_blank" rel="noreferrer" className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">Changelog</a>}
        {canManage && (
          <button
            type="button"
            onClick={() => onRun(restartCmd)}
            disabled={running === restartCmd}
            className="rounded-lg border border-sky-500/30 bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-400 hover:bg-sky-500/25 disabled:opacity-50"
          >
            {running === restartCmd ? "Se repornește..." : "Repornește"}
          </button>
        )}
        {canManage && version.upToDate === false && (
          <button
            type="button"
            onClick={() => {
              if (confirm(`Actualizezi ${version.name}? Serviciul va fi oprit, actualizat și repornit.`)) onRun(updateCmd);
            }}
            disabled={running === updateCmd}
            className="flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-400 hover:bg-amber-500/25 disabled:opacity-50"
          >
            <ArrowUpCircle className="h-3.5 w-3.5" />
            {running === updateCmd ? "Se actualizează..." : "Actualizează serviciul"}
          </button>
        )}
      </div>
    </div>
  );
}

function VersionValue({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-lg bg-muted/40 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">{value ?? "—"}</div>
    </div>
  );
}

function CommandOutput({ command, result }: { command: AgentCommand; result: AgentResult }) {
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
