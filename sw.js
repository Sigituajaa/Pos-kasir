// Service worker sederhana: bikin aplikasi ini bisa di-install (PWA) di Android/desktop
// dan tetap bisa dibuka (app shell) walau koneksi internet sedang jelek.
const CACHE_NAME = 'cireng-pos-cache-v1';
const APP_SHELL = [
    './',
    './index.html',
    './script.js',
    './style.css',
    './manifest.json',
    './qris.jpg',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-192.png',
    './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // Cache satu-satu supaya satu file yang gagal (misal belum ada) tidak menggagalkan install
            return Promise.all(
                APP_SHELL.map((url) => cache.add(url).catch(() => {}))
            );
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then((cached) => {
            const networkFetch = fetch(event.request)
                .then((response) => {
                    if (response && response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => cached);
            return cached || networkFetch;
        })
    );
});
