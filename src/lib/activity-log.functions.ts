// ---------------------------------------------------------------------------
// Server function pentru Jurnalul de Activitate, separată de activity-log.ts.
//
// activity-log.ts are importuri server statice (node:crypto, notifications) și
// importă dinamic db.ts. Cât timp queries.ts importa getActivityLog DIN el,
// tot graful ajungea în bundle-ul public — /assets/db-*.js era servit cu 200
// către orice browser, cu schema SQLite completă la vedere.
//
// Corpul unui handler de server function e eliminat din bundle-ul de client,
// deci `await import("./activity-log")` de aici rămâne exclusiv pe server.
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";

export type { ActivityEntry, ActivityType, ActivityMetaValue } from "./activity-log";
import type { ActivityEntry } from "./activity-log";

// `after` = cursorul primit la citirea anterioară: doar intrările scrise de
// atunci (vezi readActivityLog). Fără el, tot jurnalul.
export const getActivityLog = createServerFn({ method: "GET" })
  .validator((data: { after?: number } | undefined) => ({
    after: Math.max(0, Math.floor(Number(data?.after ?? 0)) || 0),
  }))
  .handler(async ({ data }): Promise<{ entries: ActivityEntry[]; cursor: number }> => {
    const { requireAdmin } = await import("./auth/admin.server");
    await requireAdmin();
    const { readActivityLog } = await import("./activity-log");
    return readActivityLog(data.after);
  });
