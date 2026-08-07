// Server-fn-uri pentru widget-ul de notificări din /app (componenta 2 din
// dashboard-ul userului logat) — Notification.requestPermission() +
// ServiceWorker.subscribe() pe client, salvate aici.
//
// IMPORTANT: acest fișier e importat de hook-ul client
// (src/hooks/use-push-notifications.ts), deci NU trebuie să importe "web-push"
// (sau orice altceva ce depinde de Buffer/crypto Node) nici măcar tranzitiv —
// vezi push-server.ts pentru trimiterea efectivă de notificări.
import { createServerFn } from "@tanstack/react-start";
import { getPlexDb } from "./plex-db";
import { requireUser } from "./auth.server";

export const getVapidPublicKey = createServerFn({ method: "GET" }).handler(async () => {
  return { publicKey: process.env.VAPID_PUBLIC_KEY ?? null };
});

export const subscribeUserPush = createServerFn({ method: "POST" })
  .validator((data: { endpoint: string; p256dh: string; auth: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const db = getPlexDb();
    db.prepare(
      `INSERT INTO user_push_subscriptions (user_id, endpoint, p256dh, auth, enabled, created_at)
       VALUES (?, ?, ?, ?, 1, datetime('now'))
       ON CONFLICT(user_id, endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, enabled = 1`,
    ).run(user.id, data.endpoint, data.p256dh, data.auth);
    return { status: "ok" as const };
  });

export const unsubscribeUserPush = createServerFn({ method: "POST" })
  .validator((data: { endpoint: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const db = getPlexDb();
    db.prepare(
      "DELETE FROM user_push_subscriptions WHERE user_id = ? AND endpoint = ?",
    ).run(user.id, data.endpoint);
    return { status: "ok" as const };
  });
