/* Service worker mínimo: no hay partida sin conexión (necesita el
   WebSocket), así que aquí solo se cachea la cáscara de la app para
   que abrir el icono desde la pantalla de inicio sea instantáneo. */
"use strict";
const CACHE = "canaston-v1";           // subir el número si cambian mucho los estáticos
const CASCARA = ["/", "/sala.html", "/motor.js", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CASCARA)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(claves => Promise.all(claves.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(cache => {
      const red = fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => cache);
      return cache || red;
    })
  );
});
