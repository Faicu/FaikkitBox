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
      badge: "/icon-192.png",
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
