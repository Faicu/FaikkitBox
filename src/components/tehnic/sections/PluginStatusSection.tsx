import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box } from "lucide-react";

import { activityLogQuery, watcherStatusQuery } from "@/lib/queries";
import { SERVER_LIFECYCLE_PLUGIN, WATCHER_PLUGIN } from "../plugins";
import { PluginDetailDrawer } from "../PluginDetailDrawer";
import { PluginRow } from "../PluginRow";
import { WatcherDrawer } from "../WatcherDrawer";

// Două plugin-uri pe server: Watcher-ul (toate sarcinile de fundal) și
// pornirea/oprirea procesului. Ultima activitate a Watcher-ului e cea mai
// recentă rulare terminată a oricărei sarcini — vine din watcher_tasks, nu
// din jurnal sau din tabelele proprii ale fiecărei sarcini, ca înainte.
export function PluginStatusSection() {
  const { data: log } = useQuery(activityLogQuery);
  const { data: tasks } = useQuery(watcherStatusQuery);
  const [watcherOpen, setWatcherOpen] = useState(false);
  const [lifecycleOpen, setLifecycleOpen] = useState(false);

  const list = tasks ?? [];
  const lastWatcherTs =
    list
      .map((t) => t.lastFinishedAt)
      .filter((t): t is string => t !== null)
      .sort()
      .at(-1) ?? null;

  const running = list.filter((t) => t.runningSince).length;
  const errors = list.filter((t) => t.lastOk === false).length;
  const paused = list.filter((t) => t.paused).length;
  const parts = [`${list.length} sarcini`];
  if (running) parts.push(`${running} în curs`);
  if (errors) parts.push(`${errors} cu eroare`);
  if (paused) parts.push(`${paused} pe pauză`);

  const lifecycleTs = Array.isArray(log)
    ? (log.find((e) => e.type === SERVER_LIFECYCLE_PLUGIN.activityType)?.timestamp ?? null)
    : null;

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <Box className="h-3.5 w-3.5" /> Plugin-uri active
      </h2>
      {/* overflow-hidden: fundalul de hover al primului/ultimului rând ar
          depăși altfel colțurile rotunjite ale cardului. */}
      <div className="overflow-hidden rounded-2xl glass-card divide-y divide-border/50 stagger-in">
        <PluginRow
          plugin={{
            label: WATCHER_PLUGIN.label,
            icon: WATCHER_PLUGIN.icon,
            description: tasks ? parts.join(" · ") : "Toate sarcinile de fundal",
          }}
          lastTs={lastWatcherTs}
          onOpen={() => setWatcherOpen(true)}
        />
        <PluginRow
          plugin={SERVER_LIFECYCLE_PLUGIN}
          lastTs={lifecycleTs}
          onOpen={() => setLifecycleOpen(true)}
        />
      </div>

      <WatcherDrawer open={watcherOpen} onClose={() => setWatcherOpen(false)} />
      <PluginDetailDrawer
        plugin={lifecycleOpen ? SERVER_LIFECYCLE_PLUGIN : null}
        lastTs={lifecycleTs}
        onClose={() => setLifecycleOpen(false)}
      />
    </section>
  );
}
