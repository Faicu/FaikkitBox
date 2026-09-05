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
 * Contextul în care rulează pagina în momentul abonării. Pe Android, PWA-ul
 * instalat (WebAPK) trimite exact același user-agent ca Chrome, deci UA-ul nu
 * poate deosebi cele două — `display-mode` e singurul semnal de încredere.
 */
function currentDisplayMode(): string {
  if (typeof window === "undefined" || !window.matchMedia) return "unknown";
  for (const mode of ["standalone", "fullscreen", "minimal-ui"]) {
    if (window.matchMedia(`(display-mode: ${mode})`).matches) return mode;
  }
  // iOS Safari nu suportă display-mode; expune în schimb navigator.standalone
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

  // `useServerFn` întoarce o funcție nouă la fiecare randare, deci nu poate sta
  // în lista de dependențe: efectul ar rula la fiecare randare, iar
  // reconcilierea (care poate chema `unsubscribe()`) s-ar suprapune peste
  // `pushManager.subscribe()` declanșat de buton. Două operații concurente pe
  // aceeași înregistrare fac Chrome să arunce
  // "Registration failed - push service error". O ținem într-un ref și rulăm
  // efectul o singură dată.
  const checkRef = useRef(checkRegistered);
  checkRef.current = checkRegistered;
  // Cât timp utilizatorul are o acțiune în curs, reconcilierea nu are voie să
  // atingă abonamentul.
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
      // Abonamentul local nu e suficient: rândul de pe server poate fi șters
      // din Tehnic sau expirat (410). Fără verificarea asta, interfața arăta
      // "activat" pentru un abonament la care nu mai putea ajunge nimic.
      let registered = true;
      try {
        ({ registered } = await checkRef.current({ data: { endpoint: sub.endpoint } }));
      } catch {
        // server indisponibil — nu presupunem că e dezabonat, lăsăm starea locală
        if (!cancelled) setState("subscribed");
        return;
      }
      if (cancelled || busyRef.current) return;
      if (registered) {
        setState("subscribed");
        return;
      }
      // Curățăm și local, ca butonul de activare să poată crea un abonament nou.
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

      // Dacă browserul are deja un abonament, îl refolosim în loc să chemăm
      // `subscribe()` din nou: un al doilea apel peste un abonament existent
      // eșuează cu "Registration failed - push service error" (mai ales dacă
      // vechiul abonament a fost creat cu altă cheie VAPID). Cazul apare des
      // după ce rândul a fost șters de pe server, dar abonamentul local a
      // rămas — atunci tot ce lipsește e reînregistrarea la noi în DB.
      let sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Cheia veche poate diferi de cea curentă; dacă diferă, abonamentul e
        // inutilizabil și trebuie înlocuit, nu refolosit.
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
