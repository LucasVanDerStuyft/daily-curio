// Service worker: offline app shell, cached Wikipedia images, and push notifications.
const VERSION = 'v2';
const SHELL = `curio-shell-${VERSION}`;
const RUNTIME = 'curio-runtime';
const META = 'curio-meta';

const SHELL_FILES = [
  './', './index.html', './css/styles.css', './manifest.webmanifest',
  './js/app.js', './js/engine.js', './js/content.js', './js/wiki.js', './js/config.js',
  './js/content/make.js', './js/content/animals-1.js', './js/content/animals-2.js',
  './js/content/plants.js', './js/content/ecosystems.js', './js/content/deep-time.js',
  './js/content/prehistory.js', './js/content/antiquity.js', './js/content/middle-ages.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/badge-96.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('curio-shell-') && k !== SHELL) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Wikipedia images: cache-first (they never change).
  if (url.hostname === 'upload.wikimedia.org' || url.hostname === 'thumb.wikimedia.org') {
    e.respondWith(cacheFirst(e.request));
    return;
  }
  // Wikipedia API: network-first, fall back to cache when offline.
  if (url.hostname === 'en.wikipedia.org') {
    e.respondWith(networkFirst(e.request));
    return;
  }
  // App shell: serve from cache, refresh in the background.
  if (url.origin === self.location.origin) {
    e.respondWith(staleWhileRevalidate(e.request));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(RUNTIME);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req, { ignoreSearch: true });
  const update = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => hit);
  return hit || update;
}

// ── Push ──
function todayKey(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function readMeta(name) {
  const cache = await caches.open(META);
  const res = await cache.match(new URL(name, self.registration.scope));
  return res ? res.json() : null;
}

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let title = '✨ Your daily curio is ready';
    let body = 'A new fact or quiz about nature or history is waiting for you.';
    try {
      // The app stores a teaser for the next day's pick whenever it is opened.
      const teaser = await readMeta('teaser.json');
      if (teaser?.date === todayKey()) ({ title, body } = teaser);
      const status = await readMeta('status.json');
      if (status?.streak > 1 && status.lastDone === todayKey(-1)) body += `\n🔥 Keep your ${status.streak}-day streak going!`;
    } catch {}
    await self.registration.showNotification(title, {
      body,
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      tag: 'daily-curio',
      renotify: true,
      data: { url: self.registration.scope },
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find(w => w.url.startsWith(self.registration.scope));
    if (win) {
      await win.focus();
      win.postMessage({ type: 'refresh' });
    } else {
      await self.clients.openWindow(e.notification.data?.url || './');
    }
  })());
});
