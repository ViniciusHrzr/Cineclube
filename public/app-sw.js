/* ══════════════════════════════════════════════════════════════════════════
   O SERVICE WORKER DO CINECLUBE, e ele é UM só — de propósito.

   O escopo `/` aceita um registro. Registrar um segundo arquivo ali não soma:
   substitui, e o que perde o lugar é o do WebTorrent, que é quem serve o vídeo
   da Sessão. Por isso este arquivo começa importando aquele: são dois ouvintes
   de `fetch` no mesmo worker, e não dois workers disputando um escopo.

   A ORDEM importa. O do WebTorrent registra o ouvinte dele primeiro, então ele
   responde primeiro pelo que é dele; o daqui só olha o que sobrou.

   O que este acrescenta é a casca offline, que é também o que torna o app
   INSTALÁVEL: sem um worker com ouvinte de `fetch` controlando a página, o
   navegador não oferece "instalar", e sem "instalar" não há PWA, nem TWA, nem
   notificação com o app fechado.
   ══════════════════════════════════════════════════════════════════════════ */

importScripts('/sw.min.js');

/* Sobe quando o que se guarda muda de forma. Trocar o nome é a maneira de
   esvaziar o cache de todo mundo de uma vez: o `activate` apaga o que não se
   chama assim. */
const CACHE = 'cineclube-v1';

/* A casca, e só ela: a página de entrada e o que a identifica. Os arquivos de
   código têm o hash do conteúdo no nome e entram em cache ao serem usados —
   listá-los aqui obrigaria este arquivo a ser reescrito a cada build. */
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(c => c.addAll(SHELL))
      /* Um arquivo que não baixou não pode impedir a instalação: o worker sem
         casca ainda serve para o resto, e a casca entra no primeiro uso. */
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

/** O que este worker NÃO toca, porque é de outro dono ou não se guarda. */
function meu(req, url) {
  if (req.method !== 'GET') return false;
  if (url.origin !== self.location.origin) return false;
  // A API responde sobre o clube AGORA. Uma resposta guardada é uma mentira com
  // data.
  if (url.pathname.startsWith('/api/')) return false;
  // O servidor de vídeo do WebTorrent, que é o outro ouvinte deste arquivo.
  if (url.pathname.startsWith('/webtorrent')) return false;
  // Pedido de trecho é vídeo tocando: cache de 206 não existe.
  if (req.headers.has('range')) return false;
  return true;
}

/* ── o aviso que chega com o app fechado ──────────────────────────────────
   Este worker continua de pé depois que a última aba fecha, e é por isso que
   ele é quem desenha o aviso. O conteúdo chega cifrado e o navegador o
   decifra — quem carregou a mensagem até aqui não sabe o que ela diz. Ver
   push.js no servidor.

   `showNotification` é obrigatório: a permissão foi dada para AVISAR, e um
   push que não avisa nada é o navegador cortando a inscrição depois de algumas
   vezes. */
self.addEventListener('push', event => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    /* Mensagem sem corpo legível: ainda assim avisa, porque calar aqui gasta
       uma permissão que foi dada. */
  }

  event.waitUntil(
    self.registration.showNotification(dados.title || 'Cineclube', {
      body: dados.body || '',
      /* A mesma etiqueta substitui o aviso anterior em vez de empilhar: duas
         execuções do relógio não deixam dois cartões do mesmo episódio. */
      tag: dados.tag || 'cineclube',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: dados.url || '/' },
    })
  );
});

/* Tocar no aviso traz a janela que já existe para a frente, e só abre uma nova
   quando não há nenhuma: quem tem o clube aberto numa aba não quer uma segunda
   por ter tocado num aviso. */
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

  /* ── a página ────────────────────────────────────────────────────────────
     Rede primeiro: um deploy troca o nome dos arquivos de código, e uma página
     guardada apontaria para os do build anterior. O cache aqui é o que faz o
     app abrir no metrô. */
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
    : /* ── o código ────────────────────────────────────────────────────────
         Cache primeiro, porque o nome carrega o hash do conteúdo: este arquivo
         nunca vai mudar. O que muda é qual arquivo a página pede. */
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
    /* Outro ouvinte já respondeu por este pedido. Não é erro: é o worker do
       WebTorrent fazendo o trabalho dele. */
  }
});
