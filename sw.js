/* ==================================================================
   BATFINANCE · Service worker
   - La app abre aunque haya mala señal: los archivos de la app se
     sirven del caché y se actualizan por detrás (la versión nueva se
     ve en la siguiente apertura).
   - Tus datos (/api/estado) se piden primero a internet; si no hay,
     se muestra la última copia guardada.
   - Notificaciones push: las muestra y al tocarlas abre la app.
   ================================================================== */
const CACHE = 'batfinance-v12';
const APP = [
  '/', '/index.html', '/manifest.webmanifest',
  '/css/styles.css', '/css/liquid.css',
  '/js/state.js', '/js/despertar.js', '/js/purchase-evaluator.js', '/js/render.js', '/js/modals.js', '/js/app.js', '/js/extras.js', '/js/metas.js', '/js/apuestas.js', '/js/tarjetas.js', '/js/motion.js',
  '/img/logo-batfinance-v2.png', '/img/bat-marca.png', '/img/icon-192.png', '/img/icon-512.png', '/img/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Datos: primero internet, si falla la última copia.
  if (url.pathname.endsWith('/api/estado')) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
        return res;
      }).catch(() => caches.match(req).then((r) => r || Response.error()))
    );
    return;
  }
  if (url.origin !== self.location.origin) return; // otras APIs y fuentes: normal

  // Archivos de la app: del caché al instante y se refrescan por detrás.
  e.respondWith(
    caches.open(CACHE).then((c) => c.match(req, { ignoreSearch: true }).then((guardado) => {
      const red = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => guardado);
      return guardado || red;
    }))
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { cuerpo: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'BATFINANCE', {
    body: d.cuerpo || '',
    icon: '/img/icon-192.png',
    badge: '/img/icon-192.png',
    data: { url: d.url || '/' },
    tag: d.tag
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
      for (const w of ws) { if ('focus' in w) { w.navigate(url); return w.focus(); } }
      return self.clients.openWindow(url);
    })
  );
});
