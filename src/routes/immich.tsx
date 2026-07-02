import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Images, Film, HardDrive, Activity } from "lucide-react";

import { PageShell } from "@/components/PageShell";
import { ServicePill } from "@/components/ServicePill";
import { StatCard } from "@/components/StatCard";
import { ErrorCard } from "@/components/ErrorCard";
import { immichQuery } from "@/lib/queries";
import { formatBytes } from "@/lib/format";

export const Route = createFileRoute("/immich")({
  head: () => ({ meta: [{ title: "Immich — Server Monitor" }] }),
  component: ImmichPage,
});

function ImmichPage() {
  const { data, isLoading } = useQuery(immichQuery);
  const status = isLoading ? "loading" : data?.status ?? "error";

  return (
    <PageShell
      title="Immich"
      subtitle={data?.status === "ok" ? `Photos & videos · v${data.version ?? ""}` : "Photo library"}
      right={<ServicePill status={status} />}
    >
      {data?.status === "error" && <ErrorCard title="Immich unreachable" message={data.error ?? "Unknown error"} />}

      {data?.status === "ok" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatCard label="Total assets" value={(data.totalAssets ?? 0).toLocaleString()} icon={<Activity className="h-4 w-4" />} accent="text-purple-400" />
            <StatCard label="Storage" value={formatBytes(data.usageBytes ?? 0)} icon={<HardDrive className="h-4 w-4" />} accent="text-purple-400" />
            <StatCard label="Photos" value={(data.photos ?? 0).toLocaleString()} icon={<Images className="h-4 w-4" />} accent="text-purple-400" />
            <StatCard label="Videos" value={(data.videos ?? 0).toLocaleString()} icon={<Film className="h-4 w-4" />} accent="text-purple-400" />
          </div>

          {data.usageByUser && data.usageByUser.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Per user</h2>
              <ul className="rounded-2xl border border-border bg-card divide-y divide-border">
                {data.usageByUser.map((u, i) => (
                  <li key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{u.userName}</div>
                      <div className="text-xs text-muted-foreground">{u.photos.toLocaleString()} photos · {u.videos.toLocaleString()} videos</div>
                    </div>
                    <div className="text-sm font-semibold tabular-nums">{formatBytes(u.usage)}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.activeJobs && data.activeJobs.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Active jobs</h2>
              <ul className="rounded-2xl border border-border bg-card divide-y divide-border">
                {data.activeJobs.map((j) => (
                  <li key={j.name} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="capitalize">{j.name.replace(/([A-Z])/g, " $1").trim()}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {j.active} active · {j.waiting} waiting
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(!data.activeJobs || data.activeJobs.length === 0) && (
            <div className="rounded-2xl border border-border bg-card p-3 text-sm text-muted-foreground">
              No active background jobs.
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}