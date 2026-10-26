import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ChevronDown,
  Clock3,
  FileCode2,
  History,
  Loader2,
  Pause,
  Play,
  Timer,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { watcherHistoryQuery, watcherStatusQuery } from "@/lib/queries";
import {
  runWatcherTaskNow,
  setWatcherTaskPaused,
  type WatcherTaskStatus,
} from "@/lib/watcher/watcher.functions";
import { FALLBACK_TASK_ICON, WATCHER_PLUGIN, WATCHER_TASK_INFO } from "./plugins";
import { ImmichUploadsSection, Row, ShowWatchCards, SubtitleRetryCards } from "./watcher-cards";
import { formatDateTime, relativeTime } from "./utils";

// Drawer-ul Watcher-ului: ce rulează acum, apoi toate sarcinile ca acordeon cu
// una singură deschisă. Totul inline — un drawer peste drawer îngheață
// ecranul (vezi commit c76ce30).

function formatDuration(ms: number): string {
  if (ms < 1000) return "sub 1s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

function inTime(iso: string, now: number): string {
  const s = Math.round((new Date(iso).getTime() - now) / 1000);
  if (s <= 0) return "acum";
  if (s < 60) return `peste ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `peste ${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `peste ${h}h ${m % 60}m` : `peste ${h}h`;
}

function cadenceText(t: Pick<WatcherTaskStatus, "everyMs">): string {
  if (t.everyMs === null) return "la pornire";
  const s = t.everyMs / 1000;
  if (s < 60) return `la ${s}s`;
  const m = s / 60;
  if (m < 60) return m === 1 ? "la 1 min" : `la ${m} min`;
  const h = m / 60;
  return h === 1 ? "din oră în oră" : `la ${h}h`;
}

// Ceasul pentru duratele care curg (operațiunile în curs, „peste 12s”).
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function WatcherDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: tasks } = useQuery({
    ...watcherStatusQuery,
    refetchInterval: 2_000,
    enabled: open,
  });
  const now = useNow(open);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    if (!open) setOpenId(null);
  }, [open]);

  const list = tasks ?? [];
  const errors = list.filter((t) => t.lastOk === false).length;

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="pb-2 text-left">
          <DrawerTitle className="flex items-center gap-2 text-base">
            <span className="pulse-glow flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/50">
              {WATCHER_PLUGIN.icon}
            </span>
            {WATCHER_PLUGIN.label}
            <span className="live-dot ml-auto" />
          </DrawerTitle>
          <DrawerDescription className="text-left">
            {list.length} sarcini de fundal
            {errors > 0 ? ` · ${errors} cu eroare la ultima rulare` : ""}
          </DrawerDescription>
        </DrawerHeader>

        <div className="max-h-[65vh] space-y-2.5 overflow-y-auto overscroll-contain px-4 pb-6 stagger-in">
          <div className="rounded-2xl glass-card p-3 text-xs leading-relaxed text-muted-foreground">
            {WATCHER_PLUGIN.details}
          </div>

          <LiveOperations tasks={list} now={now} />

          <div className="overflow-hidden rounded-2xl glass-card divide-y divide-border/50 text-xs">
            {list.map((t) => (
              <TaskItem
                key={t.id}
                task={t}
                now={now}
                isOpen={openId === t.id}
                onToggle={() => setOpenId(openId === t.id ? null : t.id)}
              />
            ))}
          </div>

          <div className="rounded-2xl glass-card divide-y divide-border/50 text-xs">
            <Row icon={<FileCode2 className="h-3.5 w-3.5" />} label="Registru">
              <code className="text-[11px]">src/lib/watcher/tasks.ts</code>
            </Row>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// Ce rulează chiar acum și de cât timp, plus cererile manuale încă nepreluate.
// Fără nimic în curs, arată următoarea sarcină care pornește.
function LiveOperations({ tasks, now }: { tasks: WatcherTaskStatus[]; now: number }) {
  const runningTasks = tasks.filter((t) => t.runningSince);
  const waiting = tasks.filter((t) => t.requestedAt && !t.runningSince);
  const upcoming = tasks
    .filter((t) => !t.runningSince && !t.paused && t.nextRunAt)
    .sort((a, b) => new Date(a.nextRunAt!).getTime() - new Date(b.nextRunAt!).getTime())[0];

  return (
    <div className="rounded-2xl glass-card p-3 text-xs">
      <div className="mb-2 flex items-center gap-1.5 text-muted-foreground">
        <Zap className="h-3.5 w-3.5" /> În curs acum
        {runningTasks.length > 0 && (
          <span className="ml-auto tabular-nums">{runningTasks.length}</span>
        )}
      </div>
      {runningTasks.length === 0 && waiting.length === 0 ? (
        <div className="text-muted-foreground">
          Nicio operațiune în curs.
          {upcoming?.nextRunAt
            ? ` Următoarea: ${upcoming.label}, ${inTime(upcoming.nextRunAt, now)}.`
            : ""}
        </div>
      ) : (
        <div className="space-y-1.5">
          {runningTasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5">
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-sky-400" />
              <span className="min-w-0 flex-1 truncate font-medium">{t.label}</span>
              {t.runningManual && (
                <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                  manual
                </span>
              )}
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatDuration(now - new Date(t.runningSince!).getTime())}
              </span>
            </div>
          ))}
          {waiting.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5">
              <Clock3 className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">{t.label}</span>
              <span className="shrink-0 text-muted-foreground">
                {t.group ? "cerută, așteaptă grupul" : "cerută"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskItem({
  task,
  now,
  isOpen,
  onToggle,
}: {
  task: WatcherTaskStatus;
  now: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const info = WATCHER_TASK_INFO[task.id];
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/30"
      >
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted/50">
          {info?.icon ?? FALLBACK_TASK_ICON}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium text-foreground">{task.label}</span>
            <span className="shrink-0 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {cadenceText(task)}
            </span>
          </span>
          <span className="mt-0.5 block truncate leading-relaxed text-muted-foreground">
            {task.lastOk === false
              ? (task.lastError ?? "eroare")
              : (task.lastSummary ?? info?.summary ?? "")}
          </span>
        </span>
        <span className="mt-0.5 flex shrink-0 items-center gap-1.5">
          {task.runningSince ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
          ) : task.lastOk === false ? (
            <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
          ) : null}
          {task.paused && (
            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
              pauză
            </span>
          )}
          {task.lastFinishedAt && (
            <span className="whitespace-nowrap text-[10px] text-muted-foreground">
              {relativeTime(task.lastFinishedAt)}
            </span>
          )}
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {/* grid-rows 0fr→1fr: înălțimea se animă fără s-o măsurăm. Conținutul
          se montează doar deschis — cardurile proprii își cer datele. */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden">{isOpen && <TaskDetails task={task} now={now} />}</div>
      </div>
    </div>
  );
}

function TaskDetails({ task, now }: { task: WatcherTaskStatus; now: number }) {
  const info = WATCHER_TASK_INFO[task.id];
  const qc = useQueryClient();
  const runNow = useServerFn(runWatcherTaskNow);
  const setPaused = useServerFn(setWatcherTaskPaused);
  const refresh = () => qc.invalidateQueries({ queryKey: ["watcherStatus"] });

  const run = useMutation({
    mutationFn: () => runNow({ data: { taskId: task.id } }),
    onSuccess: () => {
      toast.success(`${task.label}: pornește în cel mult o secundă`);
      void refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const pause = useMutation({
    mutationFn: (paused: boolean) => setPaused({ data: { taskId: task.id, paused } }),
    onSuccess: (_r, paused) => {
      toast.success(paused ? `${task.label}: pe pauză` : `${task.label}: reluată`);
      void refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const next = task.paused
    ? "pe pauză"
    : task.everyMs === null
      ? "doar la pornire"
      : task.runningSince
        ? "după rularea curentă"
        : task.nextRunAt
          ? inTime(task.nextRunAt, now)
          : "—";

  return (
    <div className="space-y-2.5 px-3 pb-3">
      {info && (
        <ul className="space-y-1.5 pl-[2.125rem] leading-relaxed text-muted-foreground">
          {info.points.map((pt) => (
            <li key={pt} className="relative pl-3">
              <span className="absolute top-[0.55em] left-0 h-1 w-1 rounded-full bg-muted-foreground/60" />
              {pt}
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-xl bg-muted/30 divide-y divide-border/50">
        <Row
          icon={<History className="h-3.5 w-3.5" />}
          label="Ultima rulare"
          flashKey={task.lastFinishedAt}
        >
          {task.lastFinishedAt ? (
            <span title={formatDateTime(task.lastFinishedAt)}>
              {relativeTime(task.lastFinishedAt)}
              {task.lastDurationMs !== null ? ` · ${formatDuration(task.lastDurationMs)}` : ""}
            </span>
          ) : (
            <span className="text-muted-foreground">încă niciuna</span>
          )}
        </Row>
        <Row icon={<Timer className="h-3.5 w-3.5" />} label="Următoarea">
          {next}
        </Row>
        {task.group && (
          <Row icon={<Users className="h-3.5 w-3.5" />} label="Grup">
            {task.group} · nu rulează deodată cu alta din grup
          </Row>
        )}
      </div>

      {task.lastOk === false && task.lastError && (
        <div className="rounded-xl bg-red-500/10 px-3 py-2 text-[11px] leading-relaxed text-red-300">
          {task.lastError}
        </div>
      )}

      {task.controllable && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => run.mutate()}
            disabled={run.isPending || !!task.requestedAt || !!task.runningSince}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {task.runningSince ? "Rulează…" : task.requestedAt ? "Cerută…" : "Rulează acum"}
          </button>
          <button
            type="button"
            onClick={() => pause.mutate(!task.paused)}
            disabled={pause.isPending}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-muted/60 px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {task.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {task.paused ? "Reia" : "Pauză"}
          </button>
        </div>
      )}

      <TaskHistory task={task} />

      {task.id === "show-watch" && <ShowWatchCards />}
      {task.id === "subtitle-retry" && <SubtitleRetryCards />}
      {task.id === "immich-uploads" && <ImmichUploadsSection />}
    </div>
  );
}

// Ultimele 20 de rulări. La sarcinile de un minut sau mai dese, doar cele care
// au făcut ceva, au eșuat sau au fost pornite manual (vezi runner.ts).
function TaskHistory({ task }: { task: WatcherTaskStatus }) {
  const { data: runs, refetch } = useQuery(watcherHistoryQuery(task.id));
  // O rulare nouă terminată = istoric nou.
  useEffect(() => {
    void refetch();
  }, [task.lastFinishedAt, refetch]);
  const frequent = task.everyMs !== null && task.everyMs <= 60_000;

  return (
    <div className="rounded-xl bg-muted/30 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-muted-foreground">
        <History className="h-3.5 w-3.5" /> Istoric
      </div>
      {!runs || runs.length === 0 ? (
        <div className="text-muted-foreground">
          {frequent
            ? "Nimic de arătat: aici apar doar rulările care au făcut ceva, au eșuat sau au fost pornite manual."
            : "Nicio rulare încă."}
        </div>
      ) : (
        <div className="space-y-1">
          {runs.map((r) => (
            <div key={r.id} className="flex items-start gap-2 leading-relaxed">
              <span
                className={`mt-[0.45em] h-1.5 w-1.5 shrink-0 rounded-full ${r.ok ? "bg-emerald-400" : "bg-red-400"}`}
              />
              <span className="min-w-0 flex-1">
                <span className={r.ok ? "" : "text-red-300"}>
                  {r.ok ? (r.summary ?? "fără nimic de făcut") : (r.error ?? "eroare")}
                </span>
                {r.manual && <span className="text-primary"> · manual</span>}
              </span>
              <span
                className="shrink-0 text-[10px] tabular-nums text-muted-foreground"
                title={formatDateTime(r.finishedAt)}
              >
                {relativeTime(r.finishedAt)} · {formatDuration(r.durationMs)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
