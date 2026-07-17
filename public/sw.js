self.addEventListener("push", (event) => {
  if (!event.data) return;
  let title = "FaikkitBox";
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
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      vibrate: [100, 50, 100],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
