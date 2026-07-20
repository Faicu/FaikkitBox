import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { subscribePush, unsubscribePush, getVapidPublicKey } from "@/lib/push.functions";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export type PushState = "unsupported" | "denied" | "subscribed" | "unsubscribed" | "loading";
export type PushError = string | null;

export function usePushNotifications() {
  const [state, setState] = useState<PushState>("loading");
  const [error, setError] = useState<PushError>(null);
  const doSubscribe = useServerFn(subscribePush);
  const doUnsubscribe = useServerFn(unsubscribePush);
  const getKey = useServerFn(getVapidPublicKey);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        setState("subscribed");
      } else if (Notification.permission === "denied") {
        setState("denied");
      } else {
        setState("unsubscribed");
      }
    });
  }, []);

  async function subscribe() {
    setState("loading");
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await getKey();
      if (!publicKey) throw new Error("Lipsește cheia VAPID de pe server");

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const json = sub.toJSON();
      await doSubscribe({
        data: {
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
        },
      });
      setState("subscribed");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[push] Eroare la abonare:", msg, e);
      setError(msg);
      setState(Notification.permission === "denied" ? "denied" : "unsubscribed");
    }
  }

  async function unsubscribe() {
    setState("loading");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await doUnsubscribe({ data: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setState("unsubscribed");
    } catch {
      setState("subscribed");
    }
  }

  return { state, error, subscribe, unsubscribe };
}
