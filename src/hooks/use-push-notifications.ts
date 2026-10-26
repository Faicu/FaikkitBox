import { useState, useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  subscribePush,
  unsubscribePush,
  getVapidPublicKey,
  isPushEndpointRegistered,
} from "@/lib/notifications/push.functions";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Contextul paginii la abonare: pe Android PWA-ul și Chrome au același
 * user-agent, deci `display-mode` e singurul semnal de încredere.
 */
function currentDisplayMode(): string {
  if (typeof window === "undefined" || !window.matchMedia) return "unknown";
  for (const mode of ["standalone", "fullscreen", "minimal-ui"]) {
    if (window.matchMedia(`(display-mode: ${mode})`).matches) return mode;
  }
  // iOS Safari n-are display-mode, dar are navigator.standalone.
  if ((window.navigator as { standalone?: boolean }).standalone) return "standalone";
  return "browser";
}

export type PushState = "unsupported" | "denied" | "subscribed" | "unsubscribed" | "loading";
export type PushError = string | null;

export function usePushNotifications() {
  const [state, setState] = useState<PushState>("loading");
  const [error, setError] = useState<PushError>(null);
  const doSubscribe = useServerFn(subscribePush);
  const doUnsubscribe = useServerFn(unsubscribePush);
  const getKey = useServerFn(getVapidPublicKey);
  const checkRegistered = useServerFn(isPushEndpointRegistered);

  // Server function-ul stă într-un ref și efectul rulează o singură dată:
  // reconcilierea (care poate chema `unsubscribe()`) nu are voie să se
  // suprapună peste `subscribe()` din buton — Chrome aruncă atunci
  // „Registration failed - push service error”.
  const checkRef = useRef(checkRegistered);
  checkRef.current = checkRegistered;
  // Cât utilizatorul are o acțiune în curs, reconcilierea nu atinge abonamentul.
  const busyRef = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    let cancelled = false;
    navigator.serviceWorker.ready.then(async (reg) => {
      if (cancelled || busyRef.current) return;
      const sub = await reg.pushManager.getSubscription();
      if (cancelled || busyRef.current) return;
      if (!sub) {
        setState(Notification.permission === "denied" ? "denied" : "unsubscribed");
        return;
      }
      // Rândul de pe server poate fi șters sau expirat (410) — altfel interfața
      // arăta „activat” pentru un abonament mort.
      let registered: boolean;
      try {
        ({ registered } = await checkRef.current({ data: { endpoint: sub.endpoint } }));
      } catch {
        // Server indisponibil — nu presupunem dezabonarea.
        if (!cancelled) setState("subscribed");
        return;
      }
      if (cancelled || busyRef.current) return;
      if (registered) {
        setState("subscribed");
        return;
      }
      // Curățat și local, ca activarea să poată crea unul nou.
      await sub.unsubscribe().catch(() => {});
      if (!cancelled) setState(Notification.permission === "denied" ? "denied" : "unsubscribed");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function subscribe() {
    busyRef.current = true;
    setState("loading");
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await getKey();
      if (!publicKey) throw new Error("Lipsește cheia VAPID de pe server");

      // Un abonament existent se refolosește: un al doilea `subscribe()` eșuează
      // („push service error”), mai ales cu altă cheie VAPID. Frecvent după
      // ștergerea rândului de pe server — lipsește doar reînregistrarea.
      let sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Cu altă cheie, abonamentul e inutilizabil — se înlocuiește.
        const current = urlBase64ToUint8Array(publicKey);
        const existing = sub.options?.applicationServerKey;
        const sameKey =
          existing != null &&
          new Uint8Array(existing).length === current.length &&
          new Uint8Array(existing).every((b, i) => b === current[i]);
        if (!sameKey) {
          await sub.unsubscribe().catch(() => {});
          sub = null;
        }
      }
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      const json = sub.toJSON();
      await doSubscribe({
        data: {
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
          displayMode: currentDisplayMode(),
        },
      });
      setState("subscribed");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[push] Eroare la abonare:", msg, e);
      setError(msg);
      setState(Notification.permission === "denied" ? "denied" : "unsubscribed");
    } finally {
      busyRef.current = false;
    }
  }

  async function unsubscribe() {
    busyRef.current = true;
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
    } finally {
      busyRef.current = false;
    }
  }

  return { state, error, subscribe, unsubscribe };
}
