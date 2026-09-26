import { createServerFn } from "@tanstack/react-start";

// Server function subțire — logica stă în versions.ts (vezi nota din
// media/media.functions.ts despre importurile server statice).
export type { ServiceVersion } from "./versions";

export const getVersions = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("../auth/admin.server");
  await requireAdmin();
  const { readVersionsCached } = await import("./versions");
  return { ...(await readVersionsCached()), fetchedAt: new Date().toISOString() };
});
