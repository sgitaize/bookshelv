// bookshelv Service Worker: App-Hülle cachen, API und Cover immer frisch vom Server (Cover zusätzlich aus Cache).
const CACHE = 'bookshelv-v2';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // Cover und gehashte Assets ändern sich nie → Cache zuerst
  if (url.pathname.startsWith('/covers/') || url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    })));
    return;
  }

  // Seiten: Netzwerk zuerst, offline die zuletzt geladene App-Hülle
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put('/', copy));
      return res;
    }).catch(() => caches.match('/')));
  }
});

// Web Push: der Push trägt keine Daten (Datenschutz) – Anzahl ungelesener Benachrichtigungen selbst abholen
self.addEventListener('push', e => {
  const de = (self.navigator.language || '').toLowerCase().startsWith('de');
  e.waitUntil(fetch('/api/notifications/count', { credentials: 'same-origin' })
    .then(r => (r.ok ? r.json() : { unread: 0 })).catch(() => ({ unread: 0 }))
    .then(({ unread }) => self.registration.showNotification('bookshelv', {
      body: unread > 1 ? (de ? `${unread} neue Benachrichtigungen` : `${unread} new notifications`) : (de ? 'Neue Benachrichtigung' : 'New notification'),
      icon: '/icon-192.png', badge: '/icon-192.png', tag: 'bookshelv', renotify: true
    })));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => new URL(c.url).origin === location.origin);
    if (open) { open.navigate('/notifications'); return open.focus(); }
    return self.clients.openWindow('/notifications');
  }));
});
