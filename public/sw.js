// G.U.R.U. Service Worker — network-first for HTML, cache-first for static assets
// Bump CACHE version any time you deploy — forces old cache deletion
const CACHE   = 'guru-v200';
const STATIC  = ['/icon.png', '/manifest.json'];

// ── INSTALL ────────────────────────────────────────────────────────
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(STATIC).catch(() => {}))
    );
    self.skipWaiting(); // activate immediately, don't wait for old SW to die
});

// ── ACTIVATE ───────────────────────────────────────────────────────
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim(); // take control of all open tabs immediately
});

// ── FETCH ──────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
    // Only handle same-origin requests
    if (!e.request.url.startsWith(self.location.origin)) return;

    const url = new URL(e.request.url);

    // ── HTML navigation: network-first ──────────────────────────────
    // Always fetch fresh so updates appear immediately on mobile Safari.
    // Fall back to cache only if completely offline.
    if (
        e.request.mode === 'navigate' ||
        url.pathname === '/' ||
        url.pathname.endsWith('.html')
    ) {
        e.respondWith(
            fetch(e.request, { cache: 'no-store' })
                .then(resp => {
                    if (resp.ok) {
                        const clone = resp.clone();
                        caches.open(CACHE).then(c => c.put(e.request, clone));
                    }
                    return resp;
                })
                .catch(() => caches.match(e.request).then(cached => cached || fetch(e.request)))
        );
        return;
    }

    // ── Static assets: cache-first ──────────────────────────────────
    e.respondWith(
        caches.match(e.request).then(cached => {
            if (cached) return cached;
            return fetch(e.request).then(resp => {
                if (resp && resp.ok && resp.type === 'basic') {
                    const clone = resp.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone));
                }
                return resp;
            });
        })
    );
});
