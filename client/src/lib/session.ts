/* ══════════════════════════════════════════════════════════════════════════
   ONDE A API MORA, E COMO A SESSÃO VIAJA ATÉ ELA.

   No navegador as duas respostas são "aqui" e "no cookie": o mesmo Express que
   responde `/api` serve esta página, e o cookie de sessão é `HttpOnly` — este
   arquivo nem consegue lê-lo, e é isso que o torna seguro.

   Num aplicativo as duas mudam. A página vem de dentro do aparelho
   (`capacitor://localhost`), a API continua no servidor, e o cookie daquele
   domínio vira cookie de terceiro — que o WebView pode simplesmente não
   guardar. Então a sessão passa a viajar em `Authorization: Bearer`, e quem a
   guarda é este arquivo.

   ── o que liga um modo ou outro ─────────────────────────────────────────
   A ORIGEM DA API. Se ela está em outro lugar, este cliente está dentro de uma
   casca e usa token; se está aqui, é o site e usa cookie. Não há terceira
   configuração para alguém errar, e o mesmo build serve aos dois — só muda
   `VITE_API_BASE` no momento de empacotar.

   ── e por que o refresh é um só ─────────────────────────────────────────
   O servidor GASTA a chave de renovação a cada uso, e apresentar uma já gasta
   derruba a família inteira (ver auth.js). Cinco chamadas levando 401 ao mesmo
   tempo — o que acontece toda vez que uma tela abre — disparariam cinco
   renovações com a MESMA chave, e o app se deslogaria sozinho. Por isso a
   renovação é uma promessa compartilhada: quem chega no meio espera a que já
   está correndo.
   ══════════════════════════════════════════════════════════════════════════ */

type Pair = { access: string; refresh: string };

/* Vazio no site, e o endereço do servidor num pacote de aplicativo. O global
   existe para a casca poder trocá-lo sem rebuild — um `server.url` apontando
   para outro ambiente, um teste contra a máquina de alguém. */
const declared =
  (globalThis as { __CINECLUBE_API__?: string }).__CINECLUBE_API__ ??
  (import.meta.env?.VITE_API_BASE as string | undefined) ??
  '';

/** Sem barra no fim: tudo aqui concatena caminhos que já começam com `/`. */
export const apiBase = declared.replace(/\/$/, '');

/** O cliente está dentro de uma casca, falando com um servidor de fora. */
export const appMode = apiBase !== '';

/* A chave fica onde a casca a deixa sobreviver a um fechamento do app. No
   navegador isto nunca é escrito: lá a sessão é o cookie. */
const STORE = 'cc.session';

let pair: Pair | null = read();

function read(): Pair | null {
  if (!appMode) return null;
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const held = JSON.parse(raw);
    return held?.access && held?.refresh ? held : null;
  } catch {
    // Armazenamento indisponível ou ilegível: é o mesmo que não ter sessão.
    return null;
  }
}

export function setPair(next: Pair | null) {
  pair = next;
  try {
    if (next) localStorage.setItem(STORE, JSON.stringify(next));
    else localStorage.removeItem(STORE);
  } catch {
    /* Sem armazenamento a sessão dura enquanto o app estiver aberto, que é
       melhor do que não entrar. */
  }
}

export const hasPair = () => !!pair;

/** O cabeçalho da sessão, quando ela viaja em token. Vazio no site. */
export function authHeaders(): Record<string, string> {
  return pair ? { Authorization: `Bearer ${pair.access}` } : {};
}

/* `include` só quando a API é de outra origem: no site o padrão já manda o
   cookie, e pedir `include` numa chamada de mesma origem não muda nada além de
   ligar CORS onde não há CORS. */
export const credentialsMode: RequestCredentials = appMode ? 'include' : 'same-origin';

/** O endereço completo de um caminho da API. */
export const urlFor = (path: string) => (path.startsWith('/') ? apiBase + path : path);

let running: Promise<boolean> | null = null;

/* Troca a chave por um par novo. Devolve se deu certo; quem chama decide o que
   fazer com o não — normalmente refazer o pedido ou cair na tela de entrar.

   Uma de cada vez: ver o cabeçalho deste arquivo. */
export function refreshSession(): Promise<boolean> {
  if (!pair) return Promise.resolve(false);
  if (!running) {
    running = rotate().finally(() => {
      running = null;
    });
  }
  return running;
}

async function rotate(): Promise<boolean> {
  const atual = pair;
  if (!atual) return false;
  try {
    const res = await fetch(urlFor('/api/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: credentialsMode,
      body: JSON.stringify({ refresh: atual.refresh }),
    });
    if (!res.ok) {
      /* 401 é a chave não valer mais — vencida, gasta, ou a família derrubada.
         A sessão acabou, e insistir com ela só produziria mais 401. Um erro de
         rede é outra coisa: a chave continua boa e a próxima tentativa é a
         próxima vez que o app abrir. */
      if (res.status === 401) setPair(null);
      return false;
    }
    const novo = await res.json();
    if (!novo?.access || !novo?.refresh) return false;
    setPair({ access: novo.access, refresh: novo.refresh });
    return true;
  } catch {
    return false;
  }
}

/** O que a saída precisa mandar junto para o servidor derrubar a família. */
export const refreshToken = () => pair?.refresh ?? null;

/* ── o aviso de que a tela subiu ──────────────────────────────────────────
   O aplicativo baixa o cliente novo e o aplica na abertura seguinte — e espera
   ouvir que ele funcionou. Sem este aviso, ele DESFAZ a troca sozinho e volta
   ao pacote anterior: é a rede debaixo de publicar uma tela branca para todo
   mundo de uma vez.

   Chamado pelo bridge global e não por importação: o plugin que aplica a troca
   é dependência da CASCA, e o cliente da web não a tem — nem deve ter, para o
   site não carregar o que ele nunca usa. Fora de um aplicativo isto não
   encontra nada e não faz nada. */
export function appIsReady() {
  const bridge = (globalThis as { Capacitor?: { Plugins?: Record<string, { notifyAppReady?: () => void }> } })
    .Capacitor;
  try {
    bridge?.Plugins?.CapacitorUpdater?.notifyAppReady?.();
  } catch {
    /* Um plugin que não respondeu não pode derrubar a abertura do app: o pior
       que acontece é a troca ser desfeita, que é o comportamento seguro. */
  }
}
