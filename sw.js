/* TimNote's service worker: it keeps the app's files so that TimNote opens without the internet. It always asks
   the network first (so a new version is used at once), and falls back to the kept copy when offline. The notes
   themselves are never here: they are in your folder. Made by build/sw.mjs. */
const VERSION = '9f1d90d2cf5a';
const CACHE = 'timnote-' + VERSION;
const ASSETS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/app.css",
  "css/fonts.css",
  "js/ai.js",
  "js/app.js",
  "js/bus.js",
  "js/dates.js",
  "js/dictation.js",
  "js/editor.js",
  "js/fsx.js",
  "js/ics.js",
  "js/idb.js",
  "js/library.js",
  "js/main.js",
  "js/notes.js",
  "js/recovery.js",
  "js/render.js",
  "js/search.js",
  "js/settings.js",
  "js/tasks.js",
  "js/templates.js",
  "js/util.js",
  "js/views/aipanel.js",
  "js/views/calendar.js",
  "js/views/lists.js",
  "js/views/newnote.js",
  "js/views/note.js",
  "js/views/palette.js",
  "js/views/search.js",
  "js/views/settings.js",
  "js/views/sidebar.js",
  "js/views/welcome.js",
  "vendor/codemirror.js",
  "vendor/icons.js",
  "vendor/marked.js",
  "vendor/purify.js",
  "assets/fonts/OFL.txt",
  "assets/fonts/literata-greek-wght-italic.woff2",
  "assets/fonts/literata-greek-wght-normal.woff2",
  "assets/fonts/literata-latin-ext-wght-italic.woff2",
  "assets/fonts/literata-latin-ext-wght-normal.woff2",
  "assets/fonts/literata-latin-wght-italic.woff2",
  "assets/fonts/literata-latin-wght-normal.woff2",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/icon-maskable.svg",
  "icons/icon.svg"
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('timnote-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 6000);
        const res = await fetch(req, { cache: 'no-cache', signal: ctl.signal });
        clearTimeout(t);
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = (await cache.match(req, { ignoreSearch: req.mode === 'navigate' })) || (req.mode === 'navigate' ? await cache.match('./') : null);
        if (hit) return hit;
        throw err;
      }
    })()
  );
});
