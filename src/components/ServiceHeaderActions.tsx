import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpCircle, ExternalLink, Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";

import {
  startServiceAction,
  type JobKind,
  type ServiceJob,
  type ServiceKey,
} from "@/lib/system/service-jobs.functions";
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

const NAMES: Record<ServiceKey, string> = {
  plex: "Plex",
  immich: "Immich",
  qbit: "qBittorrent",
  ubuntu: "Ubuntu",
};

const label = (service: ServiceKey, kind: JobKind) =>
  `${kind === "restart" ? "Restart" : "Update"} ${NAMES[service]}`;

// „1.43.4.10903-e5521bd8c” → „1.43.4.10903”, „v3.2.3” → „3.2.3”.
const shortVersion = (v?: string) => (v ?? "?").replace(/^v/i, "").split(/[-+ ]/)[0];

function confirmText(service: ServiceKey, kind: JobKind, v?: ServiceVersion): string {
  if (kind === "restart") {
    if (service === "ubuntu")
      return "Repornești tot sistemul?\n\nToate serviciile, inclusiv aplicația, vor fi indisponibile 1–2 minute.";
    if (service === "qbit")
      return "Repornești qBittorrent?\n\nSe golește și cache-ul DNS. Descărcările se reiau singure.";
    return `Repornești ${NAMES[service]}?\n\nServiciul va fi indisponibil câteva secunde.`;
  }
  if (service === "ubuntu")
    return `Actualizezi Ubuntu?\n\nSe instalează ${v?.pending ?? "?"} pachete. Poate dura câteva minute.`;
  return `Actualizezi ${NAMES[service]} de la ${shortVersion(v?.current)} la ${shortVersion(v?.latest)}?\n\nSe descarcă versiunea nouă, apoi serviciul repornește.`;
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

export function ServiceHeaderActions({ service, status, onRestart, statusSlot }: Props) {
  const qc = useQueryClient();
  const versions = useQuery(versionsQuery);
  const jobs = useQuery(serviceJobsQuery);
  const start = useServerFn(startServiceAction);

  const v = (versions.data as Partial<Record<ServiceKey, ServiceVersion>> | undefined)?.[service];
  const running = jobs.data?.running ?? null;
  const mine = running?.service === service ? running : null;

  const mutation = useMutation({
    mutationFn: (kind: JobKind) => start({ data: { service, kind } }),
    onSuccess: (res, kind) => {
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast(`${label(service, kind)} a pornit`);
      if (service !== "ubuntu") onRestart?.();
      qc.invalidateQueries({ queryKey: serviceJobsQuery.queryKey });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // Finalul unei acțiuni pornite de oriunde (și din alt tab): anunț +
  // versiunile recitite, ca butonul Update să dispară singur.
  const latest = jobs.data?.latest[service];
  const seen = useRef<{ id: number; status: string } | null>(null);
  useEffect(() => {
    if (!latest) return;
    const prev = seen.current;
    seen.current = { id: latest.id, status: latest.status };
    if (prev?.id !== latest.id || prev.status !== "running" || latest.status === "running") return;
    if (latest.status === "ok") toast.success(`${label(service, latest.kind)}: reușit`);
    else
      toast.error(
        `${label(service, latest.kind)}: ${latest.status === "failed" ? "eșuat" : "întrerupt"}`,
      );
    qc.invalidateQueries({ queryKey: versionsQuery.queryKey });
  }, [latest, service, qc]);

  const busy = !!running || mutation.isPending;
  const busyTitle = running ? `Rulează deja: ${label(running.service, running.kind)}` : undefined;

  const showRestart = service !== "ubuntu" || v?.rebootRequired === true;
  const updateAvailable =
    service === "qbit"
      ? false
      : service === "ubuntu"
        ? (v?.pending ?? 0) > 0
        : v?.upToDate === false;
  const showUpdate = updateAvailable || mine?.kind === "update";
  const updateText =
    service === "ubuntu"
      ? `Update · ${v?.pending ?? ""} ${v?.pending === 1 ? "pachet" : "pachete"}`
      : `Update · ${shortVersion(v?.current)} → ${shortVersion(v?.latest)}`;

  const run = (kind: JobKind) => {
    if (confirm(confirmText(service, kind, v))) mutation.mutate(kind);
  };
  const spinning = (kind: JobKind) =>
    mine?.kind === kind || (mutation.isPending && mutation.variables === kind);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {v?.changelog && showUpdate && (
        <a
          href={v.changelog}
          target="_blank"
          rel="noreferrer"
          className="flex h-9 w-9 items-center justify-center rounded-full glass-card text-muted-foreground hover:text-foreground"
          title="Changelog"
          aria-label="Changelog"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      )}
      {showRestart && (
        <button
          type="button"
          onClick={() => run("restart")}
          disabled={busy}
          title={busyTitle ?? (service === "ubuntu" ? "Sistemul cere repornire" : "Repornește")}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/15 px-3 text-xs font-medium text-sky-400 hover:bg-sky-500/25 disabled:opacity-50"
        >
          <RotateCcw className={`h-3.5 w-3.5 ${spinning("restart") ? "animate-spin" : ""}`} />
          {spinning("restart") ? "…" : "Restart"}
        </button>
      )}
      {showUpdate && (
        <button
          type="button"
          onClick={() => run("update")}
          disabled={busy}
          title={busyTitle ?? "Actualizare disponibilă"}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/15 px-3 text-xs font-medium text-amber-400 hover:bg-amber-500/25 disabled:opacity-50"
        >
          {spinning("update") ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowUpCircle className="h-3.5 w-3.5" />
          )}
          {spinning("update") ? "Se actualizează…" : updateText}
        </button>
      )}
      {statusSlot ?? <ServicePill status={status} />}
    </div>
  );
}

// Ieșirea ultimei acțiuni a serviciului: live cât rulează, apoi încă 30 de
// minute (sau până o închizi). Citită din DB, deci supraviețuiește unui
// refresh de pagină.
export function ServiceJobOutput({ service }: { service: ServiceKey }) {
  const jobs = useQuery(serviceJobsQuery);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const job: ServiceJob | undefined = jobs.data?.latest[service];
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = preRef.current;
    if (el && job?.status === "running") el.scrollTop = el.scrollHeight;
  }, [job?.output, job?.status]);

  if (!job || job.id === dismissed) return null;
  const recent =
    job.status === "running" ||
    (job.finishedAt != null && Date.now() - new Date(job.finishedAt).getTime() < 30 * 60_000);
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
        <span className="font-medium">{label(job.service, job.kind)}</span>
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
