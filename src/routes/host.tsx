import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Cpu, MemoryStick, HardDrive, Network, Thermometer, Terminal } from "lucide-react";

import { PageShell } from "@/components/PageShell";
import { ServicePill } from "@/components/ServicePill";
import { Meter } from "@/components/Meter";
import { StatCard } from "@/components/StatCard";
import { ErrorCard } from "@/components/ErrorCard";
import { hostQuery } from "@/lib/queries";
import { formatBytes, formatSpeed, formatDuration } from "@/lib/format";

export const Route = createFileRoute("/host")({
  head: () => ({ meta: [{ title: "Host — Server Monitor" }] }),
  component: HostPage,
});

function HostPage() {
  const { data, isLoading } = useQuery(hostQuery);
  const status = isLoading ? "loading" : data?.status ?? "error";

  return (
    <PageShell
      title="Host"
      subtitle={data?.status === "ok" ? `${data.hostname ?? "mini-pc"} · ${data.os ?? ""}` : "System metrics (Glances)"}
      right={<ServicePill status={status} />}
    >
      {data?.status === "error" && (
        <>
          <ErrorCard title="Glances not reachable" message={data.error ?? "Unknown error"} />
          <GlancesSetup />
        </>
      )}

      {data?.status === "ok" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatCard label="CPU" value={`${(data.cpuPercent ?? 0).toFixed(0)}%`} sub={`${data.cpuCores ?? "?"} cores · load ${data.loadAvg?.[0].toFixed(2)}`} icon={<Cpu className="h-4 w-4" />} accent="text-emerald-400" />
            <StatCard label="Memory" value={`${(data.memPercent ?? 0).toFixed(0)}%`} sub={`${formatBytes(data.memUsedBytes ?? 0)} / ${formatBytes(data.memTotalBytes ?? 0)}`} icon={<MemoryStick className="h-4 w-4" />} accent="text-emerald-400" />
            <StatCard label="Swap" value={`${(data.swapPercent ?? 0).toFixed(0)}%`} icon={<MemoryStick className="h-4 w-4" />} accent="text-emerald-400" />
            <StatCard label="Uptime" value={formatDuration(data.uptimeSec ?? 0)} icon={<Cpu className="h-4 w-4" />} accent="text-emerald-400" />
          </div>

          <section>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <HardDrive className="h-3.5 w-3.5" /> Disks
            </h2>
            <div className="rounded-2xl border border-border bg-card p-3 space-y-3">
              {(data.disks ?? []).map((d, i) => (
                <Meter
                  key={i}
                  label={d.mount}
                  value={d.percent}
                  right={`${formatBytes(d.usedBytes)} / ${formatBytes(d.totalBytes)}`}
                />
              ))}
              {(!data.disks || data.disks.length === 0) && <div className="text-sm text-muted-foreground">No disks reported.</div>}
            </div>
          </section>

          {data.net && data.net.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Network className="h-3.5 w-3.5" /> Network
              </h2>
              <ul className="rounded-2xl border border-border bg-card divide-y divide-border">
                {data.net.map((n) => (
                  <li key={n.name} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="font-medium">{n.name}</span>
                    <span className="text-xs tabular-nums">
                      <span className="text-sky-400">↓ {formatSpeed(n.rxSec)}</span>{" · "}
                      <span className="text-emerald-400">↑ {formatSpeed(n.txSec)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.sensors && data.sensors.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Thermometer className="h-3.5 w-3.5" /> Sensors
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {data.sensors.map((s, i) => (
                  <StatCard key={i} label={s.label} value={`${s.value.toFixed(0)}${s.unit || "°"}`} />
                ))}
              </div>
            </section>
          )}

          {data.topProcesses && data.topProcesses.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Terminal className="h-3.5 w-3.5" /> Top processes
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
        </>
      )}
    </PageShell>
  );
}

function GlancesSetup() {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 text-sm">
      <h3 className="font-semibold">Enable host metrics</h3>
      <p className="mt-1 text-muted-foreground">
        Install <b>Glances</b> on your mini-PC, expose its web/REST API behind HTTPS,
        then add a <code className="rounded bg-muted px-1">GLANCES_URL</code> secret.
      </p>
      <pre className="mt-2 overflow-auto rounded-lg bg-muted p-3 text-[11px] leading-relaxed">
{`# Debian / Ubuntu
sudo apt install glances

# Run as a service (systemd)
sudo tee /etc/systemd/system/glances.service > /dev/null <<'EOF'
[Unit]
Description=Glances
After=network.target

[Service]
ExecStart=/usr/bin/glances -w --disable-webui
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now glances
# Now reverse-proxy https://glances.example.com -> localhost:61208`}
      </pre>
      <p className="mt-3 text-xs text-muted-foreground">
        Then ask me to add the <code className="rounded bg-muted px-1">GLANCES_URL</code> secret.
      </p>
    </div>
  );
}