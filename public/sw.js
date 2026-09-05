// Cache-ul ține STRICT iconițele de notificare. Motiv: `icon` și `badge` nu
// sunt încorporate în notificare, ci sunt URL-uri pe care browserul le descarcă
// în momentul afișării. Notificarea "Serverul s-a oprit" pleacă exact când
// serverul moare, deci fetch-ul lor eșuează și Android cade pe fallback —
// clopoțel în bara de stare și avatar-literă în locul logo-ului. Din cache,
// iconițele sunt disponibile chiar și cu serverul căzut.
//
// Bumpează versiunea când se schimbă vreuna dintre imagini; `activate` șterge
// cache-urile cu alt nume.
const ASSET_CACHE = "faikkitbox-notif-icons-v1";
const CACHED_ASSETS = ["/icon-192.png", "/badge-96.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(ASSET_CACHE)
      .then((cache) => cache.addAll(CACHED_ASSETS))
      // Dacă serverul e picat chiar la instalare, nu blocăm instalarea —
      // cache-ul se va umple la următoarea versiune de SW.
      .catch(() => {}),
  );
  // Preluăm controlul imediat: fără asta, o versiune nouă rămâne "waiting"
  // până se închid toate filele PWA, iar schimbările apar cu întârziere de zile.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n !== ASSET_CACHE).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

// Interceptăm exclusiv cele două iconițe. Orice altă cerere trece neatinsă:
// nu chemăm respondWith, deci browserul face rețea normal.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!CACHED_ASSETS.includes(url.pathname)) return;

  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ??
        fetch(event.request).then((res) => {
          // Reîmprospătăm cache-ul când rețeaua răspunde.
          if (res.ok) {
            const copy = res.clone();
            caches.open(ASSET_CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        }),
    ),
  );
});

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
