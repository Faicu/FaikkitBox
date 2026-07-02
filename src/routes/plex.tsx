import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Film, Tv, Music, Image as ImageIcon, User, Trophy } from "lucide-react";

import { PageShell } from "@/components/PageShell";
import { ServicePill } from "@/components/ServicePill";
import { StatCard } from "@/components/StatCard";
import { Meter } from "@/components/Meter";
import { ErrorCard } from "@/components/ErrorCard";
import { plexQuery } from "@/lib/queries";
import { formatMs } from "@/lib/format";

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
  const status = isLoading ? "loading" : data?.status ?? "error";

  return (
    <PageShell
      title="Plex"
      subtitle={data?.status === "ok" ? `${data.serverName ?? "Server"} · v${data.version ?? ""}` : "Server media"}
      right={<ServicePill status={status} />}
    >
      {data?.status === "error" && <ErrorCard title="Plex indisponibil" message={data.error ?? "Eroare necunoscută"} />}

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
                {data.sessions.map((s, i) => (
                  <div key={i} className="rounded-2xl border border-border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {s.grandparentTitle ? `${s.grandparentTitle} — ` : ""}
                          {s.title}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <User className="h-3 w-3" /> {s.user} · {s.player}
                        </div>
                      </div>
                      <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {s.videoDecision ?? s.type}
                      </span>
                    </div>
                    <div className="mt-2">
                      <Meter
                        value={s.progress * 100}
                        right={`${formatMs(s.viewOffsetMs)} / ${formatMs(s.durationMs)}`}
                        tone="default"
                      />
                    </div>
                    {s.bitrateKbps && (
                      <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                        {(s.bitrateKbps / 1000).toFixed(1)} Mbps
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Biblioteci</h2>
            <div className="grid grid-cols-2 gap-2">
              {data.libraries.map((lib) => (
                <StatCard
                  key={lib.key}
                  label={lib.title}
                  value={lib.count != null ? lib.count.toLocaleString() : "—"}
                  sub={lib.type}
                  icon={libIcon(lib.type)}
                  accent="text-amber-400"
                />
              ))}
            </div>
          </section>

          {data.recentlyAdded.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Adăugate recent</h2>
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
              rows={data.topShows.map((r) => ({ label: r.title, sub: `${r.plays} vizionări`, date: r.lastViewedAt }))}
            />
          )}

          {data.topMovies && data.topMovies.length > 0 && (
            <RankedList
              title="Top filme"
              icon={<Film className="h-3.5 w-3.5" />}
              rows={data.topMovies.map((r) => ({ label: r.title, sub: `${r.plays} vizionări`, date: r.lastViewedAt }))}
            />
          )}

          {data.topWatchers && data.topWatchers.length > 0 && (
            <RankedList
              title="Top spectatori"
              icon={<Trophy className="h-3.5 w-3.5" />}
              rows={data.topWatchers.map((r) => ({ label: r.user, sub: `${r.plays} vizionări`, date: r.lastViewedAt }))}
            />
          )}
        </>
      )}
    </PageShell>
  );
}

function RankedList({
  title,
  icon,
  rows,
}: {
  title: string;
  icon: React.ReactNode;
  rows: Array<{ label: string; sub: string; date: number }>;
}) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        {icon} {title}
      </h2>
      <ol className="rounded-2xl border border-border bg-card divide-y divide-border">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center justify-between px-3 py-2 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className="w-4 shrink-0 text-xs font-mono text-muted-foreground">{i + 1}</span>
              <span className="truncate">{r.label}</span>
            </div>
            <div className="shrink-0 pl-2 text-right">
              <div className="text-xs font-medium tabular-nums">{r.sub}</div>
              {r.date > 0 && (
                <div className="text-[10px] text-muted-foreground">
                  {new Date(r.date * 1000).toLocaleDateString()}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}