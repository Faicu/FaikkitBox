import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpCircle, ExternalLink, Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";

import { runningFrom, startServiceAction } from "@/lib/system/service-jobs.functions";
import {
  JOB_OUTPUT_VISIBLE_MS,
  jobLabel,
  SERVICE_LABELS,
  shortVersion,
  type JobKind,
  type ServiceJob,
  type ServiceKey,
} from "@/lib/system/service-meta";
import { pluralRo } from "@/lib/format";
import { serviceJobsQuery, versionsQuery } from "@/lib/queries";
import type { ServiceVersion } from "@/lib/system/versions.functions";
import { ServicePill } from "@/components/ServicePill";
import { formatDateTime, relativeTime } from "@/components/tehnic/utils";

// Butoanele Restart / Update ale unui serviciu — același mecanism pentru
// Plex, Immich, qBittorrent și Ubuntu (vezi src/lib/system/service-jobs.ts):
//   Restart — Plex, Immich, qBittorrent mereu (la qBittorrent, și golirea
//             cache-ului DNS); Ubuntu doar când sistemul cere repornire.
//   Update  — doar când chiar există o actualizare; qBittorrent niciodată.
// Toate cer confirmare, rulează în fundal pe server și se scriu în jurnal de
// acolo. O singură acțiune odată, pe toate serviciile.

function confirmText(service: ServiceKey, kind: JobKind, v?: ServiceVersion): string {
  if (kind === "restart") {
    if (service === "ubuntu")
      return "Repornești tot sistemul?\n\nToate serviciile, inclusiv aplicația, vor fi indisponibile 1–2 minute.";
    if (service === "qbit")
      return "Repornești qBittorrent?\n\nSe golește și cache-ul DNS. Descărcările se reiau singure.";
    return `Repornești ${SERVICE_LABELS[service]}?\n\nServiciul va fi indisponibil câteva secunde.`;
  }
  if (service === "ubuntu")
    return `Actualizezi Ubuntu?\n\nSe instalează ${pluralRo(v?.pending ?? 0, "pachet", "pachete")}. Poate dura câteva minute.`;
  return `Actualizezi ${SERVICE_LABELS[service]} de la ${shortVersion(v?.current)} la ${shortVersion(v?.latest)}?\n\nSe descarcă versiunea nouă, apoi serviciul repornește.`;
}

// Starea comună a butoanelor Restart (header) și Update (banner): versiunea,
// acțiunea care rulează și pornirea uneia noi, cu confirmare.
function useServiceAction(service: ServiceKey, onRestart?: () => void) {
  const qc = useQueryClient();
  const versions = useQuery(versionsQuery);
  const jobs = useQuery(serviceJobsQuery);
  const start = useServerFn(startServiceAction);

  const v = (versions.data as Partial<Record<ServiceKey, ServiceVersion>> | undefined)?.[service];
  const running = runningFrom(jobs.data);
  const mine = running?.service === service ? running : null;

  const mutation = useMutation({
    mutationFn: (kind: JobKind) => start({ data: { service, kind } }),
    onSuccess: (res, kind) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast(`${jobLabel(service, kind)} a pornit`);
      if (service !== "ubuntu") onRestart?.();
      qc.invalidateQueries({ queryKey: serviceJobsQuery.queryKey });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const busy = !!running || mutation.isPending;
  const busyTitle = running
    ? `Rulează deja: ${jobLabel(running.service, running.kind)}`
    : undefined;

  const run = (kind: JobKind) => {
    if (confirm(confirmText(service, kind, v))) mutation.mutate(kind);
  };
  const spinning = (kind: JobKind) =>
    mine?.kind === kind || (mutation.isPending && mutation.variables === kind);

  return { v, mine, busy, busyTitle, run, spinning, latest: jobs.data?.[service] };
}

type Props = {
  service: ServiceKey;
  status: "ok" | "error" | "loading";
  // Pentru mesajul „se repornește…” al paginii (useServiceRecovery).
  onRestart?: () => void;
  // Înlocuiește bulina de stare (pagina Sistem o folosește pentru
  // „Repornit recent”).
  statusSlot?: React.ReactNode;
};

// Header-ul ține doar Restart (iconiță) + starea, pe un singur rând;
// actualizarea are bannerul ei în pagină (ServiceUpdateBanner).
export function ServiceHeaderActions({ service, status, onRestart, statusSlot }: Props) {
  const qc = useQueryClient();
  const { v, busy, busyTitle, run, spinning, latest } = useServiceAction(service, onRestart);

  // Finalul unei acțiuni pornite de oriunde (și din alt tab): anunț +
  // versiunile recitite, ca bannerul de Update să dispară singur. A doua
  // recitire, după 90s: Plex își instalează versiunea nouă abia după pornirea
  // containerului, iar Immich răspunde abia după ce a pornit — la final încă
  // ar raporta versiunea veche.
  const seen = useRef<{ id: number; status: string } | null>(null);
  useEffect(() => {
    if (!latest) return;
    const prev = seen.current;
    seen.current = { id: latest.id, status: latest.status };
    if (!prev || prev.id !== latest.id || prev.status !== "running" || latest.status === "running")
      return;
    if (latest.status === "ok") toast.success(`${jobLabel(service, latest.kind)}: reușit`);
    else
      toast.error(
        `${jobLabel(service, latest.kind)}: ${latest.status === "failed" ? "eșuat" : "întrerupt"}`,
      );
    qc.invalidateQueries({ queryKey: versionsQuery.queryKey });
    const later = window.setTimeout(
      () => qc.invalidateQueries({ queryKey: versionsQuery.queryKey }),
      90_000,
    );
    return () => window.clearTimeout(later);
  }, [latest, service, qc]);

  const showRestart = service !== "ubuntu" || v?.rebootRequired === true;
  const restartTitle = service === "ubuntu" ? "Restart — sistemul cere repornire" : "Restart";

  return (
    <div className="flex shrink-0 items-center gap-2">
      {showRestart && (
        <button
          type="button"
          onClick={() => run("restart")}
          disabled={busy}
          title={busyTitle ?? restartTitle}
          aria-label="Restart"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-sky-500/30 bg-sky-500/15 text-sky-400 hover:bg-sky-500/25 disabled:opacity-50"
        >
          <RotateCcw className={`h-3.5 w-3.5 ${spinning("restart") ? "animate-spin" : ""}`} />
        </button>
      )}
      {statusSlot ?? <ServicePill status={status} />}
    </div>
  );
}

// Actualizarea disponibilă: versiunea curentă → nouă (sau pachetele Ubuntu),
// changelog și butonul de pornire. Rămâne vizibil și cât rulează, cu spinner.
export function ServiceUpdateBanner({
  service,
  onRestart,
}: {
  service: ServiceKey;
  onRestart?: () => void;
}) {
  const { v, mine, busy, busyTitle, run, spinning } = useServiceAction(service, onRestart);

  const updateAvailable =
    service === "qbit"
      ? false
      : service === "ubuntu"
        ? (v?.pending ?? 0) > 0
        : v?.upToDate === false;
  if (!updateAvailable && mine?.kind !== "update") return null;

  const detail =
    service === "ubuntu"
      ? pluralRo(v?.pending ?? 0, "pachet", "pachete")
      : `${shortVersion(v?.current)} → ${shortVersion(v?.latest)}`;

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
      <ArrowUpCircle className="h-5 w-5 shrink-0 text-amber-400" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-amber-400">Actualizare disponibilă</div>
        <div className="truncate text-xs text-muted-foreground">
          {SERVICE_LABELS[service]} · {detail}
        </div>
      </div>
      {v?.changelog && (
        <a
          href={v.changelog}
          target="_blank"
          rel="noreferrer"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          title="Changelog"
          aria-label="Changelog"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      )}
      <button
        type="button"
        onClick={() => run("update")}
        disabled={busy}
        title={busyTitle}
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/15 px-3 text-xs font-medium text-amber-400 hover:bg-amber-500/25 disabled:opacity-50"
      >
        {spinning("update") && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {spinning("update") ? "Se actualizează…" : "Actualizează"}
      </button>
    </div>
  );
}

// Ieșirea ultimei acțiuni a serviciului: live cât rulează, apoi încă 30 de
// minute (sau până o închizi). Citită din DB, deci supraviețuiește unui
// refresh de pagină.
export function ServiceJobOutput({ service }: { service: ServiceKey }) {
  const jobs = useQuery(serviceJobsQuery);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const job: ServiceJob | undefined = jobs.data?.[service];
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = preRef.current;
    if (el && job?.status === "running") el.scrollTop = el.scrollHeight;
  }, [job?.output, job?.status]);

  if (!job || job.id === dismissed) return null;
  const recent =
    job.status === "running" ||
    (job.finishedAt != null &&
      Date.now() - new Date(job.finishedAt).getTime() < JOB_OUTPUT_VISIBLE_MS);
  if (!recent) return null;

  const head =
    job.status === "running"
      ? { text: "Rulează…", cls: "text-sky-400" }
      : job.status === "ok"
        ? { text: "✓ Reușit", cls: "text-emerald-400" }
        : job.status === "failed"
          ? {
              text: `✗ Eșuat${job.exitCode != null ? ` · exit ${job.exitCode}` : ""}`,
              cls: "text-red-400",
            }
          : { text: "Întrerupt de o repornire a aplicației", cls: "text-amber-400" };

  return (
    <div className="rounded-2xl border border-border bg-black/40 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs">
        {job.status === "running" && <Loader2 className="h-3 w-3 animate-spin text-sky-400" />}
        <span className="font-medium">{jobLabel(job.service, job.kind)}</span>
        <span className={head.cls}>{head.text}</span>
        <span className="ml-auto text-muted-foreground" title={formatDateTime(job.startedAt)}>
          {relativeTime(job.startedAt)}
        </span>
        {job.status !== "running" && (
          <button
            type="button"
            onClick={() => setDismissed(job.id)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Închide"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <pre
        ref={preRef}
        className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-[11px] text-muted-foreground"
      >
        {job.output || "…"}
      </pre>
    </div>
  );
}
