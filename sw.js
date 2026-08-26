const CACHE_NAME = 'oktshop17-pos-v2';

const CORE_ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './qris.jpg'
];

const CDN_ASSETS = [
    'https://cdn.tailwindcss.com',
    'https://unpkg.com/lucide@latest',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.23/jspdf.plugin.autotable.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jsqr/1.4.0/jsQR.js',
    'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js',
    'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js',
    'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js'
];

// Domain-domain Firestore/Firebase Auth TIDAK boleh di-cache atau dipotong oleh service worker,
// karena request ke sini bersifat live/streaming (real-time sync) dan butuh selalu langsung ke
// server, bukan dijawab dari cache. Kalau di-cache, data antar-HP bisa jadi tidak sinkron.
const NEVER_CACHE_HOSTS = [
    'firestore.googleapis.com',
    'firebaseapp.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'googleapis.com'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // Cache file inti dulu (wajib berhasil)
            return cache.addAll(CORE_ASSETS).then(() => {
                // Coba cache aset CDN, tapi jangan gagalkan instalasi jika salah satu gagal
                return Promise.all(
                    CDN_ASSETS.map((url) =>
                        fetch(url, { mode: 'no-cors' })
                            .then((res) => cache.put(url, res))
                            .catch(() => {})
                    )
                );
            });
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Strategi: cache-first, lalu update cache di background jika online (stale-while-revalidate ringan)
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    // Biarkan request ke Firestore/Firebase Auth lewat langsung ke network, jangan diintervensi
    const url = event.request.url;
    if (NEVER_CACHE_HOSTS.some((host) => url.includes(host))) {
        return; // tidak memanggil event.respondWith() => browser jalan seperti biasa (network langsung)
    }

    event.respondWith(
        caches.match(event.request).then((cached) => {
            const fetchPromise = fetch(event.request)
                .then((networkRes) => {
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, networkRes.clone());
                    });
                    return networkRes;
                })
                .catch(() => cached);

            return cached || fetchPromise;
        })
    );
});
