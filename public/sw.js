// Service worker estándar del ecosistema (§3): navegación network-first (deploys
// instantáneos; offline cae a caché), resto cache-first con refresco en segundo
// plano. Subir N de CACHE en cada cambio de assets cacheados.
const CACHE = 'critters-v54';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;   // no tocar store/jsDelivr/GoatCounter
  const nav = e.request.mode === 'navigate' || e.request.destination === 'document';
  if (nav) {
    e.respondWith(fetch(e.request).then(res => { const c = res.clone(); caches.open(CACHE).then(x => x.put(e.request, c)).catch(() => {}); return res; }).catch(() => caches.match(e.request).then(c => c || caches.match('./index.html'))));
    return;
  }
  e.respondWith(caches.match(e.request).then(cached => {
    const net = fetch(e.request).then(res => { const c = res.clone(); caches.open(CACHE).then(x => x.put(e.request, c)).catch(() => {}); return res; }).catch(() => cached);
    return cached || net;
  }));
});
