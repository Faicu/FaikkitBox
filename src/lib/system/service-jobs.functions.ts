import { createServerFn } from "@tanstack/react-start";
import type { JobKind, ServiceJob, ServiceKey } from "./service-meta";

// Server functions subțiri, fără importuri server statice — service-jobs.ts
// importă node:child_process și db.ts la vârf (vezi nota din
// media/media.functions.ts).

const SERVICES: ServiceKey[] = ["plex", "immich", "qbit", "ubuntu"];
const KINDS: JobKind[] = ["restart", "update"];

export const startServiceAction = createServerFn({ method: "POST" })
  .validator((data: { service: ServiceKey; kind: JobKind }) => {
    if (!SERVICES.includes(data.service) || !KINDS.includes(data.kind)) {
      throw new Error("Acțiune necunoscută");
    }
    return data;
  })
  .handler(async ({ data }): Promise<{ ok: true; id: number } | { ok: false; error: string }> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { startServiceJob, JobRejected } = await import("./service-jobs");
    try {
      return { ok: true, id: await startServiceJob(data.service, data.kind) };
    } catch (e) {
      if (e instanceof JobRejected) return { ok: false, error: e.message };
      throw e;
    }
  });

// Ultima acțiune a fiecărui serviciu. Cea în curs (cel mult una) e mereu și
// ultima a serviciului ei, deci se găsește tot aici — vezi runningFrom.
export const getServiceJobs = createServerFn({ method: "GET" }).handler(
  async (): Promise<Partial<Record<ServiceKey, ServiceJob>>> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { latestJobs } = await import("./service-jobs");
    return latestJobs();
  },
);

export function runningFrom(
  latest: Partial<Record<ServiceKey, ServiceJob>> | undefined,
): ServiceJob | null {
  return Object.values(latest ?? {}).find((j) => j?.status === "running") ?? null;
}
