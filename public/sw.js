/* Service worker : affiche les notifications push, même page fermée. */
'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: event.data && event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Suivi en direct', {
      body: data.body || '',
      icon: data.icon || '/img/icon-192.png',
      badge: '/img/icon-192.png',
      tag: data.tag,
      data: { url: data.url || '/' },
      vibrate: [120, 60, 120],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = wins.find((w) => new URL(w.url).pathname === new URL(url, self.location.origin).pathname);
    if (existing) return existing.focus();
    return self.clients.openWindow(url);
  })());
});
