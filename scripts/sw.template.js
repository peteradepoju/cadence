// Cadence service worker: the app opens offline. Data lives in IndexedDB, so only the app's files are kept here.
const VERSION = "__VERSION__";
const CACHE = `cadence-${VERSION}`;
const BASE = new URL(self.registration.scope).pathname;
const CORE = __FILES__;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(f => BASE + f))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("cadence-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith(BASE)) return;
  // Pages: the app shell, network first so updates arrive, the saved copy offline.
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then(r => (r.ok || r.status === 404 ? r : Promise.reject())).catch(() => caches.match(BASE + "index.html")));
    return;
  }
  // Built files have their content in their name: the saved copy is always right.
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok && url.pathname.includes("/assets/")) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  })));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = e.notification.data?.url || BASE;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope));
    if (open) { open.postMessage({ type: "open", url }); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
