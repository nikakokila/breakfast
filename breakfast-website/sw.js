// Offline support: keeps a copy of the whole app on the tablet.
// Generated list of files; the version changes whenever any file changes, so updates are picked up.
const VERSION = 'c92ca31d15';
const CACHE = 'breakfast-app-' + VERSION;
const FONT_CACHE = 'breakfast-fonts';
const FILES = [
  "./",
  "css/styles.css",
  "css/themes.css",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "img/emblem.svg",
  "index.html",
  "js/analytics.js",
  "js/app.js",
  "js/backend/analytics.js",
  "js/backend/api.js",
  "js/backend/security.js",
  "js/backend/store.js",
  "js/celebrate.js",
  "js/guest-import.js",
  "js/history.js",
  "js/install.js",
  "js/lib.js",
  "js/rooms.js",
  "js/settings.js",
  "js/shift.js",
  "js/sounds.js",
  "js/themes.js",
  "manifest.webmanifest",
  "vendor/fonts/OFL-Fraunces.txt",
  "vendor/fonts/OFL-Manrope.txt",
  "vendor/fonts/OFL-anton.txt",
  "vendor/fonts/OFL-bebasneue.txt",
  "vendor/fonts/OFL-blackopsone.txt",
  "vendor/fonts/OFL-caveat.txt",
  "vendor/fonts/OFL-chakrapetch.txt",
  "vendor/fonts/OFL-cinzel.txt",
  "vendor/fonts/OFL-graduate.txt",
  "vendor/fonts/OFL-mplusrounded1c.txt",
  "vendor/fonts/OFL-orbitron.txt",
  "vendor/fonts/OFL-spacemono.txt",
  "vendor/fonts/anton.woff",
  "vendor/fonts/bebasneue.woff",
  "vendor/fonts/blackopsone.woff",
  "vendor/fonts/caveat.woff",
  "vendor/fonts/chakrapetch-bold.woff",
  "vendor/fonts/chakrapetch.woff",
  "vendor/fonts/cinzel.woff",
  "vendor/fonts/fraunces-italic.woff",
  "vendor/fonts/fraunces-soft.woff",
  "vendor/fonts/fraunces.woff",
  "vendor/fonts/graduate.woff",
  "vendor/fonts/manrope.woff",
  "vendor/fonts/mplusrounded-xb.woff",
  "vendor/fonts/mplusrounded.woff",
  "vendor/fonts/orbitron.woff",
  "vendor/fonts/spacemono-bold.woff",
  "vendor/fonts/spacemono.woff",
  "vendor/pdfjs/pdf.min.mjs",
  "vendor/pdfjs/pdf.worker.min.mjs"
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: use the saved copy, refresh it in the background when online.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(caches.open(FONT_CACHE).then(async (c) => {
      const cached = await c.match(req);
      const fresh = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => cached);
      return cached || fresh;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // App files: from the tablet first (works offline), otherwise from the internet.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => cached
      || fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('./') : Response.error())))
  );
});
