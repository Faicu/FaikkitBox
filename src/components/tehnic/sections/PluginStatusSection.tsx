import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box } from "lucide-react";

import {
  activityLogQuery,
  commitsFromDbQuery,
  showWatchStatusQuery,
  wantedMoviesQuery,
} from "@/lib/queries";
import { PLUGINS, type PluginInfo } from "../plugins";
import { PluginDetailDrawer } from "../PluginDetailDrawer";
import { PluginRow } from "../PluginRow";

export function PluginStatusSection() {
  const { data: log } = useQuery(activityLogQuery);
  const { data: commitsData } = useQuery(commitsFromDbQuery);
  const { data: watch } = useQuery(showWatchStatusQuery);
  const { data: wanted } = useQuery(wantedMoviesQuery);
  const [openPlugin, setOpenPlugin] = useState<PluginInfo | null>(null);

  function lastActivity(type: string | null): string | null {
    if (!type || !Array.isArray(log)) return null;
    const entry = log.find((e) => e.type === type);
    return entry ? entry.timestamp : null;
  }

  function lastCommitSync(): string | null {
    if (commitsData?.status !== "ok" || !commitsData.commits.length) return null;
    return commitsData.commits[0].date;
  }

  // watch_last_checked_at e în formatul SQLite, în UTC ("2026-09-06 08:09:04").
  // new Date() l-ar citi ca oră LOCALĂ, deci "acum" ar apărea ca "acum 3h".
  function lastShowWatch(): string | null {
    const v = watch?.lastCheckedAt;
    return v ? `${v.replace(" ", "T")}Z` : null;
  }

  function lastTsFor(p: PluginInfo): string | null {
    if (p.id === "github-commit-tracker") return lastCommitSync();
    if (p.id === "show-watcher") return lastShowWatch();
    return lastActivity(p.activityType);
  }

  // Filmele așteptate apar doar când există.
  function descriptionFor(p: PluginInfo): string {
    if (p.id !== "show-watcher" || !watch) return p.description;
    const n = watch.shows.length;
    const shows =
      n === 0 ? "niciun serial urmărit" : `${n} ${n === 1 ? "serial urmărit" : "seriale urmărite"}`;
    const parts = [shows];
    const f = wanted?.length ?? 0;
    if (f > 0) parts.push(`${f} ${f === 1 ? "film așteptat" : "filme așteptate"}`);
    return parts.join(" · ");
  }

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <Box className="h-3.5 w-3.5" /> Plugin-uri active
      </h2>
      {/* overflow-hidden: fundalul de hover al primului/ultimului rând ar
          depăși altfel colțurile rotunjite ale cardului. */}
      <div className="overflow-hidden rounded-2xl glass-card divide-y divide-border/50 stagger-in">
        {PLUGINS.map((p) => (
          <PluginRow
            key={p.id}
            plugin={p}
            description={descriptionFor(p)}
            lastTs={lastTsFor(p)}
            onOpen={() => setOpenPlugin(p)}
          />
        ))}
      </div>

      <PluginDetailDrawer
        plugin={openPlugin}
        lastTs={openPlugin ? lastTsFor(openPlugin) : null}
        onClose={() => setOpenPlugin(null)}
      />
    </section>
  );
}
