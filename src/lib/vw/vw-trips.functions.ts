// Server functions pentru pagina /calatorii, separate de vw-trips.ts (importuri
// server statice) — vezi regula din STRUCTURE.md despre *.functions.ts.

import { createServerFn } from "@tanstack/react-start";

export type { VwTrip, VwTripPoint } from "./vw-trips";
import type { VwTrip, VwTripPoint } from "./vw-trips";

export const getVwTrips = createServerFn({ method: "GET" }).handler(async (): Promise<VwTrip[]> => {
  const { requireAdmin } = await import("../auth/admin.server");
  await requireAdmin();
  const { readVwTrips } = await import("./vw-trips");
  return readVwTrips();
});

export const getVwTripPoints = createServerFn({ method: "GET" })
  .validator((data: { start: string; end: string }) => data)
  .handler(async ({ data }): Promise<VwTripPoint[]> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { readVwTripPoints } = await import("./vw-trips");
    return readVwTripPoints(String(data.start), String(data.end));
  });
