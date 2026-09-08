const crypto = require('node:crypto');

/* ══════════════════════════════════════════════════════════════════════════
   COMO DOIS NAVEGADORES SE ACHAM.

   A tela ao vivo vai direto de uma máquina para a outra, e é aí que mora o
   problema: nenhuma das duas tem endereço público. Cada uma está atrás de um
   roteador que traduz endereços, e um navegador não sabe nem o próprio IP visto
   de fora, quanto mais o do outro.

   Duas peças resolvem isso, e elas fazem coisas diferentes.

   ── STUN: "qual é o meu endereço?" ──────────────────────────────────────
   Um servidor que recebe um pacote e responde de onde ele veio. Só isso. Com a
   resposta, o navegador aprende como o mundo o enxerga e oferece esse endereço
   ao outro. É de graça, é público, e resolve a maioria dos casos: quando os
   dois roteadores traduzem de um jeito previsível, os dois lados furam a
   parede ao mesmo tempo e a mídia passa direto, sem intermediário.

   ── TURN: "então passa por mim" ─────────────────────────────────────────
   Quando não dá — e não dá quando alguém está atrás de CGNAT, que é o normal
   em operadora móvel e em muito provedor brasileiro —, a única saída é um
   servidor no meio que recebe a imagem de um lado e entrega do outro. É por
   isso que TURN se paga e STUN não: ele carrega o vídeo inteiro. Um filme de
   duas horas a 2,5 Mbps são uns 2 GB de tráfego relayado POR pessoa que
   precisar dele.

   Sem TURN, quem estiver nessa situação simplesmente não recebe imagem. Não é
   uma falha ruidosa — é uma conexão que fica tentando e nunca fecha.

   ── três jeitos de ter um, e o arquivo fala os três ─────────────────────
   Um servidor TURN aberto é um proxy aberto: qualquer um na internet mandaria
   tráfego por ele às suas custas. Então todos pedem credencial, e cada tipo de
   serviço dá a dele de um jeito.

   · **Cloudflare** (`CLOUDFLARE_TURN_KEY_ID` + `CLOUDFLARE_TURN_API_TOKEN`).
     O que este clube usa. A credencial não é calculada aqui: pede-se uma à API
     deles, que devolve usuário, senha e a lista de endereços já pronta — com
     as variantes de porta 80 e 443 que atravessam rede corporativa. É uma
     chamada de rede, e por isso existe o cache logo abaixo.

   · **Segredo compartilhado** (`TURN_SECRET`), que é o `use-auth-secret` do
     coturn. Sem chamada nenhuma: o usuário é um prazo de validade, a senha é o
     HMAC dele, e o servidor valida recalculando. É o caminho para um coturn
     próprio.

   · **Usuário e senha fixos** (`TURN_USERNAME`/`TURN_PASSWORD`). O que muitos
     painéis entregam. Funciona igual, com a diferença de que a senha não
     expira e sai daqui para o navegador de todo mundo.

   Nada é obrigatório. Sem variável nenhuma sobra o STUN público, e a tela ao
   vivo funciona para quem não estiver atrás de CGNAT.
   ══════════════════════════════════════════════════════════════════════════ */

/* Dois, de operadores diferentes, porque isto é um ponto único de falha para o
   recurso inteiro e são gratuitos: um deles fora do ar custa um candidato
   perdido em vez da noite. */
const STUN_FALLBACK = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];

/* Quanto tempo uma credencial vale. Uma sessão cabe folgada, e a sobra compra a
   reconexão: quem caiu no meio do filme e voltou não pode esbarrar numa senha
   vencida enquanto o clube espera. */
const TTL_SECONDS = 6 * 3600;

/* A credencial da Cloudflare é pedida pela rede, então ela é guardada. A margem
   é o que impede a corrida óbvia: servir, no último segundo de validade, uma
   senha que vence antes de o navegador terminar de se conectar com ela. */
const CACHE_MARGIN_MS = 10 * 60 * 1000;

const CF_API = 'https://rtc.live.cloudflare.com/v1/turn/keys';
/* Uma requisição a um serviço externo no caminho de alguém apertando um botão.
   Se a Cloudflare não responder nisto, o clube fica com o STUN e tenta assim
   mesmo — que é melhor do que a tela travar esperando. */
const CF_TIMEOUT_MS = 6000;

/** Lista separada por vírgula ou espaço. Vazia quando a variável não existe. */
function list(name) {
  return (process.env[name] || '')
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

const cloudflareConfigured = () =>
  Boolean(process.env.CLOUDFLARE_TURN_KEY_ID && process.env.CLOUDFLARE_TURN_API_TOKEN);

/** Há um relay configurado? A tela usa isto para saber o que prometer. */
function hasTurn() {
  if (cloudflareConfigured()) return true;
  return (
    list('TURN_URLS').length > 0 &&
    Boolean(process.env.TURN_SECRET || (process.env.TURN_USERNAME && process.env.TURN_PASSWORD))
  );
}

/* ── a credencial da Cloudflare, pedida uma vez e reaproveitada ───────────
   Uma por instância e não uma por pessoa, de propósito. A API não separa
   usuários — a credencial que ela devolve serve para qualquer navegador —,
   então pedir uma por espectador seria uma chamada de rede por pessoa que abre
   a Sessão, para receber a mesma coisa.

   `pending` é o que impede a rajada: quatro pessoas entrando juntas fazem
   quatro pedidos simultâneos, e sem isto os quatro viram quatro chamadas à
   Cloudflare que se sobrescrevem no cache. Guardando a PROMESSA, os três
   últimos esperam a primeira. */
let cache = null;
let pending = null;

async function cloudflareIce(now) {
  if (cache && cache.until > now) return cache.servers;
  if (pending) return pending;

  pending = (async () => {
    const key = process.env.CLOUDFLARE_TURN_KEY_ID;
    const res = await fetch(`${CF_API}/${key}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_TURN_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
      signal: AbortSignal.timeout(CF_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Cloudflare TURN respondeu ${res.status}`);
    const body = await res.json();
    const servers = body?.iceServers;
    if (!Array.isArray(servers) || !servers.length) throw new Error('resposta sem iceServers');
    cache = { servers, until: now + TTL_SECONDS * 1000 - CACHE_MARGIN_MS };
    return servers;
  })();

  try {
    return await pending;
  } finally {
    pending = null;
  }
}

/* O que o navegador recebe. Assíncrona por causa de um caminho só — o da
   Cloudflare —, e os outros dois devolvem na hora. */
async function iceServers(reviewerId, now = Date.now()) {
  const stun = list('STUN_URLS');
  const base = [{ urls: stun.length ? stun : STUN_FALLBACK }];

  if (cloudflareConfigured()) {
    try {
      /* A lista deles já vem com STUN dentro, e é a lista inteira que o
         navegador deve usar: os endereços de porta 80 e 443 são o que salva
         quem está numa rede que só deixa passar web. */
      return await cloudflareIce(now);
    } catch (e) {
      /* Um relay que não respondeu é um relay a menos, não uma tela quebrada:
         a maioria das redes se resolve com STUN, e negar a tentativa serviria
         a ninguém. O log existe porque isto é silencioso na tela. */
      console.warn('[turn] Cloudflare não respondeu, seguindo só com STUN:', e.message);
      return base;
    }
  }

  const turn = list('TURN_URLS');
  if (!turn.length) return base;

  const secret = process.env.TURN_SECRET;
  if (secret) {
    /* O formato é do RFC 5766 e todo servidor sério fala ele: o usuário é
       "<expira em unix>:<quem é>", e a senha é o HMAC-SHA1 desse usuário em
       base64. O servidor recalcula e compara — não existe cadastro. */
    const username = `${Math.floor(now / 1000) + TTL_SECONDS}:${reviewerId}`;
    const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
    return [...base, { urls: turn, username, credential }];
  }

  const username = process.env.TURN_USERNAME;
  const credential = process.env.TURN_PASSWORD;
  if (username && credential) return [...base, { urls: turn, username, credential }];
  return base;
}

/** Tests only: esquece a credencial guardada. */
function reset() {
  cache = null;
  pending = null;
}

module.exports = { iceServers, hasTurn, reset, TTL_SECONDS, STUN_FALLBACK };
