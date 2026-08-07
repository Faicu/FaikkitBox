// Helper propriu de trimitere Web Push pentru portalul Plex — folosește
// aceleași chei VAPID_* din env ca FaikkitBox, dar cu abonamente proprii
// (user_push_subscriptions din plex.db). Nu modifică /opt/faikkitbox/src/lib/push.ts.
import { createServerFn } from "@tanstack/react-start";
import webpush from "web-push";
import { getPlexDb } from "./plex-db";
import { requireUser } from "./auth.server";

let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL;
  if (!pub || !priv || !email) throw new Error("VAPID keys not configured");
  webpush.setVapidDetails(email, pub, priv);
  vapidConfigured = true;
}

async function sendToSubs(
  subs: Array<{ id: number; endpoint: string; p256dh: string; auth: string }>,
  title: string,
  body: string,
): Promise<void> {
  try {
    ensureVapid();
  } catch (err) {
    console.warn("[plex-push] VAPID neconfigurat:", err);
    return;
  }
  const db = getPlexDb();
  const payload = JSON.stringify({ title, body });
  const dead: number[] = [];
  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 410 || statusCode === 404) dead.push(sub.id);
        else console.warn(`[plex-push] Trimitere eșuată: ${statusCode ?? ""}`, err);
      }
    }),
  );
  for (const id of dead) {
    db.prepare("DELETE FROM user_push_subscriptions WHERE id = ?").run(id);
  }
}

/** Trimite push tuturor abonamentelor active ale unui user (dacă are enabled=1). */
export async function pushToUser(userId: number, title: string, body: string): Promise<void> {
  const db = getPlexDb();
  const subs = db
    .prepare(
      "SELECT id, endpoint, p256dh, auth FROM user_push_subscriptions WHERE user_id = ? AND enabled = 1",
    )
    .all(userId) as Array<{ id: number; endpoint: string; p256dh: string; auth: string }>;
  await sendToSubs(subs, title, body);
}

/** Trimite push tuturor adminilor (rol admin, status approved, notif activate). */
export async function pushToAdmins(title: string, body: string): Promise<void> {
  const db = getPlexDb();
  const admins = db
    .prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'approved'")
    .all() as Array<{ id: number }>;
  for (const admin of admins) {
    await pushToUser(admin.id, title, body);
  }
}

// ---------------------------------------------------------------------------
// Server-fn-uri pentru widget-ul de notificări din /app (componenta 2 din
// dashboard-ul userului logat) — Notification.requestPermission() +
// ServiceWorker.subscribe() pe client, salvate aici.
// ---------------------------------------------------------------------------
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
