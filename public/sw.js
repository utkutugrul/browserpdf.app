'use strict';

// Bump this deterministic revision whenever an allowlisted shell asset changes.
// A waiting worker must populate its own cache instead of mutating the cache
// still served by the active worker before the user accepts the update.
const SHELL_REVISION = 'v1';
const CACHE_NAME = `bpdf-shell-${SHELL_REVISION}`;
const CACHE_PREFIX = 'bpdf-';
const OFFLINE_DOCUMENT = '/offline.html';
const STATIC_ALLOWLIST = Object.freeze([
  '/offline.html',
  '/css/offline.css',
  '/css/styles.css',
  '/favicon-32.png',
  '/apple-touch-icon.png',
  '/pwa/icon-192.png',
  '/pwa/icon-512.png',
  '/manifest.webmanifest',
  '/js/pwa.js',
]);
let offlineCacheEnabled = true;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ALLOWLIST)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_WAITING_UPDATE') void self.skipWaiting();
  if (event.data?.type === 'DISABLE_OFFLINE_CACHE') {
    // Unregistering does not immediately stop a worker that still controls an
    // open page. Disable fetch handling before the UI deletes owned caches so
    // an in-flight shell request cannot recreate the cache after removal.
    offlineCacheEnabled = false;
    event.ports[0]?.postMessage({ disabled: true });
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !['http:', 'https:'].includes(url.protocol)) return;
  if (!offlineCacheEnabled) return;
  if (url.pathname.startsWith('/metrics/')) {
    event.respondWith(fetch(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      const cached = await caches.open(CACHE_NAME);
      return cached.match(OFFLINE_DOCUMENT);
    }));
    return;
  }
  if (url.search || !STATIC_ALLOWLIST.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
    return response;
  })());
});
