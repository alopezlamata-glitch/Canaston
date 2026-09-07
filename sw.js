/* Service worker mínimo: la partida online no funciona sin conexión
   (necesita el WebSocket), pero "Jugar en un dispositivo" sí es un
   juego completo sin servidor, así que aquí se cachea toda la cáscara
   de la app -incluido canaston.html- para que funcione de verdad sin
   conexión y para que abrir el icono sea instantáneo. */
"use strict";
const CACHE = "canaston-v2";           // subir el número si cambian mucho los estáticos
const CASCARA = ["/", "/sala.html", "/canaston.html", "/motor.js", "/manifest.json", "/icon-192.png", "/icon-512.png"];

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
