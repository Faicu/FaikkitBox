import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowDown, ArrowUp, HardDrive, Percent, Timer, Play, Pause, ChevronDown, Search, X, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageShell } from "@/components/PageShell";
import { StatCard } from "@/components/StatCard";
import { Meter } from "@/components/Meter";
import { ErrorCard } from "@/components/ErrorCard";
import { ServiceHeaderActions, CommandOutput } from "@/components/ServiceHeaderActions";
import { useServiceRecovery } from "@/components/useServiceRecovery";
import { qbitQuery, adminStatusQuery } from "@/lib/queries";
import type { AgentCommand, AgentResult } from "@/lib/agent.functions";
import { formatBytes, formatSpeed, formatEta } from "@/lib/format";
import { qbitAction } from "@/lib/services.functions";

export const Route = createFileRoute("/qbit")({
  head: () => ({ meta: [{ title: "qBittorrent — Monitor Server" }] }),
  component: QbitPage,
});

function stateBadge(state: string) {
  const s = state.toLowerCase();
  if (s.includes("download")) return { text: "Descarcă", cls: "bg-sky-500/20 text-sky-400" };
  if ((s.includes("up") || s === "uploading" || s === "stalledup") && !s.includes("paus") && !s.includes("stop")) return { text: "Seed", cls: "bg-emerald-500/20 text-emerald-400" };
  if (s.includes("paus") || s.includes("stop")) return { text: "Oprit", cls: "bg-muted text-muted-foreground" };
  if (s.includes("error")) return { text: "Eroare", cls: "bg-red-500/20 text-red-400" };
  if (s.includes("stall")) return { text: "Blocat", cls: "bg-amber-500/20 text-amber-400" };
  return { text: state, cls: "bg-muted text-muted-foreground" };
}

function QbitPage() {
  const { data, isLoading } = useQuery(qbitQuery);
  const admin = useQuery(adminStatusQuery);
  const isAdmin = !!admin.data?.isAdmin;
  const status = isLoading ? "loading" : data?.status ?? "error";
  const { recovering, startRecovery } = useServiceRecovery(data?.status);
  const queryClient = useQueryClient();
  const action = useServerFn(qbitAction);
  const [openList, setOpenList] = useState<"downloading" | "seeding" | "paused" | null>(null);
  const [torrentSearch, setTorrentSearch] = useState("");
  const [lastCmd, setLastCmd] = useState<{ command: AgentCommand; result: AgentResult } | null>(null);
  const mutation = useMutation({
    mutationFn: (vars: { hashes: string[] | "all"; action: "pause" | "resume" }) =>
      action({ data: vars }),
    onSuccess: (res, vars) => {
      if (!res.ok) {
        toast.error(`Acțiunea qBit ${vars.action} a eșuat: ${res.error ?? "necunoscut"}`);
        return;
      }
      const target = vars.hashes === "all" ? "toate torrentele" : `${vars.hashes.length} torrent${vars.hashes.length === 1 ? "" : "e"}`;
      toast.success(`${vars.action === "pause" ? "Oprite" : "Reluate"}: ${target}`);
      queryClient.invalidateQueries({ queryKey: ["qbit"] });
    },
    onError: (e) => toast.error(`Eroare acțiune qBit: ${(e as Error).message}`),
  });

  const pendingHash =
    mutation.isPending && mutation.variables && mutation.variables.hashes !== "all"
      ? (mutation.variables.hashes as string[])[0]
      : null;
  const pendingAll = mutation.isPending && mutation.variables?.hashes === "all";

  const filteredTorrents = data?.torrents
    ? [...data.torrents]
        .sort((a, b) => b.addedOn - a.addedOn)
        .filter(t => !torrentSearch || t.name.toLowerCase().includes(torrentSearch.toLowerCase()))
    : [];

  return (
    <PageShell
      title="qBittorrent"
      subtitle={data?.status === "ok" ? `v${data.version} · ${data.counts.total} torrente` : "Client torrent"}
      right={
        <ServiceHeaderActions
          service="qbit"
          status={status}
          onRestart={startRecovery}
          onCommandResult={(command, result) => setLastCmd({ command, result })}
        />
      }
    >
      {lastCmd && <CommandOutput command={lastCmd.command} result={lastCmd.result} />}

      {data?.status === "error" && (
        recovering
          ? <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-300">qBittorrent se repornește și va reveni online în câteva momente.</div>
          : <ErrorCard title="qBittorrent indisponibil" message={data.error ?? "Eroare necunoscută"} />
      )}

      {data?.status === "ok" && (
        <>
          {isAdmin && <div className="flex gap-2">
            <button
              onClick={() => mutation.mutate({ hashes: "all", action: "resume" })}
              disabled={pendingAll}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-3 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50"
            >
              <Play className="h-4 w-4" /> Reia toate
            </button>
            <button
              onClick={() => mutation.mutate({ hashes: "all", action: "pause" })}
              disabled={pendingAll}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/15 px-3 py-2 text-sm font-medium text-amber-400 hover:bg-amber-500/25 disabled:opacity-50"
            >
              <Pause className="h-4 w-4" /> Oprește toate
            </button>
          </div>}

          <div className="grid grid-cols-2 gap-2">
            <StatCard label="Descărcare" value={formatSpeed(data.dlSpeed)} sub={`Total ${formatBytes(data.totalDl)}`} icon={<ArrowDown className="h-4 w-4" />} accent="text-sky-400" />
            <StatCard label="Încărcare" value={formatSpeed(data.upSpeed)} sub={`Total ${formatBytes(data.totalUp)}`} icon={<ArrowUp className="h-4 w-4" />} accent="text-emerald-400" />
            <StatCard
              label="Rație azi"
              value={
                data.sessionDl < 1_000_000
                  ? data.sessionUp > 0 ? "∞" : "0.00"
                  : (data.sessionUp / data.sessionDl).toFixed(2)
              }
              sub={`↑ ${formatBytes(data.sessionUp)} · ↓ ${formatBytes(data.sessionDl)}`}
              icon={<Percent className="h-4 w-4" />}
              accent="text-sky-400"
            />
            <StatCard label="Spațiu liber" value={formatBytes(data.freeSpaceOnDisk)} icon={<HardDrive className="h-4 w-4" />} accent="text-sky-400" />
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <button
              onClick={() => setOpenList((v) => (v === "downloading" ? null : "downloading"))}
              className={`rounded-xl bg-sky-500/15 py-2 text-sky-400 transition hover:bg-sky-500/25 ${openList === "downloading" ? "ring-1 ring-sky-400" : ""}`}
            >
              <b className="block text-lg">{data.counts.downloading}</b>În descărcare
            </button>
            <button
              onClick={() => setOpenList((v) => (v === "seeding" ? null : "seeding"))}
              className={`rounded-xl bg-emerald-500/15 py-2 text-emerald-400 transition hover:bg-emerald-500/25 ${openList === "seeding" ? "ring-1 ring-emerald-400" : ""}`}
            >
              <b className="block text-lg">{data.counts.seeding}</b>Seed
            </button>
            <button
              onClick={() => setOpenList((v) => (v === "paused" ? null : "paused"))}
              className={`rounded-xl bg-muted py-2 text-muted-foreground transition hover:bg-muted/70 ${openList === "paused" ? "ring-1 ring-muted-foreground" : ""}`}
            >
              <b className="block text-lg">{data.counts.paused}</b>Oprite
            </button>
          </div>

          {openList && (() => {
            const filtered = data.torrents
              .filter((t) => {
                const s = t.state.toLowerCase();
                if (openList === "downloading") return s.includes("download");
                if (openList === "seeding") return (s.includes("up") || s === "uploading" || s === "stalledup") && !s.includes("paus") && !s.includes("stop");
                return s.includes("paus") || s.includes("stop");
              })
              .sort((a, b) => {
                if (openList === "downloading") return b.dlspeed - a.dlspeed;
                if (openList === "seeding") return b.upspeed - a.upspeed;
                return b.size - a.size;
              });
            const label = openList === "downloading" ? "În descărcare" : openList === "seeding" ? "Seed" : "Oprite";
            const tone = openList === "downloading" ? "text-sky-400" : openList === "seeding" ? "text-emerald-400" : "text-muted-foreground";
            return (
              <section>
                <div className="mb-2 flex items-center justify-between px-1">
                  <h2 className={`text-xs font-semibold uppercase tracking-wide ${tone}`}>
                    {label} ({filtered.length})
                  </h2>
                  <button onClick={() => setOpenList(null)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                    Închide <ChevronDown className="h-3 w-3" />
                  </button>
                </div>
                {filtered.length === 0 ? (
                  <div className="rounded-2xl border border-border bg-card p-3 text-sm text-muted-foreground">Niciun torrent.</div>
                ) : (
                  <ul className="rounded-2xl border border-border bg-card divide-y divide-border">
                    {filtered.map((t) => (
                      <li key={t.hash} className="px-3 py-2">
                        <div className="truncate text-sm">{t.name}</div>
                        <div className="mt-0.5 flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                          <span>{(t.progress * 100).toFixed(1)}%</span>
                          <span>
                            {openList === "seeding" ? (
                              <span className="text-emerald-400">↑ {formatSpeed(t.upspeed)}</span>
                            ) : openList === "downloading" ? (
                              <span className="text-sky-400">↓ {formatSpeed(t.dlspeed)}</span>
                            ) : (
                              <span>{formatBytes(t.size)}</span>
                            )}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })()}

          {(data.alltimeDl != null || data.alltimeUp != null) && (
            <div className="grid grid-cols-2 gap-2">
              <StatCard label="Total descărcat" value={formatBytes(data.alltimeDl ?? 0)} icon={<ArrowDown className="h-4 w-4" />} accent="text-sky-400" />
              <StatCard label="Total încărcat" value={formatBytes(data.alltimeUp ?? 0)} sub={`Rație totală ${(() => {
                const dl = data.alltimeDl ?? 0;
                const up = data.alltimeUp ?? 0;
                if (dl > 0) return (up / dl).toFixed(2);
                if (up > 0) return "∞";
                return "0.00";
              })()}`} icon={<ArrowUp className="h-4 w-4" />} accent="text-emerald-400" />
            </div>
          )}

          {data.largestEta && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Timer className="h-3.5 w-3.5" /> Cea mai mare descărcare
              </h2>
              <div className="rounded-2xl border border-border bg-card p-3">
                <div className="truncate text-sm font-medium">{data.largestEta.name}</div>
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground tabular-nums">
                  <span>{formatBytes(data.largestEta.remaining)} rămași</span>
                  <span>ETA {formatEta(data.largestEta.eta)}</span>
                </div>
              </div>
            </section>
          )}

          {!openList && (
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Torrente ({data.torrents.length})
              </h2>
            </div>
            {/* Search bar */}
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={torrentSearch}
                onChange={e => setTorrentSearch(e.target.value)}
                placeholder="Caută în torrente..."
                className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-9 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
              {torrentSearch && (
                <button
                  onClick={() => setTorrentSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {data.torrents.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">Niciun torrent.</div>
            ) : filteredTorrents.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">Niciun rezultat pentru „{torrentSearch}".</div>
            ) : (
              <div className="space-y-2">
                {filteredTorrents.map((t) => {
                  const b = stateBadge(t.state);
                  const isPaused = /paus|stop/i.test(t.state);
                  const busy = pendingHash === t.hash;
                  return (
                    <div key={t.hash} className="rounded-2xl border border-border bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${b.cls}`}>{b.text}</span>
                          {isAdmin && <button
                            onClick={() =>
                              mutation.mutate({ hashes: [t.hash], action: isPaused ? "resume" : "pause" })
                            }
                            disabled={busy}
                            title={isPaused ? "Reia" : "Oprește"}
                            className={`rounded-md border p-1 transition disabled:opacity-50 ${
                              isPaused
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                                : "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                            }`}
                          >
                            {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                          </button>}
                          {isAdmin && <button
                            onClick={() => {
                              if (!confirm(`Ștergi torrentul și fișierele de pe disk?\n\n${t.name}`)) return;
                              mutation.mutate({ hashes: [t.hash], action: "delete" });
                            }}
                            disabled={busy}
                            title="Șterge torrent + fișiere"
                            className="rounded-md border border-red-500/30 bg-red-500/10 p-1 text-red-400 hover:bg-red-500/20 transition disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>}
                        </div>
                      </div>
                      <div className="mt-2">
                        <Meter value={t.progress * 100} right={`${(t.progress * 100).toFixed(1)}%`} tone="default" />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                        <span>{formatBytes(t.size * t.progress)} / {formatBytes(t.size)}</span>
                        <span className="flex items-center gap-2">
                          <span className="text-sky-400">↓ {formatSpeed(t.dlspeed)}</span>
                          <span className="text-emerald-400">↑ {formatSpeed(t.upspeed)}</span>
                          <span>{formatEta(t.eta)}</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          )}
        </>
      )}
    </PageShell>
  );
}