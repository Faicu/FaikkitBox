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

// Erori de rețea temporare (DNS încă nepornit, conexiune căzută) — tipic în
// prima secundă după un reboot, când serviciul pornește odată cu
// network-online.target, dar resolverul încă nu răspunde. Merită reîncercate;
// orice altceva (răspuns HTTP de la FCM, chei greșite) nu.
const TRANSIENT_CODES = new Set([
  "EAI_AGAIN",
  "ENOTFOUND",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);
const RETRY_DELAYS_MS = [3_000, 10_000];

async function sendWithRetry(
  subscription: webpush.PushSubscription,
  payload: string,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await webpush.sendNotification(subscription, payload);
      return;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      const delay = RETRY_DELAYS_MS[attempt];
      if (!code || !TRANSIENT_CODES.has(code) || delay === undefined) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export async function sendPushToAll(
  title: string,
  body: string,
  opts?: { image?: string | null; url?: string },
): Promise<void> {
  try {
    ensureVapid();
    const { getDb } = await import("../db");
    const db = getDb();
    const subs = db.prepare("SELECT * FROM push_subscriptions").all() as Array<{
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>;

    const payload = JSON.stringify({
      title,
      body,
      image: opts?.image ?? undefined,
      url: opts?.url ?? "/",
    });
    const dead: string[] = [];
    const alive: string[] = [];

    await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await sendWithRetry(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          );
          alive.push(sub.id);
        } catch (err) {
          const statusCode = (err as { statusCode?: number })?.statusCode;
          if (statusCode === 410 || statusCode === 404) {
            dead.push(sub.id);
          } else {
            console.warn(
              `[push] Trimitere eșuată către ${sub.endpoint.slice(-12)}: ${statusCode ?? ""} ${(err as Error)?.message ?? err}`,
            );
          }
        }
      }),
    );

    for (const id of dead) {
      db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(id);
    }
    // Atenție la interpretare: serviciul de push (FCM) acceptă mesajul înainte
    // să-l livreze, deci `last_seen_at` înseamnă "acceptat spre livrare", nu
    // "chiar a ajuns pe dispozitiv". Un abonament abandonat poate rămâne
    // acceptat săptămâni, până când FCM îl marchează expirat (410).
    if (alive.length > 0) {
      const now = new Date().toISOString();
      const stmt = db.prepare("UPDATE push_subscriptions SET last_seen_at = ? WHERE id = ?");
      for (const id of alive) stmt.run(now, id);
    }
  } catch (err) {
    console.warn("[push] sendPushToAll a eșuat:", err);
  }
}
