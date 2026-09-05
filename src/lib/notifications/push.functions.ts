import { createServerFn } from "@tanstack/react-start";
import { randomUUID } from "node:crypto";

export const getVapidPublicKey = createServerFn({ method: "GET" }).handler(() => {
  return { publicKey: process.env.VAPID_PUBLIC_KEY ?? null };
});

export const subscribePush = createServerFn({ method: "POST" })
  .validator(
    (d: { endpoint: string; p256dh: string; auth: string; displayMode?: string | null }) => d,
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const { getDb } = await import("../db");
    const db = getDb();
    // `displayMode` vine din client (matchMedia standalone): pe Android
    // WebAPK-ul are același user-agent ca Chrome, deci e singurul mod de a
    // ști dacă abonarea s-a făcut din PWA-ul instalat sau dintr-o filă.
    db.prepare(
      `INSERT OR REPLACE INTO push_subscriptions
         (id, endpoint, p256dh, auth, created_at, user_agent, display_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      data.endpoint,
      data.p256dh,
      data.auth,
      new Date().toISOString(),
      getRequestHeader("user-agent") ?? null,
      data.displayMode ?? null,
    );
    return { ok: true };
  });

export interface PushSubscriptionRow {
  id: string;
  endpointTail: string;
  createdAt: string;
  lastSeenAt: string | null;
  userAgent: string | null;
  displayMode: string | null;
}

export const listPushSubscriptions = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("../auth/admin.server");
  await requireAdmin();
  const { getDb } = await import("../db");
  const rows = getDb()
    .prepare(
      `SELECT id, endpoint, created_at, last_seen_at, user_agent, display_mode
         FROM push_subscriptions ORDER BY created_at`,
    )
    .all() as Array<{
    id: string;
    endpoint: string;
    created_at: string;
    last_seen_at: string | null;
    user_agent: string | null;
    display_mode: string | null;
  }>;
  // Endpoint-ul complet e un secret funcțional (oricine îl are poate trimite
  // notificări în numele tău) — spre client pleacă doar coada, ca să poți
  // recunoaște dispozitivul curent.
  return rows.map<PushSubscriptionRow>((r) => ({
    id: r.id,
    endpointTail: r.endpoint.slice(-12),
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    userAgent: r.user_agent,
    displayMode: r.display_mode,
  }));
});

export const deletePushSubscription = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { getDb } = await import("../db");
    getDb().prepare("DELETE FROM push_subscriptions WHERE id = ?").run(data.id);
    return { ok: true };
  });

export const unsubscribePush = createServerFn({ method: "POST" })
  .validator((d: { endpoint: string }) => d)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("../auth/admin.server");
    await requireAdmin();
    const { getDb } = await import("../db");
    const db = getDb();
    db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(data.endpoint);
    return { ok: true };
  });
