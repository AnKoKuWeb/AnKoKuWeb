/* Простенький SW для PWA: кеш + stale-while-revalidate + «пинги» от страницы */
const CACHE_NAME = 'peercall-v1';
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// install: кладём базовые ассеты в кэш
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(CORE)).then(()=>self.skipWaiting())
  );
});

// activate: чистим старые кэши
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// fetch: stale-while-revalidate для статики, прямой прокси для прочего (SDP/ICE идут мимо)
self.addEventListener('fetch', (e) => {
  const req = e.request;

  // только GET имеет смысл кэшировать
  if (req.method !== 'GET') return;

  // пробуем из кэша мгновенно, параллельно обновляем из сети
  e.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    const networkPromise = fetch(req).then(res => {
      // только 200 и basic кладём в кэш
      if (res && res.status === 200 && res.type === 'basic') {
        cache.put(req, res.clone());
      }
      return res;
    }).catch(() => cached || Promise.reject('offline'));

    return cached || networkPromise;
  })());
});

// при обновлении SW уведомляем клиентов
self.addEventListener('message', (evt) => {
  if (evt.data && evt.data.type === 'ping') {
    // no-op: факт получения пинга уже поддерживает жизненный цикл
    return;
  }
});

// (опционально) если нужно насильно дёрнуть клиентов о новой версии
self.addEventListener('statechange', (e) => {
  if (self.registration.waiting && navigator?.serviceWorker?.controller) {
    self.clients.matchAll({type: 'window'}).then(list => {
      list.forEach(c => c.postMessage({type:'NEW_VERSION'}));
    });
  }
});