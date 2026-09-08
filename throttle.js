/* ══════════════════════════════════════════════════════════════════════════
   QUANTAS VEZES, EM QUANTO TEMPO.

   Escrito à mão: o app tem duas dependências de produção, e essa magreza é uma
   propriedade de segurança. Um limitador é sessenta linhas e um Map — trazer
   uma árvore de pacotes para dentro do processo que guarda as senhas do clube
   é pagar caro numa moeda que não é linha de código.

   Em memória, e isso só funciona porque o serviço roda em UMA instância (ver
   render.yaml). No dia em que houver duas, cada uma conta a sua metade e todo
   limite dobra na prática; a resposta certa nesse dia é um contador
   compartilhado, não um número menor aqui.

   Reiniciar zera as contagens, de propósito: o Render derruba a instância
   depois de 15 min parada, e o que estas travas defendem é a rajada, não uma
   quota mensal.

   Janela fixa e não balde furado, apesar de a janela deixar gastar o limite no
   fim de uma e de novo no começo da seguinte. Ela sabe dizer QUANDO passa —
   "tente de novo em 42s" é uma frase útil, e um balde só sabe dizer "agora
   não".
   ══════════════════════════════════════════════════════════════════════════ */

/* Teto da própria contagem: sem ele o limitador vira a memória que deveria
   proteger. Ao estourar, a tabela inteira é descartada — generoso por um
   instante, e nunca uma porta. */
const MAX_KEYS = 50_000;
/** De quanto em quanto tempo as janelas vencidas são varridas. */
const SWEEP_MS = 60_000;

const hits = new Map();

/* Não segura o processo vivo. É a diferença entre `node --test` terminar e
   ficar pendurado num timer que ninguém pediu para parar. */
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hits) if (entry.until <= now) hits.delete(key);
}, SWEEP_MS);
sweeper.unref?.();

/* Da CONTA quando há sessão, do endereço quando não há. Um limite por IP pune
   uma casa inteira atrás do mesmo roteador, e aqui dois membros do clube podem
   estar na mesma sala.

   Antes de entrar não há escolha, e é aí que mora o abuso mais barato: por isso
   `/register` e `/login` são medidos por IP explicitamente.

   `req.ip` só vale alguma coisa com `trust proxy` ligado — o Render termina o
   TLS na frente do app, e sem isso todo mundo no mundo é o endereço do proxy.
   Ver server.js. */
function identityOf(req, by) {
  if (by === 'ip') return 'ip:' + (req.ip || 'sem-endereco');
  const who = req.session?.reviewer_id;
  return who ? 'p:' + who : 'ip:' + (req.ip || 'sem-endereco');
}

/** "42s" ou "12 minutos" — a frase muda de unidade quando o número fica feio. */
function saying(seconds) {
  if (seconds < 90) return `${Math.max(1, seconds)}s`;
  const min = Math.ceil(seconds / 60);
  return `${min} minuto${min === 1 ? '' : 's'}`;
}

/* Devolve `{ ok }` ou `{ ok: false, retryAfter }`.

   Uma requisição recusada NÃO conta: se contasse, quem continuasse tentando
   empurraria a própria janela para sempre, e uma trava sem fim é um banimento
   que ninguém decidiu aplicar. */
function take(key, max, windowMs, now = Date.now()) {
  const entry = hits.get(key);
  if (!entry || entry.until <= now) {
    if (hits.size >= MAX_KEYS) hits.clear();
    hits.set(key, { n: 1, until: now + windowMs });
    return { ok: true };
  }
  if (entry.n >= max) {
    return { ok: false, retryAfter: Math.ceil((entry.until - now) / 1000) };
  }
  entry.n += 1;
  return { ok: true };
}

/* `message` recebe o tempo já escrito por extenso. A frase é do produto e não
   do limitador: "você está indo rápido demais" e "muitas contas criadas deste
   lugar" são coisas diferentes, e uma mensagem genérica em cima das duas deixa
   as duas sem saber o que fazer.

   O 429 carrega `Retry-After` além do corpo, para quem não é navegador. */
function limit({ name, max, windowMs, by = 'account', message }) {
  return function limited(req, res, next) {
    const verdict = take(`${name}|${identityOf(req, by)}`, max, windowMs);
    if (verdict.ok) return next();

    const espera = saying(verdict.retryAfter);
    res.setHeader('Retry-After', String(verdict.retryAfter));
    res.status(429).json({
      error: message ? message(espera) : `Você está indo rápido demais. Tente de novo em ${espera}.`,
      retryAfter: verdict.retryAfter,
    });
  };
}

/** Zera tudo. Existe para os testes; nada no produto chama isto. */
function reset() {
  hits.clear();
}

function stopTimers() {
  clearInterval(sweeper);
}

/* `take` sai junto do middleware porque nem toda trava cabe numa camada de
   rota: o pedido de redefinição de senha é medido por endereço E por conta, e a
   conta só se descobre dentro do manipulador. */
module.exports = { limit, take, reset, stopTimers, MAX_KEYS };
