const CACHE_NAME = 'autorus-cache-v3';
const ASSETS_TO_CACHE = [
  './',
  'index.html',
  'manifest.json',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'css/main.css',
  'css/components.css',
  'css/canvas.css',
  'css/booklet.css',
  'css/vdp.css',
  'css/duplex.css',
  'js/ai-advisor.js',
  'js/app.js',
  'js/booklet.js',
  'js/calculator.js',
  'js/canvas.js',
  'js/export.js',
  'js/file-reader.js',
  'js/packing.js',
  'js/projects.js',
  'js/protection.js',
  'js/vdp.js',
  'js/duplex.js'
];

// Install Event - Pre-cache offline assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Pre-caching offline assets');
        // Cache files individually or catch errors to prevent whole install failing
        return Promise.allSettled(
          ASSETS_TO_CACHE.map(url => {
            return cache.add(url).catch(err => {
              console.warn(`[Service Worker] Failed to cache: ${url}`, err);
            });
          })
        );
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Clearing old cache', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Network First with Cache Fallback for dynamic updates
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Skip Firebase services, analytics, external APIs, local auth actions, and large executable/archive downloads from being cached
  if (
    url.origin.includes('firebase') || 
    url.origin.includes('googleapis') || 
    url.pathname.includes('/__/') || 
    url.origin.includes('firestore') ||
    url.pathname.endsWith('.exe') ||
    url.pathname.endsWith('.zip')
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache new successful GET responses
        if (response && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Offline fallback
        return caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // If it's a page navigation request, fall back to index.html
          if (event.request.mode === 'navigate') {
            return caches.match('index.html');
          }
        });
      })
  );
});

// Force immediate activation when requested by UI
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
