import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Terminal,
  Boxes,
  Thermometer,
  Clock,
  RotateCcw,
  Bell,
  BellOff,
} from "lucide-react";
import { usePushNotifications } from "@/hooks/use-push-notifications";

import { PageShell } from "@/components/PageShell";
import { ServicePill } from "@/components/ServicePill";
import { Meter } from "@/components/Meter";
import { StatCard } from "@/components/StatCard";
import { ErrorCard } from "@/components/ErrorCard";
import {
  ServiceHeaderActions,
  ServiceJobOutput,
  ServiceUpdateBanner,
} from "@/components/ServiceHeaderActions";
import { TehnicSubNav } from "@/components/tehnic/TehnicSubNav";
import { hostQuery, versionsQuery } from "@/lib/queries";
import { levelFor, LEVEL_TEXT } from "@/lib/services/host-rates";
import type { ServiceVersion } from "@/lib/system/versions.functions";
import { requireAdminBeforeLoad } from "@/lib/auth/admin-route-guard";
import { useLiveCounter } from "@/hooks/use-live-counter";

import { formatBytes, formatSpeed, formatDurationHMS } from "@/lib/format";

export const Route = createFileRoute("/sistem")({
  beforeLoad: requireAdminBeforeLoad,
  head: () => ({ meta: [{ title: "Sistem — Monitor Server" }] }),
  component: HostPage,
});

const DISKS = [
  { mount: "/", label: "M.2 Bază" },
  { mount: "/media/ssd2tb", label: "M.2 2TB" },
  { mount: "/media/hddextern", label: "HDD Extern" },
];

function HostPage() {
  const { data, isLoading, isError, error } = useQuery(hostQuery);
  const versions = useQuery(versionsQuery);
  const ubuntu = (versions.data as Partial<Record<string, ServiceVersion>> | undefined)?.ubuntu;
  const status = isLoading ? "loading" : isError ? "error" : (data?.status ?? "error");
  // Uptime-ul e un contor care doar curge — îl facem să avanseze la secundă
  // local, între răspunsurile serverului. Vezi use-live-counter.ts.
  const liveUptime = useLiveCounter(data?.uptimeSec);
  const push = usePushNotifications();

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
          {Array.from({ length: 4 }).map((_, i) => (
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
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              label="Procesor"
              value={`${(data.cpuPercent ?? 0).toFixed(0)}%`}
              sub={`${data.cpuCores ?? "?"} nuclee · încărcare ${data.loadAvg?.[0].toFixed(2)}`}
              icon={<Cpu className="h-4 w-4" />}
              accent={LEVEL_TEXT[levelFor(data.cpuPercent ?? 0, 75, 90)]}
            />
            <StatCard
              label="Memorie"
              value={`${(data.memPercent ?? 0).toFixed(0)}%`}
              sub={`${formatBytes(data.memUsedBytes ?? 0)} / ${formatBytes(data.memTotalBytes ?? 0)}`}
              icon={<MemoryStick className="h-4 w-4" />}
              accent={LEVEL_TEXT[levelFor(data.memPercent ?? 0, 80, 92)]}
            />
            <StatCard
              label="Temperatură CPU"
              value={
                data.sensors?.[0]
                  ? `${data.sensors[0].value.toFixed(0)}${data.sensors[0].unit || "°C"}`
                  : "—"
              }
              icon={<Thermometer className="h-4 w-4" />}
              accent={
                data.sensors?.[0] ? LEVEL_TEXT[levelFor(data.sensors[0].value, 80, 90)] : undefined
              }
            />
            <StatCard
              label="Timp funcționare"
              value={formatDurationHMS(liveUptime)}
              icon={<Clock className="h-4 w-4" />}
              accent="text-emerald-400"
            />
          </div>

          {data.apps && data.apps.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Boxes className="h-3.5 w-3.5" /> Aplicații
              </h2>
              <ul className="rounded-2xl glass-card divide-y divide-border stagger-in">
                {data.apps.map((a) => (
                  <li key={a.name} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="font-medium">{a.name}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                        {a.source}
                      </span>
                    </div>
                    <div className="shrink-0 text-right text-xs tabular-nums">
                      <span className="text-emerald-400">CPU {a.cpu.toFixed(1)}%</span>
                      {" · "}
                      <span className="text-emerald-400">MEM {a.mem.toFixed(1)}%</span>
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
            <div className="rounded-2xl glass-card p-3 space-y-3">
              {DISKS.map(({ mount, label }) => {
                const d = (data.disks ?? []).find((x) => x.mount === mount);
                if (!d) {
                  return (
                    <div key={mount} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="text-amber-400">indisponibil (nemontat?)</span>
                    </div>
                  );
                }
                const hasIO = d.readBps != null || d.writeBps != null;
                return (
                  <div key={mount} className="space-y-1">
                    <Meter
                      label={label}
                      value={d.percent}
                      right={`${formatBytes(d.usedBytes)} / ${formatBytes(d.totalBytes)}`}
                    />
                    {hasIO && (
                      <div className="flex gap-3 pl-0 text-[11px] tabular-nums">
                        {/* Medie pe ultimele 5 s (vezi windowedDiskRate). */}
                        <span>
                          <span className="text-muted-foreground">scriere </span>
                          <span className="text-sky-400">{formatSpeed(d.writeBps ?? 0)}</span>
                        </span>
                        <span>
                          <span className="text-muted-foreground">citire </span>
                          <span className="text-emerald-400">{formatSpeed(d.readBps ?? 0)}</span>
                        </span>
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
              <ul className="space-y-2 stagger-in">
                {data.net.map((n) => (
                  <li key={n.name} className="rounded-2xl glass-card p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {n.name.startsWith("en") ? "Ethernet" : "Rețea"}
                        </span>
                        <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {n.name}
                        </span>
                      </div>
                      <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <span className="live-dot" aria-hidden /> Trafic live
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
              <ul className="rounded-2xl glass-card divide-y divide-border stagger-in">
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

      <PushNotificationsCard push={push} />
    </PageShell>
  );
}

function PushNotificationsCard({ push }: { push: ReturnType<typeof usePushNotifications> }) {
  if (push.state === "unsupported") return null;

  const isSubscribed = push.state === "subscribed";
  const isDenied = push.state === "denied";
  const isLoading = push.state === "loading";

  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Bell className="h-3.5 w-3.5" /> Notificări Push
      </h2>
      <div className="rounded-2xl glass-card p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {isSubscribed
              ? "Notificări activate"
              : isDenied
                ? "Notificări blocate"
                : "Notificări dezactivate"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isSubscribed
              ? "Vei primi notificări pentru toate evenimentele din jurnal"
              : isDenied
                ? "Permite notificările din setările browserului, apoi reîncarcă pagina"
                : "Activează pentru a primi notificări despre Plex, Immich, server etc."}
          </p>
        </div>
        {!isDenied && (
          <button
            onClick={isSubscribed ? push.unsubscribe : push.subscribe}
            disabled={isLoading}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 ${
              isSubscribed ? "bg-red-500/15 text-red-400" : "bg-emerald-500/15 text-emerald-400"
            }`}
          >
            {isSubscribed ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
            {isLoading ? "Se procesează…" : isSubscribed ? "Dezactivează" : "Activează"}
          </button>
        )}
      </div>
      {push.error && <p className="mt-2 px-1 text-xs text-red-400">Eroare: {push.error}</p>}
    </section>
  );
}
