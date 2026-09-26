import { createServerFn } from "@tanstack/react-start";
import type { JobKind, ServiceJob, ServiceKey } from "./service-jobs";

// Server functions subțiri, fără importuri server statice — service-jobs.ts
// importă node:child_process și db.ts la vârf (vezi nota din
// media/media.functions.ts).

const SERVICES: ServiceKey[] = ["plex", "immich", "qbit", "ubuntu"];
const KINDS: JobKind[] = ["restart", "update"];

export type { JobKind, ServiceJob, ServiceKey };

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

export const getServiceJobs = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    latest: Partial<Record<ServiceKey, ServiceJob>>;
    running: ServiceJob | null;
  }> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { latestJobs, runningJob } = await import("./service-jobs");
    return { latest: latestJobs(), running: runningJob() };
  },
);
