// SW-ul ăsta doar primește push-uri, nu ține niciun cache — deci poate prelua
// controlul imediat, fără riscul de a servi assets vechi. Fără cele două,
// o versiune nouă a fișierului rămâne "waiting" până se închid toate filele,
// iar modificări ca iconița de notificare apar cu întârziere de zile.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let title = "FaikkitBox";
  let body = "";
  let image;
  let url = "/";
  try {
    const data = event.data.json();
    title = data.title ?? title;
    body = data.body ?? "";
    image = data.image ?? undefined;
    url = data.url ?? "/";
  } catch {
    body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      // `badge` = iconița mică din bara de stare Android. Sistemul o folosește
      // DOAR ca mască: păstrează canalul alfa și umple restul cu alb. Aici era
      // icon-192.png, care e complet opac (alfa 255 peste tot), deci masca ieșea
      // dreptunghi plin — un pătrat alb în bara de notificări. badge-96.png e
      // monocrom, cu fundal transparent, exact ce așteaptă Android.
      badge: "/badge-96.png",
      image,
      vibrate: [100, 50, 100],
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(clients.openWindow(url));
});
