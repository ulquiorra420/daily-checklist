// Service worker: only shows reminder notifications. No caching, so app updates are never held back.
self.addEventListener('push', e => {
  const m = e.data ? e.data.json() : { title: 'Daily Checklist' };
  e.waitUntil(self.registration.showNotification(m.title, { body: m.body || '' }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(ws => ws.length ? ws[0].focus() : clients.openWindow('./')));
});
