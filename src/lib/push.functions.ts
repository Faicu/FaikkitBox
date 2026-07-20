import { createServerFn } from "@tanstack/react-start";
import { randomUUID } from "node:crypto";

export const getVapidPublicKey = createServerFn({ method: "GET" }).handler(() => {
  return { publicKey: process.env.VAPID_PUBLIC_KEY ?? null };
});

export const subscribePush = createServerFn({ method: "POST" })
  .validator((d: { endpoint: string; p256dh: string; auth: string }) => d)
  .handler(async ({ data }) => {
    const { getDb } = await import("./db");
    const db = getDb();
    db.prepare(
      "INSERT OR REPLACE INTO push_subscriptions (id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(randomUUID(), data.endpoint, data.p256dh, data.auth, new Date().toISOString());
    return { ok: true };
  });

export const unsubscribePush = createServerFn({ method: "POST" })
  .validator((d: { endpoint: string }) => d)
  .handler(async ({ data }) => {
    const { getDb } = await import("./db");
    const db = getDb();
    db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(data.endpoint);
    return { ok: true };
  });

export const getPushSubscriptionCount = createServerFn({ method: "GET" }).handler(async () => {
  const { getDb } = await import("./db");
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as count FROM push_subscriptions").get() as {
    count: number;
  };
  return { count: row.count };
});
