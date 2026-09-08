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
   uma falha ruidosa — é uma conexão que fica tentando e nunca fecha —, e é
   exatamente por isso que ele está aqui desde o primeiro dia em vez de ser um
   remendo para quando alguém reclamar.

   ── as duas formas de credencial ────────────────────────────────────────
   Um servidor TURN aberto é um proxy aberto: qualquer um na internet mandaria
   tráfego por ele às suas custas. Então todos pedem usuário e senha, e há duas
   maneiras de dar isso a um navegador.

   · **Segredo compartilhado** (`TURN_SECRET`). O jeito certo, e o que o coturn
     chama de `use-auth-secret`. O usuário é um prazo de validade, a senha é o
     HMAC dele com um segredo que só o servidor e este arquivo conhecem, e o
     TURN valida sem consultar banco nenhum. A credencial que sai daqui vale
     algumas horas e depois não vale mais nada — o que importa porque ela vive
     no JavaScript de uma aba, onde qualquer pessoa do clube pode lê-la.

   · **Usuário e senha fixos** (`TURN_USERNAME`/`TURN_PASSWORD`). O que a maior
     parte dos serviços prontos entrega no painel. Funciona igual, com uma
     diferença que não é pequena: essa senha não expira, e ela sai daqui para o
     navegador de todo mundo. Serve, e é o caminho de dez minutos; se um dia o
     tráfego do TURN pular sem explicação, é o primeiro lugar de olhar.

   Nada aqui é obrigatório. Sem variável nenhuma, sobra o STUN público e a tela
   ao vivo funciona para quem não estiver atrás de CGNAT — que é a maioria, mas
   nunca é todo mundo.
   ══════════════════════════════════════════════════════════════════════════ */

/* Dois, de operadores diferentes, porque isto é um ponto único de falha para o
   recurso inteiro e são gratuitos: um deles fora do ar custa um candidato
   perdido em vez da noite. */
const STUN_FALLBACK = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];

/* Quanto tempo uma credencial efêmera vale. Uma sessão cabe folgada, e o que a
   sobra compra é a reconexão: uma pessoa que caiu no meio do filme e voltou
   não pode esbarrar numa senha vencida enquanto o clube espera. */
const TTL_SECONDS = 6 * 3600;

/** Lista separada por vírgula ou espaço. Vazia quando a variável não existe. */
function list(name) {
  return (process.env[name] || '')
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** Há um relay configurado? A tela usa isto para saber o que prometer. */
function hasTurn() {
  return (
    list('TURN_URLS').length > 0 &&
    Boolean(process.env.TURN_SECRET || (process.env.TURN_USERNAME && process.env.TURN_PASSWORD))
  );
}

/* O que o navegador recebe. Por pessoa e não uma constante do módulo porque a
   credencial efêmera carrega o id de quem pediu: se um dia um clube estiver
   torrando o relay, o log do TURN diz de quem é o tráfego. */
function iceServers(reviewerId, now = Date.now()) {
  const stun = list('STUN_URLS');
  const servers = [{ urls: stun.length ? stun : STUN_FALLBACK }];

  const turn = list('TURN_URLS');
  if (!turn.length) return servers;

  const secret = process.env.TURN_SECRET;
  if (secret) {
    /* O formato é do RFC 5766 e todo servidor sério fala ele: o usuário é
       "<expira em unix>:<quem é>", e a senha é o HMAC-SHA1 desse usuário em
       base64. O servidor recalcula e compara — não existe cadastro. */
    const username = `${Math.floor(now / 1000) + TTL_SECONDS}:${reviewerId}`;
    const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
    servers.push({ urls: turn, username, credential });
    return servers;
  }

  const username = process.env.TURN_USERNAME;
  const credential = process.env.TURN_PASSWORD;
  if (username && credential) servers.push({ urls: turn, username, credential });
  return servers;
}

module.exports = { iceServers, hasTurn, TTL_SECONDS, STUN_FALLBACK };
