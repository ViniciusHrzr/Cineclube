/* ══════════════════════════════════════════════════════════════════════════
   QUEM PODE FALAR COM ESTA API DE OUTRA ORIGEM.

   O site é servido pelo mesmo Express que responde `/api`, então ele nunca
   precisou disto: mesma origem, sem CORS. Um aplicativo precisa. Numa casca com
   os arquivos embarcados — Capacitor, Cordova — a página roda em
   `capacitor://localhost` ou `https://localhost`, e toda chamada à API é
   requisição de outra origem.

   Três decisões, e cada uma é um jeito diferente de isto dar errado:

   · **Lista, nunca `*`.** Com credenciais, `*` é recusado pelo navegador de
     qualquer jeito — e sem credenciais ele abriria a API inteira para qualquer
     página da internet ler no lugar de quem estiver logado.
   · **A origem é ECOADA**, então a resposta muda conforme quem pergunta: sem
     `Vary: Origin`, um cache na frente serviria a permissão de um pedido para
     a origem do seguinte.
   · **Sem `Origin`, nada acontece.** É o caso do próprio site e o de qualquer
     cliente que não seja navegador; acrescentar cabeçalho ali seria dizer algo
     sobre uma pergunta que ninguém fez.

   As origens de casca são fixas porque são do formato, não da instalação:
   nenhuma delas é endereçável de fora, e o app do clube usa uma delas. O que
   varia — um domínio próprio, um túnel de desenvolvimento — entra por
   `CINECLUBE_ORIGINS`, separado por vírgula.
   ══════════════════════════════════════════════════════════════════════════ */

/* O que uma casca de aplicativo apresenta como origem. `capacitor://` e
   `ionic://` são os esquemas do WebView; `http(s)://localhost` é o modo em que
   o Capacitor serve os arquivos por um servidor local no aparelho. */
const SHELLS = [
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
];

const extras = (process.env.CINECLUBE_ORIGINS || '')
  .split(',')
  .map(o => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

const allowed = new Set([...SHELLS, ...extras]);

/* O Vite de desenvolvimento roda noutra porta, e o app em modo `livereload`
   também: qualquer `localhost:<porta>` passa quando o servidor não está atrás
   de TLS, que é como desenvolvimento roda. Em produção isto some. */
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const dev = () => process.env.NODE_ENV !== 'production' && process.env.CINECLUBE_HTTPS !== '1';

function permitted(origin) {
  if (!origin) return false;
  if (allowed.has(origin)) return true;
  return dev() && LOCAL.test(origin);
}

/** Os cabeçalhos que um cliente de outra origem pode mandar. */
const HEADERS = 'Content-Type, Authorization';
const METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
/** Um dia de preflight guardado: a lista não muda entre duas requisições. */
const MAX_AGE = 86400;

function middleware() {
  return function cors(req, res, next) {
    const origin = req.headers.origin;

    /* `Vary` sempre que a resposta PODE depender da origem, inclusive quando a
       permissão é negada: é a mesma URL respondendo de dois jeitos. */
    res.setHeader('Vary', 'Origin');

    if (!permitted(origin)) {
      /* Um preflight de origem estranha termina aqui, sem permissão e sem
         rodar a rota: o navegador recusa a chamada de verdade em seguida. */
      if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
        return res.status(204).end();
      }
      return next();
    }

    res.setHeader('Access-Control-Allow-Origin', origin);
    /* O app manda o token no cabeçalho e não em cookie, mas a casca que carrega
       o site remoto manda cookie: as duas portas de auth.js valem aqui. */
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
      res.setHeader('Access-Control-Allow-Methods', METHODS);
      res.setHeader('Access-Control-Allow-Headers', HEADERS);
      res.setHeader('Access-Control-Max-Age', String(MAX_AGE));
      return res.status(204).end();
    }

    next();
  };
}

module.exports = { middleware, permitted, SHELLS };
