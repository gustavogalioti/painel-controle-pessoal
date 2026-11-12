// Service Worker do Painel — hoje usado só pra receber push notifications do Pedro (o gato virtual).
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener("push", (event) => {
  let data = { title: "Pedro 🐾", body: "" };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch { if (event.data) data.body = event.data.text(); }
  event.waitUntil(
    self.registration.showNotification(data.title || "Pedro 🐾", {
      body: data.body || "",
      icon: "/pedro-avatar.jpg",
      badge: "/pedro-avatar.jpg",
      tag: data.tag || "pedro-painel",
      data: data.data || { pedro: true, texto: data.body || "" },
      renotify: true,
    })
  );
});

// Tocar no push abre a tela do Pedro já com a mensagem na bolha (?pedro=1&msg=...). Se o app já está aberto,
// só foca e avisa a página (postMessage).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const texto = String((event.notification.data && event.notification.data.texto) || event.notification.body || "").slice(0, 200);
  const url = "/?pedro=1&msg=" + encodeURIComponent(texto);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) { client.postMessage({ type: "pedro-open", msg: texto }); return client.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
