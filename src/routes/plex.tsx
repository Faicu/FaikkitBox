import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Film,
  Tv,
  Music,
  Image as ImageIcon,
  User,
  Trophy,
  ChevronRight,
  History,
  Monitor,
  Activity,
} from "lucide-react";
import { useState } from "react";

import { PageShell } from "@/components/PageShell";
import { StatCard } from "@/components/StatCard";
import { ErrorCard } from "@/components/ErrorCard";
import { ServiceHeaderActions, CommandOutput } from "@/components/ServiceHeaderActions";
import { useServiceRecovery } from "@/components/useServiceRecovery";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { plexQuery } from "@/lib/queries";
import { formatMsWithSeconds } from "@/lib/format";
import type { PlexHistoryEntry } from "@/lib/services.functions";
import type { AgentCommand, AgentResult } from "@/lib/agent.functions";

export const Route = createFileRoute("/plex")({
  head: () => ({ meta: [{ title: "Plex — Monitor Server" }] }),
  component: PlexPage,
});

function libIcon(type: string) {
  if (type === "show") return <Tv className="h-4 w-4" />;
  if (type === "movie") return <Film className="h-4 w-4" />;
  if (type === "artist") return <Music className="h-4 w-4" />;
  if (type === "photo") return <ImageIcon className="h-4 w-4" />;
  return <Film className="h-4 w-4" />;
}

function PlexPage() {
  const { data, isLoading } = useQuery(plexQuery);
  const status = isLoading ? "loading" : (data?.status ?? "error");
  const { recovering, startRecovery } = useServiceRecovery(data?.status);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [lastCmd, setLastCmd] = useState<{ command: AgentCommand; result: AgentResult } | null>(
    null,
  );
  const userEntries: PlexHistoryEntry[] =
    selectedUser && data?.status === "ok" ? (data.userHistory?.[selectedUser] ?? []) : [];

  return (
    <PageShell
      title="Plex"
      subtitle={
        data?.status === "ok"
          ? `${data.serverName ?? "Server"} · v${data.version ?? ""}`
          : "Server media"
      }
      right={
        <ServiceHeaderActions
          service="plex"
          status={status}
          onRestart={startRecovery}
          onCommandResult={(command, result) => setLastCmd({ command, result })}
        />
      }
    >
      {data?.status === "error" &&
        (recovering ? (
          <RecoveryNotice service="Plex" />
        ) : (
          <ErrorCard title="Plex indisponibil" message={data.error ?? "Eroare necunoscută"} />
        ))}

      {data?.status === "ok" && (
        <>
          <section>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Se redă acum ({data.sessions.length})
            </h2>
            {data.sessions.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
                Nimic în redare momentan.
              </div>
            ) : (
              <div className="space-y-2">
                {data.sessions.map((s, i) => {
                  const pct = s.durationMs > 0 ? (s.viewOffsetMs / s.durationMs) * 100 : 0;
                  const remaining = s.durationMs - s.viewOffsetMs;
                  const isPaused = s.playerState === "paused";

                  return (
                    <div
                      key={i}
                      className={`rounded-2xl border bg-card p-3 space-y-3 ${isPaused ? "border-amber-500/20" : "border-emerald-500/20"}`}
                    >
                      {/* Header: titlu + badge stare */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {s.grandparentTitle && (
                            <div className="text-[11px] text-muted-foreground font-medium truncate">
                              {s.grandparentTitle}
                            </div>
                          )}
                          <div className="truncate font-semibold text-sm leading-tight">
                            {s.title}
                          </div>
                        </div>
                        {isPaused ? (
                          <span className="shrink-0 rounded-lg bg-amber-500/15 border border-amber-500/20 px-2.5 py-1 text-[11px] font-medium text-amber-400">
                            ⏸ Pauză
                          </span>
                        ) : (
                          <span className="shrink-0 rounded-lg bg-emerald-500/15 border border-emerald-500/20 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
                            ▶ Redare
                          </span>
                        )}
                      </div>

                      {/* Progress bar mare */}
                      <div className="space-y-1.5">
                        <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${isPaused ? "bg-amber-400/70" : "bg-emerald-400"}`}
                            style={{ width: `${pct.toFixed(2)}%` }}
                          />
                        </div>
                        {/* Timeline */}
                        <div className="flex items-center justify-between text-[11px] tabular-nums">
                          <span className="text-foreground font-medium">
                            {formatMsWithSeconds(s.viewOffsetMs)}
                          </span>
                          <span className="text-muted-foreground">
                            −{formatMsWithSeconds(remaining)}
                          </span>
                          <span className="text-muted-foreground">
                            {formatMsWithSeconds(s.durationMs)}
                          </span>
                        </div>
                      </div>

                      {/* Detalii sesiune */}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <User className="h-3 w-3 shrink-0" />
                          <span className="truncate">{s.user}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Monitor className="h-3 w-3 shrink-0" />
                          <span className="truncate">{s.player}</span>
                        </div>
                        {s.videoDecision && (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <span className="font-mono uppercase text-[10px] rounded bg-muted px-1.5 py-0.5">
                              {s.videoDecision}
                            </span>
                            <span>Video</span>
                          </div>
                        )}
                        {s.audioDecision && (
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <span className="font-mono uppercase text-[10px] rounded bg-muted px-1.5 py-0.5">
                              {s.audioDecision}
                            </span>
                            <span>Audio</span>
                          </div>
                        )}
                        {s.bitrateKbps ? (
                          <div className="flex items-center gap-1.5 text-muted-foreground col-span-2">
                            <Activity className="h-3 w-3 shrink-0" />
                            <span>{(s.bitrateKbps / 1000).toFixed(1)} Mbps</span>
                            <span className="text-muted-foreground/50">·</span>
                            <span>{Math.round(pct)}% vizionat</span>
                          </div>
                        ) : (
                          <div className="text-muted-foreground">{Math.round(pct)}% vizionat</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Biblioteci
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {data.libraries.map((lib) => (
                <StatCard
                  key={lib.key}
                  label={lib.title}
                  value={lib.count != null ? lib.count.toLocaleString() : "—"}
                  sub={undefined}
                  icon={libIcon(lib.type)}
                  accent="text-amber-400"
                />
              ))}
            </div>
          </section>

          {data.recentlyAdded.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Adăugate recent
              </h2>
              <ul className="rounded-2xl border border-border bg-card divide-y divide-border">
                {data.recentlyAdded.map((r, i) => (
                  <li key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="truncate pr-2">{r.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(r.addedAt * 1000).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.topShows && data.topShows.length > 0 && (
            <RankedList
              title="Top seriale"
              icon={<Tv className="h-3.5 w-3.5" />}
              rows={data.topShows.map((r) => ({
                label: r.title,
                sub: `${r.plays} vizionări`,
                date: r.lastViewedAt,
              }))}
            />
          )}

          {data.topMovies && data.topMovies.length > 0 && (
            <RankedList
              title="Top filme"
              icon={<Film className="h-3.5 w-3.5" />}
              rows={data.topMovies.map((r) => ({
                label: r.title,
                sub: `${r.plays} vizionări`,
                date: r.lastViewedAt,
              }))}
            />
          )}

          {data.topWatchers && data.topWatchers.length > 0 && (
            <RankedList
              title="Top spectatori"
              icon={<Trophy className="h-3.5 w-3.5" />}
              rows={data.topWatchers.map((r) => ({
                label: r.user,
                sub: `${r.plays} vizionări`,
                date: r.lastViewedAt,
              }))}
              onSelect={(i) => setSelectedUser(data.topWatchers![i].user)}
            />
          )}

          {data.recentHistory && data.recentHistory.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <History className="h-3.5 w-3.5" /> Istoric vizionări
              </h2>
              <ul className="rounded-2xl border border-border bg-card divide-y divide-border">
                {data.recentHistory.map((e, i) => {
                  const seasonEp =
                    e.season != null && e.episode != null
                      ? `S${String(e.season).padStart(2, "0")}E${String(e.episode).padStart(2, "0")}`
                      : null;
                  const heading = e.show
                    ? `${e.show}${seasonEp ? ` — ${seasonEp}` : ""}${e.title ? ` · ${e.title}` : ""}`
                    : e.title;
                  return (
                    <li key={i} className="px-3 py-2 text-sm">
                      <div className="truncate">{heading}</div>
                      <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate">
                          {e.user ?? "—"}
                          {e.player ? ` · ${e.player}` : ""}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {e.viewedAt > 0 ? new Date(e.viewedAt * 1000).toLocaleString() : "—"}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {lastCmd && <CommandOutput command={lastCmd.command} result={lastCmd.result} />}
        </>
      )}

      <Drawer open={selectedUser !== null} onOpenChange={(o) => !o && setSelectedUser(null)}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="flex items-center gap-2">
              <User className="h-4 w-4" /> {selectedUser}
            </DrawerTitle>
            <DrawerDescription>
              {userEntries.length > 0 ? `${userEntries.length} vizionări recente` : "Fără istoric"}
            </DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-6">
            {userEntries.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                Nu există istoric pentru acest utilizator.
              </div>
            ) : (
              <ul className="rounded-2xl border border-border bg-card divide-y divide-border">
                {userEntries.map((e, i) => {
                  const seasonEp =
                    e.season != null && e.episode != null
                      ? `S${String(e.season).padStart(2, "0")}E${String(e.episode).padStart(2, "0")}`
                      : null;
                  const heading = e.show
                    ? `${e.show}${seasonEp ? ` — ${seasonEp}` : ""}${e.title ? ` · ${e.title}` : ""}`
                    : e.title;
                  return (
                    <li
                      key={i}
                      className="flex items-start justify-between gap-2 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate">{heading}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {e.player ? `${e.player} · ` : ""}
                          {e.viewedAt > 0 ? new Date(e.viewedAt * 1000).toLocaleString() : "—"}
                        </div>
                      </div>
                      <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {e.type}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </PageShell>
  );
}

function RecoveryNotice({ service }: { service: string }) {
  return (
    <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-300">
      {service} se repornește și va reveni online în câteva momente.
    </div>
  );
}

function RankedList({
  title,
  icon,
  rows,
  onSelect,
}: {
  title: string;
  icon: React.ReactNode;
  rows: Array<{ label: string; sub: string; date: number }>;
  onSelect?: (index: number) => void;
}) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        {icon} {title}
      </h2>
      <ol className="rounded-2xl border border-border bg-card divide-y divide-border">
        {rows.map((r, i) => (
          <li key={i}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(i)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 active:bg-muted"
              >
                <RankedRowContent index={i} row={r} />
                <ChevronRight className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ) : (
              <div className="flex items-center justify-between px-3 py-2 text-sm">
                <RankedRowContent index={i} row={r} />
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function RankedRowContent({
  index,
  row,
}: {
  index: number;
  row: { label: string; sub: string; date: number };
}) {
  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <span className="w-4 shrink-0 text-xs font-mono text-muted-foreground">{index + 1}</span>
        <span className="truncate">{row.label}</span>
      </div>
      <div className="shrink-0 pl-2 text-right">
        <div className="text-xs font-medium tabular-nums">{row.sub}</div>
        {row.date > 0 && (
          <div className="text-[10px] text-muted-foreground">
            {new Date(row.date * 1000).toLocaleDateString()}
          </div>
        )}
      </div>
    </>
  );
}
