/* The Pink Poodle — Firebase Cloud Messaging service worker.
   Receives promo/opening push notifications when the site tab is closed or in
   the background. Must live at the site root so its scope covers every page.
   Uses the compat SDK because service workers can't use ES module imports. */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyAVU4PeZJI8xqo7YOm8QiKvryEVXuv9gLk',
  authDomain: 'binditails-da2de.firebaseapp.com',
  projectId: 'binditails-da2de',
  storageBucket: 'binditails-da2de.firebasestorage.app',
  messagingSenderId: '376117416695',
  appId: '1:376117416695:web:f11c59342cc6a750d739f2'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  const n = (payload && payload.notification) || {};
  self.registration.showNotification(n.title || 'The Pink Poodle 🐩', {
    body: n.body || 'We have news from the salon!',
    icon: 'https://pinkpoodle.dog/assets/paris.jpg',
    badge: 'https://pinkpoodle.dog/assets/paris.jpg',
    tag: 'pp-promo',
    data: { url: 'https://pinkpoodle.dog/' }
  });
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || 'https://pinkpoodle.dog/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (const c of list) { if (c.url === url && 'focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

/* ---------------------------------------------------------------------------
   Spa PWA offline cache (merged in so a single root service worker owns scope
   '/'. Registering two different workers at the same scope made them evict each
   other, breaking push or offline depending on which page loaded last.)
   Only the staff spa app + its assets are served offline; the public marketing
   site always hits the network so it never shows stale content.
--------------------------------------------------------------------------- */
var PP_CACHE = 'pp-spa-v2';
var PP_ASSETS = ['/spa.html', '/spa.css', '/spa.js', '/spa.webmanifest', '/assets/icon-192.png', '/assets/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(PP_CACHE).then(function (c) { return c.addAll(PP_ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== PP_CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url;
  try { url = new URL(e.request.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return; // never touch Firebase/gstatic requests
  var p = url.pathname;
  var isSpa = p === '/spa.html' || p.indexOf('/spa.') === 0 || p === '/assets/icon-192.png' || p === '/assets/icon-512.png';
  if (!isSpa) return; // public site: straight to network
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).catch(function () { return caches.match('/spa.html'); });
    })
  );
});
