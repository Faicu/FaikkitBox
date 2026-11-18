import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  Boxes,
  ChevronRight,
  Clock,
  Cpu,
  Gpu,
  HardDrive,
  MemoryStick,
  Network,
  RotateCcw,
  Terminal,
  Thermometer,
} from "lucide-react";

import { PageShell } from "@/components/PageShell";
import { ServicePill } from "@/components/ServicePill";
import { Meter } from "@/components/Meter";
import { StatCard } from "@/components/StatCard";
import { Sparkline } from "@/components/Sparkline";
import { ErrorCard } from "@/components/ErrorCard";
import {
  ServiceHeaderActions,
  ServiceJobOutput,
  ServiceUpdateBanner,
} from "@/components/ServiceHeaderActions";
import { TehnicSubNav } from "@/components/tehnic/TehnicSubNav";
import { hostHistoryQuery, hostQuery, versionsQuery } from "@/lib/queries";
import {
  DISK_MOUNTS,
  levelFor,
  LEVEL_TEXT,
  smartProblems,
  type HostHistoryPoint,
  type SmartSummary,
} from "@/lib/services/host-rates";
import {
  CPU_TEMP_LIMITS,
  MEM_LIMITS,
  SWAP_LIMITS,
  hostWarnings,
  type HostWarning,
} from "@/lib/services/host-warnings";
import type { HostData } from "@/lib/services/host";
import type { ServiceVersion } from "@/lib/system/versions.functions";
import { requireAdminBeforeLoad } from "@/lib/auth/admin-route-guard";
import { useLiveCounter } from "@/hooks/use-live-counter";

import { formatBytes, formatSpeed, formatDurationHMS } from "@/lib/format";

export const Route = createFileRoute("/sistem")({
  beforeLoad: requireAdminBeforeLoad,
  head: () => ({ meta: [{ title: "Sistem — Monitor Server" }] }),
  component: HostPage,
});

function HostPage() {
  const { data, isLoading, isError, error } = useQuery(hostQuery);
  const versions = useQuery(versionsQuery);
  const ubuntu = (versions.data as Partial<Record<string, ServiceVersion>> | undefined)?.ubuntu;
  const status = isLoading ? "loading" : isError ? "error" : (data?.status ?? "error");
  // Uptime-ul e un contor care doar curge — îl facem să avanseze la secundă
  // local, între răspunsurile serverului. Vezi use-live-counter.ts.
  const liveUptime = useLiveCounter(data?.uptimeSec);
  const history = useQuery(hostHistoryQuery).data ?? [];
  const [showProcesses, setShowProcesses] = useState(false);

  return (
    <PageShell
      title="Sistem"
      subtitle={
        data?.status === "ok"
          ? `${data.hostname ?? "mini-pc"} · ${data.os ?? ""}`
          : "Metrici sistem"
      }
      right={
        <ServiceHeaderActions
          service="ubuntu"
          status={status}
          statusSlot={
            data?.status === "ok" && (data.uptimeSec ?? 9999) < 600 ? (
              <span
                title={`Server repornit recent — uptime ${Math.round((data.uptimeSec ?? 0) / 60)} min`}
                className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-400"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                Repornit recent
              </span>
            ) : (
              <ServicePill status={status} />
            )
          }
        />
      }
    >
      <TehnicSubNav />

      <ServiceUpdateBanner service="ubuntu" />
      <ServiceJobOutput service="ubuntu" />

      {ubuntu?.rebootRequired && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
          <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="min-w-0 text-xs">
            <div className="text-sm font-medium text-amber-400">Sistemul cere repornire</div>
            <div className="text-muted-foreground">
              {ubuntu.rebootPackages?.length
                ? `Pachete: ${ubuntu.rebootPackages.join(", ")}`
                : "Actualizările instalate au nevoie de o repornire."}
            </div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 skeleton-sweep rounded-2xl" />
          ))}
        </div>
      )}

      {isError && !data && (
        <ErrorCard
          title="Metrici indisponibile"
          message={(error as Error)?.message ?? "Eroare necunoscută"}
        />
      )}

      {data?.status === "error" && (
        <ErrorCard title="Metrici indisponibile" message={data.error ?? "Eroare necunoscută"} />
      )}

      {data?.status === "ok" && (
        <>
          <WarningBand warnings={hostWarnings(data)} />
          <SummaryCards data={data} history={history} uptime={liveUptime} />

          {data.apps && data.apps.length > 0 && (
            <section>
              <SectionTitle icon={<Boxes className="h-3.5 w-3.5" />}>Aplicații</SectionTitle>
              <ul className="rounded-2xl glass-card divide-y divide-border stagger-in">
                {data.apps.map((a) => (
                  <li key={a.name} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="font-medium">{a.name}</span>
                    <div className="shrink-0 text-right text-xs tabular-nums">
                      <div>
                        <span className="text-emerald-400">CPU {a.cpu.toFixed(1)}%</span>
                        {" · "}
                        <span className="text-emerald-400">MEM {a.mem.toFixed(1)}%</span>
                      </div>
                      {(a.dlSpeed != null || a.upSpeed != null) && (
                        <div className="text-[10px]">
                          <span className="text-sky-400">↓ {formatSpeed(a.dlSpeed ?? 0)}</span>
                          {" · "}
                          <span className="text-emerald-400">↑ {formatSpeed(a.upSpeed ?? 0)}</span>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.net && data.net.length > 0 && (
            <section>
              <SectionTitle icon={<Network className="h-3.5 w-3.5" />}>Rețea</SectionTitle>
              <ul className="space-y-2 stagger-in">
                {data.net.map((n) => (
                  <li key={n.name} className="rounded-2xl glass-card p-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {n.name.startsWith("en") ? "Ethernet" : "Rețea"}
                      </span>
                      <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {n.name}
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
                    {/* Istoricul e suma plăcilor fizice — pe server, una singură. */}
                    {data.net!.length === 1 && (
                      <Sparkline
                        className="mt-2 h-8"
                        minMax={100 * 1024}
                        series={[
                          { values: history.map((p) => p.rx), className: "text-sky-400" },
                          { values: history.map((p) => p.tx), className: "text-emerald-400" },
                        ]}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <SectionTitle icon={<HardDrive className="h-3.5 w-3.5" />}>Discuri</SectionTitle>
            <div className="rounded-2xl glass-card p-3 space-y-4">
              {DISK_MOUNTS.map(({ mount, label }) => (
                <DiskRow
                  key={mount}
                  label={label}
                  disk={data.disks?.find((x) => x.mount === mount)}
                  history={history.map((p) => p.disks[mount])}
                />
              ))}
            </div>
          </section>

          {data.topProcesses && data.topProcesses.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setShowProcesses((v) => !v)}
                aria-expanded={showProcesses}
                className="mb-2 flex w-full items-center gap-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
              >
                <Terminal className="h-3.5 w-3.5" /> Top procese
                <ChevronRight
                  className={`h-3.5 w-3.5 transition-transform ${showProcesses ? "rotate-90" : ""}`}
                />
              </button>
              {showProcesses && (
                <ul className="rounded-2xl glass-card divide-y divide-border">
                  {data.topProcesses.map((p, i) => (
                    <li key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="truncate pr-2 font-mono text-xs">{p.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        CPU {p.cpu.toFixed(1)}% · MEM {p.mem.toFixed(1)}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </PageShell>
  );
}

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
      {icon} {children}
    </h2>
  );
}

// Apare doar când ceva e peste prag; aceleași praguri ca la carduri.
function WarningBand({ warnings }: { warnings: HostWarning[] }) {
  if (warnings.length === 0) return null;
  const danger = warnings[0].level === "danger";
  return (
    <div
      role="status"
      className={`flex items-start gap-2.5 rounded-2xl border p-3 text-xs ${
        danger
          ? "border-red-500/30 bg-red-500/10 text-red-400"
          : "border-amber-500/30 bg-amber-500/10 text-amber-400"
      }`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <ul className="min-w-0 space-y-0.5">
        {warnings.map((w) => (
          <li
            key={w.text}
            className={`font-medium ${w.level === "danger" ? "text-red-400" : "text-amber-400"}`}
          >
            {w.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SummaryCards({
  data,
  history,
  uptime,
}: {
  data: HostData;
  history: HostHistoryPoint[];
  uptime: number;
}) {
  const spark = (pick: (p: HostHistoryPoint) => number | undefined, className: string) => (
    <Sparkline className="h-full" max={100} series={[{ values: history.map(pick), className }]} />
  );
  const swapPct = data.swapTotalBytes
    ? ((data.swapUsedBytes ?? 0) / data.swapTotalBytes) * 100
    : null;
  const gpuTemp = data.gpu?.temp;
  return (
    <div className="grid grid-cols-2 gap-2">
      <StatCard
        label="Procesor"
        value={`${(data.cpuPercent ?? 0).toFixed(0)}%`}
        sub={`${data.cpuCores ?? "?"} nuclee · încărcare ${data.loadAvg?.[0].toFixed(2)}`}
        icon={<Cpu className="h-4 w-4" />}
        accent={LEVEL_TEXT[levelFor(data.cpuPercent ?? 0, 75, 90)]}
        chart={spark((p) => p.cpu, "text-primary")}
      />
      <StatCard
        label="Memorie"
        value={`${(data.memPercent ?? 0).toFixed(0)}%`}
        sub={`${formatBytes(data.memUsedBytes ?? 0)} / ${formatBytes(data.memTotalBytes ?? 0)}`}
        icon={<MemoryStick className="h-4 w-4" />}
        accent={LEVEL_TEXT[levelFor(data.memPercent ?? 0, ...MEM_LIMITS)]}
        chart={spark((p) => p.mem, "text-primary")}
      />
      <StatCard
        label="Temperatură CPU"
        value={data.cpuTemp != null ? `${data.cpuTemp.toFixed(0)}°C` : "—"}
        icon={<Thermometer className="h-4 w-4" />}
        accent={
          data.cpuTemp != null ? LEVEL_TEXT[levelFor(data.cpuTemp, ...CPU_TEMP_LIMITS)] : undefined
        }
        chart={spark((p) => p.cpuTemp, "text-amber-400")}
      />
      <StatCard
        label="Placă video"
        value={data.gpu?.busyPercent != null ? `${data.gpu.busyPercent.toFixed(0)}%` : "—"}
        sub={gpuTemp != null ? `${gpuTemp.toFixed(0)}°C · transcodare Plex` : undefined}
        icon={<Gpu className="h-4 w-4" />}
        accent={gpuTemp != null ? LEVEL_TEXT[levelFor(gpuTemp, ...CPU_TEMP_LIMITS)] : undefined}
        chart={spark((p) => p.gpuBusy, "text-primary")}
      />
      <StatCard
        label="Swap"
        value={swapPct != null ? `${swapPct.toFixed(0)}%` : "—"}
        sub={
          data.swapTotalBytes
            ? `${formatBytes(data.swapUsedBytes ?? 0)} / ${formatBytes(data.swapTotalBytes)}`
            : "fără swap"
        }
        icon={<ArrowDownUp className="h-4 w-4" />}
        accent={swapPct != null ? LEVEL_TEXT[levelFor(swapPct, ...SWAP_LIMITS)] : undefined}
      />
      <StatCard
        label="Timp funcționare"
        value={formatDurationHMS(uptime)}
        icon={<Clock className="h-4 w-4" />}
        accent="text-emerald-400"
      />
    </div>
  );
}

function DiskRow({
  label,
  disk,
  history,
}: {
  label: string;
  disk: NonNullable<HostData["disks"]>[number] | undefined;
  history: Array<{ r: number; w: number } | undefined>;
}) {
  if (!disk) {
    return (
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-red-400">indisponibil (nemontat?)</span>
      </div>
    );
  }
  const hasIO = disk.readBps != null || disk.writeBps != null;
  return (
    <div className="space-y-1">
      <Meter
        label={label}
        value={disk.percent}
        right={`${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)}`}
      />
      <div className="flex items-center gap-3 text-[11px] tabular-nums">
        {/* Medie pe ultimele 5 s (vezi windowedDiskRate). */}
        {hasIO && (
          <>
            <span>
              <span className="text-muted-foreground">scriere </span>
              <span className="text-sky-400">{formatSpeed(disk.writeBps ?? 0)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">citire </span>
              <span className="text-emerald-400">{formatSpeed(disk.readBps ?? 0)}</span>
            </span>
          </>
        )}
        {disk.temp != null && (
          <span
            className={`ml-auto flex items-center gap-0.5 ${LEVEL_TEXT[levelFor(disk.temp, ...disk.tempLimits)]}`}
            title={disk.mount.includes("hdd") ? "Din SMART, citit din oră în oră" : undefined}
          >
            <Thermometer className="h-3 w-3" />
            {disk.temp.toFixed(0)}°C
          </span>
        )}
      </div>
      <Sparkline
        className="h-6"
        minMax={1024 * 1024}
        series={[
          { values: history.map((p) => p?.w), className: "text-sky-400" },
          { values: history.map((p) => p?.r), className: "text-emerald-400" },
        ]}
      />
      {disk.smart && <SmartLine smart={disk.smart} />}
    </div>
  );
}

function SmartLine({ smart }: { smart: SmartSummary }) {
  const problems = smartProblems(smart);
  const facts = [
    smart.wearPercent != null && `uzură ${smart.wearPercent}%`,
    smart.writtenBytes != null && `scris ${formatBytes(smart.writtenBytes)}`,
    smart.powerOnHours != null && `${smart.powerOnHours.toLocaleString("ro-RO")} h pornit`,
  ].filter(Boolean);
  return (
    <div className="text-[11px] text-muted-foreground">
      {problems.length > 0 ? (
        problems.map((p) => (
          <span key={p.text} className={`mr-2 font-medium ${LEVEL_TEXT[p.level]}`}>
            {p.text}
          </span>
        ))
      ) : (
        <span className="text-emerald-400">Sănătos</span>
      )}
      {facts.length > 0 && <span> · {facts.join(" · ")}</span>}
    </div>
  );
}
