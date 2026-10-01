// Server functions admin pentru alimentări (pagina /calatorii), separate de vw-fuel.ts
// — vezi regula din STRUCTURE.md despre *.functions.ts.

import { createServerFn } from "@tanstack/react-start";

export type { VwFuelSummary, VwRefuel, VwRefuelInput } from "./vw-fuel";
import type { VwFuelSummary, VwRefuelInput } from "./vw-fuel";

export const getVwFuel = createServerFn({ method: "GET" }).handler(
  async (): Promise<VwFuelSummary> => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { readFuelSummary } = await import("./vw-fuel");
    return readFuelSummary();
  },
);

export const saveVwRefuel = createServerFn({ method: "POST" })
  .validator((data: VwRefuelInput) => data)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { saveRefuel } = await import("./vw-fuel");
    saveRefuel(data);
  });

export const deleteVwRefuel = createServerFn({ method: "POST" })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { deleteRefuel } = await import("./vw-fuel");
    deleteRefuel(Number(data.id));
  });
