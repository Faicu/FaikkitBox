import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { RefreshCw, PlayCircle, Images, Download, PackageCheck, ArrowUpCircle, Rocket, GitCommitHorizontal, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { PageShell } from "@/components/PageShell";
import { adminStatusQuery, versionsQuery, recentCommitsQuery } from "@/lib/queries";
import { runAgentCommand, getDeployLog, type AgentCommand, type AgentResult } from "@/lib/agent.functions";
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
  const [deployLog, setDeployLog] = useState<string>("");

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
    >
      <DeploySection onDeploy={() => m.mutate("deploy_app")} isDeploying={running === "deploy_app"} onLogUpdate={setDeployLog} />

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Versiuni servicii</h2>
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

      <RecentCommitsSection />

      {running && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Se rulează <span className="font-mono">{running}</span>... poate dura câteva minute, nu închide pagina.
        </div>
      )}

      {(output || deployLog) && (
        <section className="space-y-1">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Ieșire: {deployLog && !output ? "deploy_app" : output?.cmd}
          </h2>
          <div className="rounded-2xl border border-border bg-black/40 p-3">
            {output && (
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className={`text-xs ${output.res.ok ? "text-emerald-400" : "text-red-400"}`}>
                  {output.res.ok ? "✓ Succes" : "✗ Eșec"} {output.res.exit_code != null && `· exit ${output.res.exit_code}`}
                  {output.res.error && ` · ${output.res.error}`}
                </div>
                <button
                  onClick={() => {
                    const text = deployLog || `${output.res.stdout ?? ""}${output.res.stderr ? `\n${output.res.stderr}` : ""}`;
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
            )}
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-[11px] text-muted-foreground">
              {deployLog || `${output?.res.stdout ?? ""}${output?.res.stderr ? `\n${output.res.stderr}` : ""}`}
            </pre>
          </div>
        </section>
      )}

    </PageShell>
  );
}

function RecentCommitsSection() {
  const commits = useQuery(recentCommitsQuery);

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <GitCommitHorizontal className="h-3.5 w-3.5 text-sky-400" /> Ultimele commits (GitHub)
      </h2>
      <div className="rounded-2xl border border-border bg-card p-3">
        {commits.isLoading && <div className="text-sm text-muted-foreground">Se încarcă commit-urile...</div>}
        {commits.data?.status === "error" && (
          <div className="text-xs text-red-400">Nu am putut încărca commit-urile: {commits.data.error}</div>
        )}
        {commits.data?.status === "ok" && commits.data.commits.length === 0 && (
          <div className="text-sm text-muted-foreground">Niciun commit găsit.</div>
        )}
        {commits.data?.status === "ok" && commits.data.commits.length > 0 && (
          <div className="divide-y divide-border/60">
            {commits.data.commits.map((c) => (
              <div key={c.sha} className="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0">
                <GitCommitHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium leading-tight break-words">{c.message}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                    <span>{c.author}</span>
                    {c.date && (
                      <span>
                        ·{" "}
                        {new Date(c.date).toLocaleString("ro-RO", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "Europe/Bucharest",
                        })}
                      </span>
                    )}
                  </div>
                </div>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                  title="Vezi pe GitHub"
                >
                  {c.shortSha} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function DeploySection({ onDeploy, isDeploying, onLogUpdate }: { onDeploy: () => void; isDeploying: boolean; onLogUpdate: (log: string) => void }) {
  const getLogFn = useServerFn(getDeployLog);
  const [polling, setPolling] = useState(false);
  const [deployStarted, setDeployStarted] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    if (!deployStarted) return;
    setPolling(true);
    let active = true;

    async function fetchLog() {
      try {
        const res = await getLogFn();
        if (active) {
          onLogUpdate(res.lines);
          setReconnecting(false);
          // Oprește polling-ul când deploy.sh a terminat
          const done = res.lines.includes("[deploy] gata:") || res.lines.includes("[deploy] nimic nou.");
          if (done) {
            setPolling(false);
            clearInterval(id);
          }
        }
      } catch {
        if (active) setReconnecting(true);
      }
    }

    fetchLog();
    const id = setInterval(fetchLog, 2000);
    const stop = setTimeout(() => { clearInterval(id); setPolling(false); }, 10 * 60_000);

    return () => {
      active = false;
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [deployStarted, getLogFn, onLogUpdate]);

  function handleDeploy() {
    if (!confirm("Pornești deploy-ul manual? Aplicația va fi restartată — poate dura ~2-3 minute.")) return;
    setDeployStarted(true);
    onLogUpdate("");
    onDeploy();
  }

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Rocket className="h-3.5 w-3.5 text-emerald-400" /> Deploy FaikkitBox
      </h2>
      <button
        onClick={handleDeploy}
        disabled={isDeploying}
        className="flex w-full items-center justify-between gap-2 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3 text-sm hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
      >
        <span className="flex items-center gap-2.5">
          <Rocket className="h-4 w-4 text-emerald-400 shrink-0" />
          <span className="font-medium">Deploy manual</span>
          <span className="text-xs text-muted-foreground font-normal">git pull + build + restart</span>
        </span>
        <span className="text-xs shrink-0 flex items-center gap-1.5">
          {isDeploying ? (
            <span className="flex items-center gap-1.5 text-emerald-400"><RefreshCw className="h-3 w-3 animate-spin" />Se pornește...</span>
          ) : deployStarted && (polling || reconnecting) ? (
            <span className="flex items-center gap-1.5 text-emerald-400">
              <RefreshCw className="h-3 w-3 animate-spin" />
              {reconnecting ? "Repornire..." : "Deploy în curs"}
            </span>
          ) : deployStarted && !polling ? (
            <span className="text-emerald-400">✓ Finalizat</span>
          ) : (
            <span className="rounded-lg bg-emerald-500/15 border border-emerald-500/25 px-2.5 py-1 text-[11px] font-medium text-emerald-400">Rulează</span>
          )}
        </span>
      </button>
      {deployStarted && (polling || reconnecting) && (
        <div className="px-1 text-[11px] text-muted-foreground">
          {reconnecting ? "⏳ Aplicația repornește, reconectare..." : "Urmăresc log-ul în timp real — vezi secțiunea Ieșire de mai jos."}
        </div>
      )}
    </section>
  );
}

function VersionCard({
  icon,
  v,
  restartCmd,
  updateCmd,
  flushDnsCmd,
  running,
  onRun,
}: {
  icon: React.ReactNode;
  v: ServiceVersion;
  restartCmd: AgentCommand;
  updateCmd?: AgentCommand;
  flushDnsCmd?: AgentCommand;
  running: AgentCommand | null;
  onRun: (c: AgentCommand) => void;
}) {
  const up = v.upToDate;
  const badge = up === undefined
    ? { text: "Necunoscut", cls: "bg-muted text-muted-foreground" }
    : up
    ? { text: "La zi", cls: "bg-emerald-500/20 text-emerald-400" }
    : { text: "Actualizare disponibilă", cls: "bg-amber-500/20 text-amber-400" };

  // Dacă e qBit — butonul de restart face flush DNS + restart
  const effectiveRestartCmd = flushDnsCmd ?? restartCmd;
  const isRestarting = running === restartCmd || running === (flushDnsCmd ?? restartCmd);

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
          title={flushDnsCmd ? "Clear DNS Cache + repornește serviciul qBittorrent" : undefined}
          onClick={() => {
            if (flushDnsCmd) {
              if (!confirm("Șterge DNS Cache și repornește qBittorrent?\n\nAceastă acțiune va:\n• Curăța cache-ul DNS\n• Reporni serviciul qBittorrent")) return;
              onRun(flushDnsCmd);
            } else {
              onRun(restartCmd);
            }
          }}
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