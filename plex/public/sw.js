// Service worker propriu pentru portalul Plex (plex.faicu.ro) — fișier nou,
// separat de /opt/faikkitbox/public/sw.js (nu se atinge).
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let title = "Plex";
  let body = "";
  try {
    const data = event.data.json();
    title = data.title ?? title;
    body = data.body ?? "";
  } catch {
    body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      vibrate: [100, 50, 100],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/app"));
});
