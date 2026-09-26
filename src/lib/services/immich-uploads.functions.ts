import { createServerFn } from "@tanstack/react-start";

// Server function subțire, fără importuri server statice — vezi nota din
// media/media.functions.ts: immich-uploads.ts importă db.ts la vârf.
export const getImmichTracker = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ checkedUntil: string | null; inProgress: number }> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { readImmichTrackerState } = await import("./immich-uploads");
    return readImmichTrackerState();
  },
);
