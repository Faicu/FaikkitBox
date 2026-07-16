import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Terminal,
  Boxes,
  HardDriveDownload,
  PackageCheck,
} from "lucide-react";
import { toast } from "sonner";

import { PageShell } from "@/components/PageShell";
import { ServicePill } from "@/components/ServicePill";
import { Meter } from "@/components/Meter";
import { StatCard } from "@/components/StatCard";
import { ErrorCard } from "@/components/ErrorCard";
import { CommandOutput } from "@/components/ServiceHeaderActions";
import { logAgentActivity, runAgentCommand } from "@/lib/agent.functions";
import { adminStatusQuery, hostQuery } from "@/lib/queries";

import { formatBytes, formatSpeed, formatDurationHMS } from "@/lib/format";

export const Route = createFileRoute("/sistem")({
  head: () => ({ meta: [{ title: "Sistem — Monitor Server" }] }),
  component: HostPage,
});

function HostPage() {
  const { data, isLoading } = useQuery(hostQuery);
  const { data: adminData } = useQuery(adminStatusQuery);
  const isAdmin = adminData?.isAdmin ?? false;
  const status = isLoading ? "loading" : (data?.status ?? "error");

  const runCmd = useServerFn(runAgentCommand);
  const [lastCmd, setLastCmd] = useState<{ output: string; ok: boolean } | null>(null);

  const upgrade = useMutation({
    mutationFn: async () => {
      const result = await runCmd({ data: { command: "apt_full_upgrade" } });
      await logAgentActivity("apt_full_upgrade", result.ok ? "success" : "error");
      return result;
    },
    onSuccess: (result) => setLastCmd(result),
    onError: (err) => {
      toast.error("Eroare la actualizare");
      console.error(err);
    },
  });

  function handleUpgrade() {
    if (
      !confirm(
        "Actualizezi complet Ubuntu?\n\napt-get update + apt-get upgrade -y\n\nPoate dura câteva minute.",
      )
    )
      return;
    upgrade.mutate();
  }

  return (
    <PageShell
      title="Sistem"
      subtitle={
        data?.status === "ok"
          ? `${data.hostname ?? "mini-pc"} · ${data.os ?? ""}`
          : "Metrici sistem"
      }
      right={
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={handleUpgrade}
              disabled={upgrade.isPending}
              className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400 active:scale-95 transition-all disabled:opacity-50"
            >
              <PackageCheck className="h-3.5 w-3.5" />
              {upgrade.isPending ? "Se actualizează…" : "Update Ubuntu"}
            </button>
          )}
          <ServicePill status={status} />
        </div>
      }
    >
      {lastCmd && <CommandOutput output={lastCmd.output} ok={lastCmd.ok} />}

      {data?.status === "error" && (
        <ErrorCard title="Metrici indisponibile" message={data.error ?? "Eroare necunoscută"} />
      )}

      {data?.status === "ok" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              label="Procesor"
              value={`${(data.cpuPercent ?? 0).toFixed(0)}%`}
              sub={`${data.cpuCores ?? "?"} nuclee · încărcare ${data.loadAvg?.[0].toFixed(2)}`}
              icon={<Cpu className="h-4 w-4" />}
              accent="text-emerald-400"
            />
            <StatCard
              label="Memorie"
              value={`${(data.memPercent ?? 0).toFixed(0)}%`}
              sub={`${formatBytes(data.memUsedBytes ?? 0)} / ${formatBytes(data.memTotalBytes ?? 0)}`}
              icon={<MemoryStick className="h-4 w-4" />}
              accent="text-emerald-400"
            />
            <StatCard
              label="Temperatură CPU"
              value={
                data.sensors?.[0]
                  ? `${data.sensors[0].value.toFixed(0)}${data.sensors[0].unit || "°C"}`
                  : "—"
              }
              icon={<Cpu className="h-4 w-4" />}
              accent="text-emerald-400"
            />
            <StatCard
              label="Timp funcționare"
              value={formatDurationHMS(data.uptimeSec ?? 0)}
              icon={<Cpu className="h-4 w-4" />}
              accent="text-emerald-400"
            />
          </div>

          {data.apps && data.apps.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Boxes className="h-3.5 w-3.5" /> Aplicații
              </h2>
              <ul className="rounded-2xl border border-border bg-card divide-y divide-border">
                {data.apps.map((a) => (
                  <li key={a.name} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="font-medium">{a.name}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                        {a.source}
                      </span>
                    </div>
                    <div className="shrink-0 text-right text-xs tabular-nums">
                      <div>
                        <span className="text-emerald-400">CPU {a.cpu.toFixed(1)}%</span>
                        {" · "}
                        <span className="text-emerald-400">MEM {a.mem.toFixed(1)}%</span>
                      </div>
                      {(a.netRx != null || a.netTx != null) && (
                        <div className="text-[10px] text-muted-foreground">
                          <span className="text-sky-400">↓ {formatSpeed(a.netRx ?? 0)}</span>
                          {" · "}
                          <span className="text-emerald-400">↑ {formatSpeed(a.netTx ?? 0)}</span>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <HardDrive className="h-3.5 w-3.5" /> Discuri
            </h2>
            <div className="rounded-2xl border border-border bg-card p-3 space-y-3">
              {(data.disks ?? [])
                .filter((d) => ["/", "/media/ssd2tb", "/media/hddextern"].includes(d.mount))
                .sort((a, b) => {
                  const order = ["/", "/media/ssd2tb", "/media/hddextern"];
                  return order.indexOf(a.mount) - order.indexOf(b.mount);
                })
                .map((d, i) => {
                  const labels: Record<string, string> = {
                    "/": "M.2 Bază",
                    "/media/ssd2tb": "M.2 2TB",
                    "/media/hddextern": "HDD Extern",
                  };
                  const hasIO = d.readBps != null || d.writeBps != null;
                  return (
                    <div key={i} className="space-y-1">
                      <Meter
                        label={labels[d.mount] ?? d.mount}
                        value={d.percent}
                        right={`${formatBytes(d.usedBytes)} / ${formatBytes(d.totalBytes)}`}
                      />
                      {hasIO && (
                        <div className="flex gap-3 pl-0 text-[11px] tabular-nums">
                          <span className="text-sky-400">↓ {formatSpeed(d.readBps ?? 0)}</span>
                          <span className="text-emerald-400">↑ {formatSpeed(d.writeBps ?? 0)}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </section>

          {data.net && data.net.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Network className="h-3.5 w-3.5" /> Rețea
              </h2>
              <ul className="space-y-2">
                {data.net.map((n) => (
                  <li key={n.name} className="rounded-2xl border border-border bg-card p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {n.name.startsWith("en") ? "Ethernet" : "Rețea"}
                        </span>
                        <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {n.name}
                        </span>
                      </div>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Trafic live
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs tabular-nums">
                      <div className="rounded-lg bg-sky-500/10 px-2.5 py-1.5 text-sky-400">
                        <div className="text-[10px] uppercase tracking-wide text-sky-300/70">
                          Download
                        </div>
                        <div className="font-medium">↓ {formatSpeed(n.rxSec)}</div>
                      </div>
                      <div className="rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-emerald-400">
                        <div className="text-[10px] uppercase tracking-wide text-emerald-300/70">
                          Upload
                        </div>
                        <div className="font-medium">↑ {formatSpeed(n.txSec)}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.topProcesses && data.topProcesses.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Terminal className="h-3.5 w-3.5" /> Top procese
              </h2>
              <ul className="rounded-2xl border border-border bg-card divide-y divide-border">
                {data.topProcesses.map((p, i) => (
                  <li key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="truncate pr-2 font-mono text-xs">{p.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      CPU {p.cpu.toFixed(0)}% · MEM {p.mem.toFixed(0)}%
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.diskIO && data.diskIO.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <HardDriveDownload className="h-3.5 w-3.5" /> Top I/O disc
              </h2>
              <ul className="rounded-2xl border border-border bg-card divide-y divide-border">
                {data.diskIO.map((p, i) => (
                  <li key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="truncate pr-2 font-mono text-xs">{p.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      R {formatBytes(p.ioRead)} · W {formatBytes(p.ioWrite)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </PageShell>
  );
}
