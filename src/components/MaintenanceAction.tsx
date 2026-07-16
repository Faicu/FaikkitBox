import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import {
  logAgentActivity,
  runAgentCommand,
  type AgentCommand,
  type AgentResult,
} from "@/lib/agent.functions";
import { adminStatusQuery } from "@/lib/queries";
import { useQuery } from "@tanstack/react-query";

type MaintenanceActionProps = {
  command: AgentCommand;
  label: string;
  description: string;
  confirmMessage: string;
  icon: React.ReactNode;
};

export function MaintenanceAction({
  command,
  label,
  description,
  confirmMessage,
  icon,
}: MaintenanceActionProps) {
  const admin = useQuery(adminStatusQuery);
  const run = useServerFn(runAgentCommand);
  const mutation = useMutation({
    mutationFn: () => run({ data: { cmd: command } }),
    onSuccess: (result) => {
      logAgentActivity(command, result.ok).catch(() => {});
      if (result.ok) toast.success(`Comanda ${command} a rulat cu succes`);
      else toast.error(`Comanda ${command} a eșuat: ${result.error ?? `exit ${result.exit_code}`}`);
    },
    onError: (error) => toast.error((error as Error).message),
  });

  if (!admin.data?.isAdmin) return null;

  const result = mutation.data;
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => {
          if (confirm(confirmMessage)) mutation.mutate();
        }}
        disabled={mutation.isPending}
        className="group flex w-full items-center justify-between gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm transition-colors hover:bg-muted disabled:opacity-50"
      >
        <span className="flex items-center gap-2.5">
          {icon}
          <span className="font-medium">{label}</span>
          <span className="text-xs font-normal text-muted-foreground">{description}</span>
        </span>
        <span className="text-xs text-muted-foreground shrink-0">
          {mutation.isPending ? (
            <>
              <RefreshCw className="mr-1 inline h-3 w-3 animate-spin" />
              Rulează...
            </>
          ) : (
            <span className="rounded-lg border border-border bg-muted px-2.5 py-1 text-[11px] font-medium group-hover:text-foreground">
              Rulează
            </span>
          )}
        </span>
      </button>

      {result && <CommandOutput command={command} result={result} />}
    </div>
  );
}

function CommandOutput({ command, result }: { command: AgentCommand; result: AgentResult }) {
  return (
    <div className="rounded-2xl border border-border bg-black/40 p-3">
      <div className={`mb-2 text-xs ${result.ok ? "text-emerald-400" : "text-red-400"}`}>
        {result.ok ? "✓ Succes" : "✗ Eșec"}{" "}
        {result.exit_code != null && `· exit ${result.exit_code}`}
        {result.error && ` · ${result.error}`}
      </div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-[11px] text-muted-foreground">
        {`${result.stdout ?? ""}${result.stderr ? `\n${result.stderr}` : ""}`}
      </pre>
    </div>
  );
}
