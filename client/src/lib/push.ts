import { api, post } from '@/lib/api';
import { inShell, plugin } from '@/lib/shell';

/* ══════════════════════════════════════════════════════════════════════════
   SER AVISADO COM O APP FECHADO.

   O sino do produto só existe enquanto alguém está olhando, e a estreia de hoje
   é justamente o aviso que precisa alcançar quem não está. Isto é o lado de cá
   da conversa: pedir a permissão, guardar o endereço que o navegador dá, e
   devolvê-lo ao servidor.

   ── quatro estados, e a tela mostra os quatro ───────────────────────────
   · `sem` — nem o navegador nem a casca sabem receber. É o caso do Safari
     fora de um app instalado.

   ── e há DUAS portas ─────────────────────────────────────────────────────
   No navegador, Web Push: a inscrição é um endereço de entrega mais as chaves
   do aparelho, e quem cifra somos nós. Dentro de uma casca não existe Push API,
   e quem acorda o aparelho é o serviço do Android — a inscrição é um token e
   quem entrega é o Google. Ver push.js e fcm.js.

   O interruptor da tela é o mesmo nos dois.
   · `servidor` — o navegador faz, mas ESTA instalação não tem chave VAPID
     configurada. Não adianta oferecer o interruptor.
   · `bloqueado` — a pessoa recusou a permissão. Só ela desfaz isso, nas
     configurações do navegador, e um botão nosso não reabre a pergunta.
   · `ligado` / `desligado` — o normal.

   Um estado só, "não dá", esconderia justamente a diferença entre "não posso" e
   "você me disse que não".
   ══════════════════════════════════════════════════════════════════════════ */

export type PushState = 'sem' | 'servidor' | 'bloqueado' | 'ligado' | 'desligado';

const supported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

/* O que o servidor sabe entregar, perguntado uma vez. 404 dali quer dizer que
   esta instalação não manda aviso nenhum — ver routes/push.js. */
let portas: { key: string | null; fcm: boolean } | null | undefined;

async function serverDoors() {
  if (portas !== undefined) return portas;
  try {
    portas = await api<{ key: string | null; fcm: boolean }>('/api/push/key');
  } catch {
    portas = null;
  }
  return portas;
}

/* O token deste aparelho, guardado para saber que o interruptor está ligado e
   para poder desligá-lo. No navegador isto não existe: lá quem sabe é o próprio
   `PushManager`. */
const FCM_STORE = 'cc.push.fcm';
const fcmToken = () => {
  try {
    return localStorage.getItem(FCM_STORE);
  } catch {
    return null;
  }
};

/* ── a porta do Android ───────────────────────────────────────────────────
   O token não volta da chamada: ele chega por um evento, e pode não chegar —
   aparelho sem Google Play, projeto Firebase ausente, rede fora. Dez segundos
   de espera e o interruptor volta a apagado, que é a verdade. */
async function nativeToken(): Promise<string | null> {
  const nativo = plugin('PushNotifications');
  if (!nativo) return null;

  return new Promise(resolve => {
    let pronto = false;
    const handles: { remove?: () => void }[] = [];
    const acabou = (token: string | null) => {
      if (pronto) return;
      pronto = true;
      for (const h of handles) h.remove?.();
      resolve(token);
    };

    const espera = window.setTimeout(() => acabou(null), 10_000);
    const guarda = (p: unknown) =>
      void Promise.resolve(p).then(h => handles.push(h as { remove?: () => void }));

    guarda(
      nativo.addListener('registration', (t: unknown) => {
        window.clearTimeout(espera);
        acabou((t as { value?: string })?.value ?? null);
      })
    );
    guarda(
      nativo.addListener('registrationError', () => {
        window.clearTimeout(espera);
        acabou(null);
      })
    );
    void nativo.register();
  });
}

async function current(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function pushState(): Promise<PushState> {
  const portas = await serverDoors();

  if (inShell()) {
    const nativo = plugin('PushNotifications');
    if (!nativo) return 'sem';
    if (!portas?.fcm) return 'servidor';
    const perm = (await nativo.checkPermissions()) as { receive?: string };
    if (perm?.receive === 'denied') return 'bloqueado';
    return fcmToken() ? 'ligado' : 'desligado';
  }

  if (!supported()) return 'sem';
  if (!portas?.key) return 'servidor';
  if (Notification.permission === 'denied') return 'bloqueado';
  return (await current()) ? 'ligado' : 'desligado';
}

/* A chave viaja em base64url e o navegador quer bytes. Sem isto o
   `subscribe` falha com "applicationServerKey is not valid", que é a mensagem
   mais enganosa desta API inteira. */
function bytesOf(base64url: string) {
  const base = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const texto = atob(base + '='.repeat((4 - (base.length % 4)) % 4));
  return Uint8Array.from(texto, c => c.charCodeAt(0));
}

/* Liga. A pergunta da permissão só é feita AQUI, num clique — pedi-la na
   abertura é o jeito mais rápido de ser recusado para sempre, e a recusa não
   tem volta pelo lado de cá.

   `userVisibleOnly` não é escolha: o Chrome exige a promessa de que todo push
   vira um aviso na tela. */
export async function enablePush(): Promise<PushState> {
  const portas = await serverDoors();

  if (inShell()) {
    const nativo = plugin('PushNotifications');
    if (!nativo) return 'sem';
    if (!portas?.fcm) return 'servidor';

    const perm = (await nativo.requestPermissions()) as { receive?: string };
    if (perm?.receive !== 'granted') return perm?.receive === 'denied' ? 'bloqueado' : 'desligado';

    const token = await nativeToken();
    if (!token) return 'desligado';
    await post('/api/push/subscribe', { kind: 'fcm', token });
    try {
      localStorage.setItem(FCM_STORE, token);
    } catch {
      /* Sem armazenamento o aviso continua chegando; o que se perde é o
         interruptor saber que está ligado depois de fechar o app. */
    }
    return 'ligado';
  }

  if (!supported()) return 'sem';
  const key = portas?.key;
  if (!key) return 'servidor';

  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') return permissao === 'denied' ? 'bloqueado' : 'desligado';

  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytesOf(key),
    }));

  await post('/api/push/subscribe', sub.toJSON());
  return 'ligado';
}

/* Desliga dos dois lados. Primeiro o servidor, depois o navegador: na ordem
   inversa, uma falha de rede deixaria uma inscrição viva lá que o aparelho já
   não conhece — e o aviso chegaria de um lugar que a pessoa acabou de desligar. */
export async function disablePush(): Promise<PushState> {
  if (inShell()) {
    const token = fcmToken();
    if (token) {
      await api('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }).catch(() => {
        /* O servidor não ouviu. A inscrição morre sozinha na primeira entrega
           recusada — o Google devolve UNREGISTERED e a linha sai. */
      });
      try {
        localStorage.removeItem(FCM_STORE);
      } catch {
        /* Ver acima: sem armazenamento, o estado do interruptor é o que o
           servidor souber. */
      }
    }
    return 'desligado';
  }

  if (!supported()) return 'sem';
  const sub = await current();
  if (!sub) return 'desligado';

  await api('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {
    /* O servidor não ouviu. A inscrição local sai assim mesmo, e a que sobrou lá
       morre sozinha na primeira entrega recusada. */
  });

  await sub.unsubscribe();
  return 'desligado';
}

/** Um aviso de teste para os aparelhos desta conta. */
export const testPush = () =>
  post<{ aparelhos: number; enviados: number; falhas: number }>('/api/push/test', {});
