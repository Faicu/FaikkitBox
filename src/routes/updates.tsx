import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { RefreshCw, PlayCircle, Images, Download, Terminal, Trash2, PackageCheck, PackageOpen } from "lucide-react";
import { toast } from "sonner";

import { PageShell } from "@/components/PageShell";
import { ErrorCard } from "@/components/ErrorCard";
import { adminStatusQuery, versionsQuery } from "@/lib/queries";
import { runAgentCommand, type AgentCommand, type AgentResult } from "@/lib/agent.functions";
import type { ServiceVersion } from "@/lib/versions.functions";

export const Route = createFileRoute("/updates")({
  head: () => ({ meta: [{ title: "Actualizări — Monitor Server" }] }),
  component: UpdatesPage,
});

function UpdatesPage() {
  const navigate = useNavigate();
  const admin = useQuery(adminStatusQuery);
  useEffect(() => {
    if (admin.data && !admin.data.isAdmin) navigate({ to: "/login" });
  }, [admin.data, navigate]);

  if (admin.isLoading) return <PageShell title="Actualizări"><div className="text-sm text-muted-foreground">Se verifică...</div></PageShell>;
  if (!admin.data?.isAdmin) return null;

  return <UpdatesInner />;
}

function UpdatesInner() {
  const versions = useQuery(versionsQuery);
  const qc = useQueryClient();
  const run = useServerFn(runAgentCommand);
  const [output, setOutput] = useState<{ cmd: string; res: AgentResult } | null>(null);

  const m = useMutation({
    mutationFn: (cmd: AgentCommand) => run({ data: { cmd } }),
    onSuccess: (res, cmd) => {
      setOutput({ cmd, res });
      if (res.ok) toast.success(`Comanda ${cmd} a rulat cu succes`);
      else toast.error(`Comanda ${cmd} a eșuat: ${res.error ?? `exit ${res.exit_code}`}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const running = m.isPending ? (m.variables as AgentCommand) : null;

  return (
    <PageShell
      title="Actualizări"
      subtitle="Versiuni servicii și mentenanță server"
      right={
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ["versions"] })}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
          aria-label="Reîmprospătează versiuni"
        >
          <RefreshCw className={`h-4 w-4 ${versions.isFetching ? "animate-spin" : ""}`} />
        </button>
      }
    >
      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Versiuni servicii</h2>
        {versions.isLoading && <div className="text-sm text-muted-foreground">Se încarcă versiunile...</div>}
        {versions.data && (
          <div className="space-y-2">
            <VersionCard icon={<PlayCircle className="h-5 w-5 text-amber-400" />} v={versions.data.plex}
              restartCmd="restart_plex" running={running} onRun={m.mutate} />
            <VersionCard icon={<Images className="h-5 w-5 text-purple-400" />} v={versions.data.immich}
              restartCmd="restart_immich" running={running} onRun={m.mutate} />
            <VersionCard icon={<Download className="h-5 w-5 text-sky-400" />} v={versions.data.qbit}
              restartCmd="restart_qbit" running={running} onRun={m.mutate} />
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
          <Terminal className="h-3.5 w-3.5" /> Sistem Ubuntu
        </h2>
        <div className="grid grid-cols-1 gap-2 rounded-2xl border border-border bg-card p-3">
          <ActionButton icon={<PackageOpen className="h-4 w-4" />} label="apt-get update" cmd="apt_update" running={running} onRun={m.mutate} />
          <ActionButton icon={<PackageCheck className="h-4 w-4" />} label="apt-get upgrade -y" cmd="apt_upgrade" running={running} onRun={m.mutate} />
          <ActionButton icon={<Trash2 className="h-4 w-4" />} label="Clear DNS Cache (resolvectl flush-caches)" cmd="flush_dns" running={running} onRun={m.mutate} />
        </div>
      </section>

      {output && (
        <section className="space-y-1">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Ieșire: {output.cmd}
          </h2>
          <div className="rounded-2xl border border-border bg-black/40 p-3">
            <div className={`text-xs mb-2 ${output.res.ok ? "text-emerald-400" : "text-red-400"}`}>
              {output.res.ok ? "✓ Succes" : "✗ Eșec"} {output.res.exit_code != null && `· exit ${output.res.exit_code}`}
              {output.res.error && ` · ${output.res.error}`}
            </div>
            {(output.res.stdout || output.res.stderr) && (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-[11px] text-muted-foreground">
{output.res.stdout ?? ""}{output.res.stderr ? `\n${output.res.stderr}` : ""}
              </pre>
            )}
          </div>
        </section>
      )}

      {!process.env && null}
      <ErrorHintIfNoAgent />
    </PageShell>
  );
}

function ErrorHintIfNoAgent() {
  return null;
}

function VersionCard({
  icon,
  v,
  restartCmd,
  running,
  onRun,
}: {
  icon: React.ReactNode;
  v: ServiceVersion;
  restartCmd: AgentCommand;
  running: AgentCommand | null;
  onRun: (c: AgentCommand) => void;
}) {
  const up = v.upToDate;
  const badge = up === undefined
    ? { text: "Necunoscut", cls: "bg-muted text-muted-foreground" }
    : up
    ? { text: "La zi", cls: "bg-emerald-500/20 text-emerald-400" }
    : { text: "Actualizare disponibilă", cls: "bg-amber-500/20 text-amber-400" };

  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <div className="text-sm font-semibold">{v.name}</div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}>{badge.text}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-muted/40 px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Curentă</div>
          <div className="font-mono text-sm">{v.current ?? "—"}</div>
        </div>
        <div className="rounded-lg bg-muted/40 px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Ultima</div>
          <div className="font-mono text-sm">{v.latest ?? "—"}</div>
        </div>
      </div>
      {v.error && <div className="mt-2 text-[11px] text-red-400">{v.error}</div>}
      <div className="mt-2 flex flex-wrap gap-2">
        {v.changelog && (
          <a
            href={v.changelog}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Changelog
          </a>
        )}
        <button
          onClick={() => onRun(restartCmd)}
          disabled={running === restartCmd}
          className="rounded-lg border border-sky-500/30 bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-400 hover:bg-sky-500/25 disabled:opacity-50"
        >
          {running === restartCmd ? "Se repornește..." : "Repornește serviciul"}
        </button>
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  cmd,
  running,
  onRun,
}: {
  icon: React.ReactNode;
  label: string;
  cmd: AgentCommand;
  running: AgentCommand | null;
  onRun: (c: AgentCommand) => void;
}) {
  const isRunning = running === cmd;
  return (
    <button
      onClick={() => onRun(cmd)}
      disabled={isRunning}
      className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <span className="text-xs text-muted-foreground">{isRunning ? "rulează..." : "Rulează"}</span>
    </button>
  );
}