import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { RefreshCw, PlayCircle, Images, PackageCheck, ArrowUpCircle } from "lucide-react";
import { toast } from "sonner";

import { PageShell } from "@/components/PageShell";
import { adminStatusQuery, versionsQuery } from "@/lib/queries";
import { runAgentCommand, logAgentActivity, type AgentCommand, type AgentResult } from "@/lib/agent.functions";
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
  const run = useServerFn(runAgentCommand);
  const [output, setOutput] = useState<{ cmd: string; res: AgentResult } | null>(null);

  const m = useMutation({
    mutationFn: (cmd: AgentCommand) => run({ data: { cmd } }),
    onSuccess: (res, cmd) => {
      setOutput({ cmd, res });
      logAgentActivity(cmd, res.ok).catch(() => {});
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
    >
      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sistem</h2>
        <button
          onClick={() => {
            if (!confirm("Actualizezi complet Ubuntu?\n\napt-get update + apt-get upgrade -y\n\nPoate dura câteva minute.")) return;
            m.mutate("apt_full_upgrade");
          }}
          disabled={running === "apt_full_upgrade"}
          className="group flex w-full items-center justify-between gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm hover:bg-muted disabled:opacity-50 transition-colors"
        >
          <span className="flex items-center gap-2.5">
            <PackageCheck className="h-4 w-4 text-emerald-400 shrink-0" />
            <span className="font-medium">Actualizează Ubuntu</span>
            <span className="text-xs text-muted-foreground font-normal">apt-get update + upgrade</span>
          </span>
          <span className="text-xs text-muted-foreground shrink-0">
            {running === "apt_full_upgrade" ? <><RefreshCw className="inline h-3 w-3 animate-spin mr-1" />Rulează...</> : <span className="rounded-lg bg-muted border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground group-hover:text-foreground">Rulează</span>}
          </span>
        </button>
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Versiuni servicii</h2>
        {versions.isLoading && <div className="text-sm text-muted-foreground">Se încarcă versiunile...</div>}
        {versions.data && (
          <div className="space-y-2">
            <VersionCard icon={<PlayCircle className="h-5 w-5 text-amber-400" />} v={versions.data.plex}
              restartCmd="restart_plex" updateCmd="update_plex" running={running} onRun={m.mutate} />
            <VersionCard icon={<Images className="h-5 w-5 text-purple-400" />} v={versions.data.immich}
              restartCmd="restart_immich" updateCmd="update_immich" running={running} onRun={m.mutate} />
          </div>
        )}
      </section>

      {running && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Se rulează <span className="font-mono">{running}</span>... poate dura câteva minute, nu închide pagina.
        </div>
      )}

      {output && (
        <section className="space-y-1">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Ieșire: {output.cmd}
          </h2>
          <div className="rounded-2xl border border-border bg-black/40 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className={`text-xs ${output.res.ok ? "text-emerald-400" : "text-red-400"}`}>
                {output.res.ok ? "✓ Succes" : "✗ Eșec"} {output.res.exit_code != null && `· exit ${output.res.exit_code}`}
                {output.res.error && ` · ${output.res.error}`}
              </div>
              <button
                onClick={() => {
                  const text = `${output.res.stdout ?? ""}${output.res.stderr ? `\n${output.res.stderr}` : ""}`;
                  navigator.clipboard.writeText(text).then(
                    () => toast.success("Copiat"),
                    () => toast.error("Nu s-a putut copia"),
                  );
                }}
                className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                Copiază
              </button>
            </div>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-[11px] text-muted-foreground">
              {`${output.res.stdout ?? ""}${output.res.stderr ? `\n${output.res.stderr}` : ""}`}
            </pre>
          </div>
        </section>
      )}
    </PageShell>
  );
}

function VersionCard({
  icon,
  v,
  restartCmd,
  updateCmd,
  running,
  onRun,
}: {
  icon: React.ReactNode;
  v: ServiceVersion;
  restartCmd: AgentCommand;
  updateCmd?: AgentCommand;
  running: AgentCommand | null;
  onRun: (c: AgentCommand) => void;
}) {
  const up = v.upToDate;
  const badge = up === undefined
    ? { text: "Necunoscut", cls: "bg-muted text-muted-foreground" }
    : up
    ? { text: "La zi", cls: "bg-emerald-500/20 text-emerald-400" }
    : { text: "Actualizare disponibilă", cls: "bg-amber-500/20 text-amber-400" };

  const isRestarting = running === restartCmd;

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
          disabled={isRestarting}
          className="rounded-lg border border-sky-500/30 bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-400 hover:bg-sky-500/25 disabled:opacity-50"
        >
          {isRestarting ? "Se repornește..." : "Repornește"}
        </button>
        {updateCmd && v.upToDate === false && (
          <button
            onClick={() => {
              if (!confirm(`Actualizezi ${v.name}? Serviciul va fi oprit (down), imaginea actualizată (pull) și repornit (up -d). Poate dura câteva minute.`)) return;
              onRun(updateCmd);
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
