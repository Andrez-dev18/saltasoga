self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((k) => caches.delete(k)));
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Nunca tocar peticiones de la API ni métodos que no sean GET
  if (url.hostname.includes('api-saltasoga') || url.pathname.startsWith('/api') || event.request.method !== 'GET') {
    return;
  }

  // 2. Pasar el resto directo a la red sin guardar nada en caché
  event.respondWith(fetch(event.request));
});