import { api, post } from '@/lib/api';

/* ══════════════════════════════════════════════════════════════════════════
   SER AVISADO COM O APP FECHADO.

   O sino do produto só existe enquanto alguém está olhando, e a estreia de hoje
   é justamente o aviso que precisa alcançar quem não está. Isto é o lado de cá
   da conversa: pedir a permissão, guardar o endereço que o navegador dá, e
   devolvê-lo ao servidor.

   ── quatro estados, e a tela mostra os quatro ───────────────────────────
   · `sem` — este navegador não faz push. É o caso do Safari fora de um app
     instalado, e o do WebView de uma casca Capacitor, que não tem Push API.
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

/* A chave pública do servidor, perguntada uma vez. 404 dali quer dizer que esta
   instalação não manda aviso nenhum — ver routes/push.js. */
let chave: string | null | undefined;

async function serverKey(): Promise<string | null> {
  if (chave !== undefined) return chave;
  try {
    const { key } = await api<{ key: string }>('/api/push/key');
    chave = key;
  } catch {
    chave = null;
  }
  return chave;
}

async function current(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return 'sem';
  if (!(await serverKey())) return 'servidor';
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
  if (!supported()) return 'sem';
  const key = await serverKey();
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
