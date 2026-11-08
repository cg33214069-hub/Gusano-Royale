self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open('gusanos-royale-v1').then((cache) => {
      return cache.addAll([
        './dashboard.html',
        './game.html',
        './script.js'
      ]);
    })
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});