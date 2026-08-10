// sw.js - 离线缓存静态壳；数据请求（supabase.co）走网络优先、不缓存
const CACHE = 'ws-yield-v11';
const ASSETS = [
  './',
  './index.html',
  './admin.html',
  './manifest.webmanifest',
  './css/styles.css?v=9',
  './js/config.js',
  './js/db.js',
  './js/ui.js',
  './js/employee.js',
  './js/admin.js',
  './js/app.js',
  './icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(ASSETS);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // 跨域（supabase）直接放行，不缓存数据
  e.respondWith(
    fetch(e.request).then(function (resp) {
      if (resp && resp.status === 200 && resp.type === 'basic') {
        const copy = resp.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return resp;
    }).catch(function () {
      return caches.match(e.request);
    })
  );
});
