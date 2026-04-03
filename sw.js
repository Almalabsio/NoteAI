// ═══════════════════════════════════════════════════════════════
//   NoteAI — Service Worker v1.0
//   Estrategia: Cache-first para assets, Network-first para API
// ═══════════════════════════════════════════════════════════════

var CACHE_NAME = 'noteai-v1.8';
var OFFLINE_URL = 'index.html';

// Archivos que se guardan en caché al instalar
var ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  // Fuentes de Google (se cachean dinámicamente en runtime)
];

// URLs de Google Fonts que también vamos a cachear en runtime
var FONT_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com'
];

// ── INSTALL ─────────────────────────────────────────────────────
self.addEventListener('install', function(event) {
  console.log('[SW] Instalando v1...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[SW] Cacheando assets principales...');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(function() {
      // Activar inmediatamente sin esperar a que cierren otras pestañas
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE ────────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
  console.log('[SW] Activando...');
  event.waitUntil(
    // Eliminar cachés viejos
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; })
            .map(function(key) {
              console.log('[SW] Eliminando caché viejo:', key);
              return caches.delete(key);
            })
      );
    }).then(function() {
      // Tomar control de todas las pestañas abiertas inmediatamente
      return self.clients.claim();
    })
  );
});

// ── FETCH ───────────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // 1) Llamadas a la API de Google Sheets → Network-first (no cachear)
  if (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com') {
    event.respondWith(
      fetch(event.request).catch(function() {
        // Sin conexión: devolver respuesta de error controlada en JSON
        return new Response(
          JSON.stringify({ ok: false, msg: 'Sin conexión — los cambios se sincronizarán cuando vuelvas a tener red.' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // 2) Fuentes de Google → Cache-first con fallback a red
  var isFontRequest = FONT_ORIGINS.some(function(origin) {
    return url.href.startsWith(origin);
  });
  if (isFontRequest) {
    event.respondWith(
      caches.open(CACHE_NAME).then(function(cache) {
        return cache.match(event.request).then(function(cached) {
          if (cached) return cached;
          return fetch(event.request).then(function(response) {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          });
        });
      })
    );
    return;
  }

  // 4) Todo lo demás (HTML, CSS, JS inline) → Cache-first con Network fallback
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) {
        // Servir desde caché y actualizar en background (stale-while-revalidate)
        var networkUpdate = fetch(event.request).then(function(response) {
          if (response && response.status === 200 && response.type !== 'opaque') {
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, response.clone());
            });
          }
          return response;
        }).catch(function() {});
        return cached;
      }

      // No está en caché: ir a la red
      return fetch(event.request).then(function(response) {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        // Guardar en caché para la próxima vez
        var responseToCache = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, responseToCache);
        });
        return response;
      }).catch(function() {
        // Sin red y sin caché: servir el index.html (SPA fallback)
        if (event.request.destination === 'document') {
          return caches.match(OFFLINE_URL);
        }
      });
    })
  );
});

// ── MENSAJES ────────────────────────────────────────────────────
self.addEventListener('message', function(event) {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});

// ── BACKGROUND SYNC (si el browser lo soporta) ──────────────────
// Cuando vuelve la red, notificar a la app para que sincronice
self.addEventListener('sync', function(event) {
  if (event.tag === 'sync-notes') {
    console.log('[SW] Background sync: sincronizando notas...');
    event.waitUntil(
      self.clients.matchAll().then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ action: 'syncNow' });
        });
      })
    );
  }
});
