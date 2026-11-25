// Service worker: only shows reminder notifications. No caching, so app updates are never held back.
// Each reminder has a tag ('water', 'summary', 'morning', 'plan-<id>'): a new one with the same tag replaces
// the old one on the lock screen instead of piling up, and renotify makes the phone still buzz for it.
self.addEventListener('push', e => {
  const m = e.data ? e.data.json() : { title: 'Daily Checklist' };
  const opts = { body: m.body || '' };
  if (m.tag) Object.assign(opts, { tag: m.tag, renotify: true });
  e.waitUntil(self.registration.showNotification(m.title, opts));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(ws => ws.length ? ws[0].focus() : clients.openWindow('./')));
});
