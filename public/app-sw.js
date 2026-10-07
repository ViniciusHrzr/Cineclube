importScripts('/sw.min.js');

const CACHE = 'cineclube-v1';

const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(c => c.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(nomes => Promise.all(nomes.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function meu(req, url) {
  if (req.method !== 'GET') return false;
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;
  if (url.pathname.startsWith('/webtorrent')) return false;
  if (req.headers.has('range')) return false;
  return true;
}

self.addEventListener('push', event => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
  }

  event.waitUntil(
    self.registration.showNotification(dados.title || 'Cineclube', {
      body: dados.body || '',
      tag: dados.tag || 'cineclube',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: dados.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destino = event.notification.data?.url || '/';
  event.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const janela of janelas) {
        if (janela.url.startsWith(self.location.origin)) {
          await janela.focus();
          return;
        }
      }
      await self.clients.openWindow(destino);
    })()
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (!meu(req, url)) return;

  const navegando = req.mode === 'navigate';
  const assets = url.pathname.startsWith('/assets/');
  if (!navegando && !assets) return;

  const resposta = navegando
    ? fetch(req)
        .then(res => {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put('/', copia)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/').then(hit => hit || Response.error()))
    :
      caches.match(req).then(
        hit =>
          hit ||
          fetch(req).then(res => {
            if (res.ok) {
              const copia = res.clone();
              caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {});
            }
            return res;
          })
      );

  try {
    event.respondWith(resposta);
  } catch {
  }
});
