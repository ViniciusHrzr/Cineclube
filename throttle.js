/* ══════════════════════════════════════════════════════════════════════════
   QUANTAS VEZES, EM QUANTO TEMPO.

   Até aqui o produto tinha uma trava só, e ela protegia uma coisa só: cinco
   senhas erradas trancavam UMA CONTA. Isso continua certo e continua valendo —
   e não protege nada do resto, porque o resto não erra senha. Um programa que
   crie contas, funde clubes e escreva comentários não está adivinhando nada:
   está usando o produto exatamente como ele foi desenhado, muitas vezes por
   segundo.

   ── por que escrito à mão ─────────────────────────────────────────────────
   O app tem duas dependências de produção — express e o cliente do libSQL — e
   essa magreza é uma propriedade de segurança, não uma economia. Um limitador é
   sessenta linhas e um Map; trazer uma árvore de pacotes para dentro do
   processo que guarda as senhas do clube, para não escrever sessenta linhas, é
   pagar caro numa moeda que não é linha de código.

   ── por que em memória, e o que isso custa ────────────────────────────────
   O serviço roda em UMA instância (ver render.yaml). Com uma instância, um Map
   é a contagem completa e exata. No dia em que houver duas, cada uma passa a
   contar a sua metade e todo limite dobra na prática — e a resposta certa nesse
   dia é um contador compartilhado, não um número menor aqui. Fica escrito para
   que a troca seja uma decisão e não uma surpresa.

   Reiniciar zera as contagens. Isso é aceitável de propósito: o Render derruba
   a instância depois de 15 min parada, então zerar é o estado normal, e o que
   estas travas defendem é a rajada — não uma quota mensal.

   ── janela fixa, e não balde furado ───────────────────────────────────────
   Uma janela fixa é grosseira: alguém pode gastar o limite no fim de uma janela
   e de novo no começo da seguinte, ou seja o dobro num instante. Um balde com
   vazamento contínuo não tem isso e custa mais estado.

   A janela fixa ganha por uma razão que não é técnica: ela sabe dizer QUANDO
   passa. "Tente de novo em 42s" é uma frase verdadeira e útil; um balde só sabe
   dizer "agora não". O produto inteiro é escrito assim — a mensagem nomeia o
   problema e a saída —, e o pior caso do dobro numa janela está muito abaixo de
   qualquer número que interesse a quem estiver do outro lado.
   ══════════════════════════════════════════════════════════════════════════ */

/* Um teto para a própria contagem. Sem ele, o limitador vira a memória que ele
   deveria proteger: um IP por requisição, um Map crescendo para sempre. Ao
   estourar, a tabela inteira é descartada — todo mundo recomeça com o limite
   cheio, o que é generoso por um instante e nunca é uma porta. */
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

/* ── de quem é esta requisição ────────────────────────────────────────────
   Da CONTA quando há sessão, e do endereço quando não há. A ordem importa e é
   deliberada: um limite por IP pune uma casa inteira atrás do mesmo roteador —
   e este produto é um clube de amigos, dos quais dois podem estar na mesma
   sala. Depois de entrar, a identidade é a conta, que é a coisa que o limite
   quer de fato medir.

   Antes de entrar não há escolha: o endereço é tudo que existe, e é justamente
   aí que mora o abuso mais barato — criar contas. Por isso `/register` e
   `/login` são medidos por IP explicitamente, e não pela conta que ainda não
   existe.

   `req.ip` só vale alguma coisa com `trust proxy` ligado: o Render termina o
   TLS na frente do app, então SEM isso todo mundo no mundo é o mesmo endereço —
   o do proxy — e o limite por IP vira um limite global. Ver server.js. */
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

/* ── a contagem ───────────────────────────────────────────────────────────
   Devolve `{ ok }` ou `{ ok: false, retryAfter }`.

   Uma requisição recusada NÃO conta. Se contasse, quem esbarrasse no limite e
   continuasse tentando empurraria a própria janela para sempre — a trava
   deixaria de ter fim, e uma trava sem fim é um banimento que ninguém decidiu
   aplicar. */
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

/* ══════════════════════════════════════════════════════════════════════════
   O middleware.

   `limit({ name, max, windowMs, by, message })`, e `message` recebe o tempo já
   escrito por extenso. A frase é do produto e não do limitador: "você está indo
   rápido demais" e "muitas contas criadas deste lugar" são coisas diferentes
   acontecendo com pessoas diferentes, e uma mensagem genérica em cima das duas
   deixaria as duas sem saber o que fazer.

   O 429 carrega `Retry-After` além do corpo. O cabeçalho é para quem não é
   navegador — e quem não é navegador é a metade do público desta trava.
   ══════════════════════════════════════════════════════════════════════════ */
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
   rota. O pedido de redefinição de senha é medida em dois eixos — por endereço
   de rede E por conta —, e o segundo só pode ser contado DEPOIS de descobrir se
   existe conta para aquele e-mail, que é trabalho de dentro do manipulador. */
module.exports = { limit, take, reset, stopTimers, MAX_KEYS };
