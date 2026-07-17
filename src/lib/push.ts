import webpush from "web-push";

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

export async function sendPushToAll(title: string, body: string): Promise<void> {
  try {
    ensureVapid();
    const { getDb } = await import("./db");
    const db = getDb();
    const subs = db.prepare("SELECT * FROM push_subscriptions").all() as Array<{
      id: string; endpoint: string; p256dh: string; auth: string;
    }>;

    const payload = JSON.stringify({ title, body });
    const dead: string[] = [];

    await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          );
        } catch (err: any) {
          if (err?.statusCode === 410 || err?.statusCode === 404) dead.push(sub.id);
        }
      }),
    );

    for (const id of dead) {
      db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(id);
    }
  } catch {
    // Nu blocăm dacă push eșuează
  }
}
