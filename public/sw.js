// Service Worker do Painel — hoje usado só pra receber push notifications do Pedro.
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener("push", (event) => {
  let data = { title: "Pedro 🐾", body: "" };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch { if (event.data) data.body = event.data.text(); }
  event.waitUntil(
    self.registration.showNotification(data.title || "Pedro 🐾", {
      body: data.body || "",
      icon: "/radioactive-icon.png",
      badge: "/radioactive-icon.png",
      tag: data.tag || "pedro-painel",
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) { if ("focus" in client) return client.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
