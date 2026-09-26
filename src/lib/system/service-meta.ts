// Numele și etichetele acțiunilor pe servicii — fără importuri server, deci
// comune serverului (service-jobs.ts, update-check.ts) și butoanelor
// (ServiceHeaderActions.tsx).

export type ServiceKey = "plex" | "immich" | "qbit" | "ubuntu";
export type JobKind = "restart" | "update";
export type JobStatus = "running" | "ok" | "failed" | "interrupted";

export interface ServiceJob {
  id: number;
  service: ServiceKey;
  kind: JobKind;
  status: JobStatus;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  output: string;
}

// Cât rămâne vizibilă ieșirea unei acțiuni terminate. După asta, serverul
// n-o mai trimite deloc, iar pagina nu mai are ce afișa.
export const JOB_OUTPUT_VISIBLE_MS = 30 * 60_000;

export const SERVICE_LABELS: Record<ServiceKey, string> = {
  plex: "Plex",
  immich: "Immich",
  qbit: "qBittorrent",
  ubuntu: "Ubuntu",
};

export function jobLabel(service: ServiceKey, kind: JobKind): string {
  return `${kind === "restart" ? "Restart" : "Update"} ${SERVICE_LABELS[service]}`;
}

// „1.43.4.10903-e5521bd8c” → „1.43.4.10903”, „v3.2.3” → „3.2.3”.
export function shortVersion(v?: string): string {
  return (v ?? "?").replace(/^v/i, "").split(/[-+ ]/)[0];
}
