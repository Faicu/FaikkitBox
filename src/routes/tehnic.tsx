import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Gauge, ArrowDown, ArrowUp, Activity } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageShell } from "@/components/PageShell";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { lastSpeedtestQuery, speedtestHistoryQuery } from "@/lib/queries";
import { requireAdminBeforeLoad } from "@/lib/auth/admin-route-guard";
import { runSpeedtest } from "@/lib/system/speedtest.functions";
import { formatSpeed } from "@/lib/format";
import { Metric } from "@/components/tehnic/Metric";
import { PluginStatusSection } from "@/components/tehnic/sections/PluginStatusSection";
import { PlexServiceCard } from "@/components/tehnic/sections/PlexServiceCard";
import { CommitStatsSection } from "@/components/tehnic/sections/CommitStatsSection";
import { ActivityLogSection } from "@/components/tehnic/sections/ActivityLogSection";
import { ErrorLogSection } from "@/components/tehnic/sections/ErrorLogSection";
import { SpeedtestChart } from "@/components/tehnic/sections/SpeedtestChart";
import { NetworkLinkCard } from "@/components/tehnic/sections/NetworkLinkCard";
import { TehnicSubNav } from "@/components/tehnic/TehnicSubNav";

export const Route = createFileRoute("/tehnic")({
  beforeLoad: requireAdminBeforeLoad,
  head: () => ({
    meta: [{ title: "Tehnic — Monitor Server" }],
  }),
  component: TehnicPage,
});

function TehnicPage() {
  const speedtest = useQuery(lastSpeedtestQuery);
  const speedtestHistory = useQuery(speedtestHistoryQuery);
  const [speedtestDrawer, setSpeedtestDrawer] = useState(false);

  const qc = useQueryClient();
  const runSpeedtestFn = useServerFn(runSpeedtest);
  const [speedtestError, setSpeedtestError] = useState<string | null>(null);
  const speedtestMutation = useMutation({
    mutationFn: () => {
      setSpeedtestError(null);
      return runSpeedtestFn();
    },
    onSuccess: (res) => {
      if (res.ok) {
        qc.setQueryData(["speedtest"], res);
        qc.invalidateQueries({ queryKey: ["speedtestHistory"] });
        toast.success("Test de viteză finalizat");
      } else {
        setSpeedtestError(res.error);
        toast.error(`Testul a eșuat: ${res.error}`);
      }
    },
    onError: (e) => {
      setSpeedtestError((e as Error).message);
      toast.error((e as Error).message);
    },
  });

  return (
    <PageShell title="Tehnic" subtitle="Plugin-uri, statistici și diagnostice">
      <TehnicSubNav />

      {/* Control serviciu Plex — fosta pagină /plex */}
      <PlexServiceCard />

      {/* Plugin-uri active */}
      <PluginStatusSection />

      {/* Statistici commit-uri */}
      <CommitStatsSection />

      {/* Speedtest */}
      <button
        type="button"
        onClick={() => setSpeedtestDrawer(true)}
        className="block w-full rounded-2xl border border-border bg-card p-4 text-left active:scale-[0.99] transition-transform"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-rose-400">
              <Gauge className="h-5 w-5" />
            </span>
            <span className="font-semibold">Speedtest</span>
          </div>
          <span className="text-xs text-muted-foreground">›</span>
        </div>
        {speedtest.data ? (
          <div className="mt-3 grid min-w-0 grid-cols-3 gap-2 text-sm">
            <Metric
              icon={<ArrowDown className="h-3.5 w-3.5" />}
              label="Download"
              value={formatSpeed(speedtest.data.download)}
            />
            <Metric
              icon={<ArrowUp className="h-3.5 w-3.5" />}
              label="Upload"
              value={formatSpeed(speedtest.data.upload)}
            />
            <Metric
              icon={<Activity className="h-3.5 w-3.5" />}
              label="Ping"
              value={`${speedtest.data.ping.latency.toFixed(0)} ms`}
            />
          </div>
        ) : speedtest.isLoading ? (
          <div className="mt-3 grid min-w-0 grid-cols-3 gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/50" />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Niciun test efectuat încă.</p>
        )}
        {speedtest.data && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Ultimul test: {new Date(speedtest.data.timestamp).toLocaleString()}
          </p>
        )}
      </button>

      <Drawer
        open={speedtestDrawer}
        onOpenChange={(open) => {
          setSpeedtestDrawer(open);
          if (open) setSpeedtestError(null);
        }}
      >
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>Speedtest</DrawerTitle>
            <DrawerDescription>
              {speedtest.data
                ? `Ultimul test: ${new Date(speedtest.data.timestamp).toLocaleString()}`
                : "Niciun test efectuat încă."}
            </DrawerDescription>
          </DrawerHeader>
          <div className="space-y-4 overflow-y-auto overscroll-contain px-4 pb-16">
            {speedtest.data && (
              <div className="grid min-w-0 grid-cols-3 gap-2 text-sm">
                <Metric
                  icon={<ArrowDown className="h-3.5 w-3.5" />}
                  label="Download"
                  value={formatSpeed(speedtest.data.download)}
                />
                <Metric
                  icon={<ArrowUp className="h-3.5 w-3.5" />}
                  label="Upload"
                  value={formatSpeed(speedtest.data.upload)}
                />
                <Metric
                  icon={<Activity className="h-3.5 w-3.5" />}
                  label="Ping"
                  value={`${speedtest.data.ping.latency.toFixed(0)} ms`}
                />
              </div>
            )}
            {speedtest.data?.server && (
              <div className="rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">
                <div>
                  Server: {speedtest.data.server.name ?? "—"}{" "}
                  {speedtest.data.server.location ? `(${speedtest.data.server.location})` : ""}
                </div>
                {speedtest.data.isp && <div>ISP: {speedtest.data.isp}</div>}
                {speedtest.data.packetLoss != null && (
                  <div>Pierdere pachete: {speedtest.data.packetLoss}%</div>
                )}
                {speedtest.data.resultUrl && (
                  <a
                    href={speedtest.data.resultUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-primary underline"
                  >
                    Raport complet Ookla
                  </a>
                )}
              </div>
            )}

            <NetworkLinkCard />

            {(speedtestHistory.data?.length ?? 0) > 0 && (
              <SpeedtestChart history={speedtestHistory.data!} />
            )}

            <button
              type="button"
              onClick={() => speedtestMutation.mutate()}
              disabled={speedtestMutation.isPending}
              className="w-full rounded-xl border border-rose-500/30 bg-rose-500/15 px-3 py-2.5 text-sm font-medium text-rose-400 transition-transform hover:bg-rose-500/25 active:scale-[0.98] disabled:opacity-50"
            >
              {speedtestMutation.isPending
                ? "Se rulează testul... (poate dura 30-60s)"
                : "Rulează test nou"}
            </button>

            {speedtestError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                <div className="font-semibold">Testul a eșuat</div>
                <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all">
                  {speedtestError}
                </pre>
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {/* Erori aplicație */}
      <ErrorLogSection />

      {/* Jurnal activitate */}
      <ActivityLogSection />
    </PageShell>
  );
}
