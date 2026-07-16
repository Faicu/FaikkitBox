import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Images, Film, HardDrive, Activity, Upload, Trophy, ListChecks } from "lucide-react";

import { PageShell } from "@/components/PageShell";
import { ServicePill } from "@/components/ServicePill";
import { StatCard } from "@/components/StatCard";
import { ErrorCard } from "@/components/ErrorCard";
import { ServiceVersionWidget } from "@/components/ServiceVersionWidget";
import { immichQuery } from "@/lib/queries";
import { formatBytes } from "@/lib/format";

export const Route = createFileRoute("/immich")({
  head: () => ({ meta: [{ title: "Immich — Monitor Server" }] }),
  component: ImmichPage,
});

function ImmichPage() {
  const { data, isLoading } = useQuery(immichQuery);
  const status = isLoading ? "loading" : data?.status ?? "error";

  return (
    <PageShell
      title="Immich"
      subtitle={data?.status === "ok" ? `Fotografii & videoclipuri · v${data.version ?? ""}` : "Bibliotecă foto"}
      right={<ServicePill status={status} />}
    >
      {data?.status === "error" && <ErrorCard title="Immich indisponibil" message={data.error ?? "Eroare necunoscută"} />}

      {data?.status === "ok" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatCard label="Total fișiere" value={(data.totalAssets ?? 0).toLocaleString()} icon={<Activity className="h-4 w-4" />} accent="text-purple-400" />
            <StatCard label="Spațiu folosit" value={formatBytes(data.usageBytes ?? 0)} icon={<HardDrive className="h-4 w-4" />} accent="text-purple-400" />
            <StatCard label="Fotografii" value={(data.photos ?? 0).toLocaleString()} icon={<Images className="h-4 w-4" />} accent="text-purple-400" />
            <StatCard label="Videoclipuri" value={(data.videos ?? 0).toLocaleString()} icon={<Film className="h-4 w-4" />} accent="text-purple-400" />
          </div>

          {(data.uploadsToday != null || data.uploadsThisWeek != null || data.jobQueueDepth != null) && (
            <div className="grid grid-cols-3 gap-2">
              <StatCard
                label="Azi"
                value={data.uploadsToday != null ? data.uploadsToday.toLocaleString() : "—"}
                sub="încărcări"
                icon={<Upload className="h-4 w-4" />}
                accent="text-purple-400"
              />
              <StatCard
                label="Săptămâna asta"
                value={data.uploadsThisWeek != null ? data.uploadsThisWeek.toLocaleString() : "—"}
                sub="încărcări"
                icon={<Upload className="h-4 w-4" />}
                accent="text-purple-400"
              />
              <StatCard
                label="Coadă joburi"
                value={(data.jobQueueDepth ?? 0).toLocaleString()}
                sub="sarcini"
                icon={<ListChecks className="h-4 w-4" />}
                accent="text-purple-400"
              />
            </div>
          )}

          {data.topUploaders && data.topUploaders.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <Trophy className="h-3.5 w-3.5" /> Top încărcători
              </h2>
              <ol className="rounded-2xl border border-border bg-card divide-y divide-border">
                {data.topUploaders.map((u, i) => (
                  <li key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="w-4 shrink-0 text-xs font-mono text-muted-foreground">{i + 1}</span>
                      <span className="truncate">{u.userName}</span>
                    </div>
                    <div className="shrink-0 pl-2 text-right">
                      <div className="text-xs font-medium tabular-nums">{u.total.toLocaleString()}</div>
                      <div className="text-[10px] text-muted-foreground tabular-nums">{formatBytes(u.usage)}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {data.usageByUser && data.usageByUser.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pe utilizator</h2>
              <ul className="rounded-2xl border border-border bg-card divide-y divide-border">
                {data.usageByUser.map((u, i) => (
                  <li key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{u.userName}</div>
                      <div className="text-xs text-muted-foreground">{u.photos.toLocaleString()} fotografii · {u.videos.toLocaleString()} videoclipuri</div>
                    </div>
                    <div className="text-sm font-semibold tabular-nums">{formatBytes(u.usage)}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.activeJobs && data.activeJobs.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Joburi active</h2>
              <ul className="rounded-2xl border border-border bg-card divide-y divide-border">
                {data.activeJobs.map((j) => (
                  <li key={j.name} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="capitalize">{j.name.replace(/([A-Z])/g, " $1").trim()}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {j.active} active · {j.waiting} în așteptare
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(!data.activeJobs || data.activeJobs.length === 0) && (
            <div className="rounded-2xl border border-border bg-card p-3 text-sm text-muted-foreground">
              Niciun job activ în fundal.
            </div>
          )}

          <ServiceVersionWidget service="immich" />
        </>
      )}
    </PageShell>
  );
}