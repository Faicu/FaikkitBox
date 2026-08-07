// Cod care depinde de pachetul "web-push" (și tranzitiv de crypto Node —
// asn1.js/jws/jwa — care nu rulează în browser). Ținut STRICT separat de
// push.ts (importat de hook-ul client use-push-notifications.ts): dacă
// funcțiile astea ar sta în același fișier ca server-fn-urile createServerFn,
// tot modulul (inclusiv "import webpush from 'web-push'") ar ajunge în
// bundle-ul de client, unde `Buffer`/crypto Node nu există — exact bug-ul
// "Cannot read properties of undefined (reading 'prototype')" la /app.
// Acest fișier e importat DOAR din server-fn-uri din alte fișiere
// (media.functions.ts, users.functions.ts), niciodată dintr-un component React.
import webpush from "web-push";
import { getPlexDb } from "./plex-db";

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
