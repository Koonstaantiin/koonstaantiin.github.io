const CACHE_NAME = 'chomuchka-pwa-v3';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './css/utilities.css',
  './css/styles.css',
  './js/state.js',
  './js/audio.js',
  './js/api.js',
  './js/tts.js',
  './js/gemini.js',
  './js/pipeline.js',
  './js/recording.js',
  './js/ui.js',
  './fonts/inter-latin-wght-normal.woff2',
  './fonts/inter-cyrillic-wght-normal.woff2',
  './audio/no_key.wav',
  './audio/ready_intro.wav',
  './audio/listening_hint.wav',
  './audio/thinking_filler.wav',
  './audio/next_action_hint.wav',
  './audio/daily_limit.wav'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)).catch(() => {})
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

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
