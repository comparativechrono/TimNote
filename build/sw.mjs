/* Writes sw.js: the list of the app's files (kept for working offline), and a version made from their contents,
   so that a browser picks up a new version as soon as anything changes. Run after changing any file:
   `npm run build:sw`. */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const take = ['index.html', 'manifest.webmanifest', 'css', 'js', 'vendor', 'assets/fonts', 'icons'];
const files = [];
const walk = (p) => {
  const full = join(root, p);
  if (statSync(full).isDirectory()) for (const f of readdirSync(full).sort()) walk(join(p, f));
  else if (!/\.(md|txt|map)$/i.test(p) || /OFL\.txt$/.test(p)) files.push(p.split('\\').join('/'));
};
take.forEach(walk);
const hash = createHash('sha256');
for (const f of files) hash.update(f + '\0' + readFileSync(join(root, f)));
const version = hash.digest('hex').slice(0, 12);
const sw = `/* TimNote's service worker: it keeps the app's files so that TimNote opens without the internet. It always asks
   the network first (so a new version is used at once), and falls back to the kept copy when offline. The notes
   themselves are never here: they are in your folder. Made by build/sw.mjs. */
const VERSION = '${version}';
const CACHE = 'timnote-' + VERSION;
const ASSETS = ${JSON.stringify(['./'].concat(files), null, 2)};

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
`;
writeFileSync(join(root, 'sw.js'), sw);
console.log('sw.js: ' + files.length + ' files, version ' + version);
