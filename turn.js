const crypto = require('node:crypto');

/* Dois, de operadores diferentes: isto é ponto único de falha para o recurso
   inteiro e são gratuitos. Um fora do ar custa um candidato, não a noite. */
const STUN_FALLBACK = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];

/* Uma sessão cabe folgada. A sobra é para a reconexão: quem caiu no meio do
   filme não pode esbarrar numa senha vencida enquanto o clube espera. */
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

/* Por pessoa e não uma constante do módulo: a credencial efêmera carrega o id
   de quem pediu, então o log do TURN diz de quem é o tráfego. */
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
  /* Esta senha não expira e sai daqui para o navegador de todo mundo do clube.
     Serve, mas é o primeiro lugar de olhar se o tráfego do TURN pular. */
  if (username && credential) servers.push({ urls: turn, username, credential });
  return servers;
}

module.exports = { iceServers, hasTurn, TTL_SECONDS, STUN_FALLBACK };
