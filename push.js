const crypto = require('node:crypto');

/* ══════════════════════════════════════════════════════════════════════════
   O AVISO QUE CHEGA COM O APP FECHADO.

   O sino do produto só existe enquanto alguém está olhando. Um episódio que
   estreia hoje é justamente o aviso que precisa alcançar quem não está — e o
   caminho para isso é o Web Push: o navegador deixa um endereço conosco, e nós
   entregamos a mensagem ao serviço dele (Google, Mozilla, Apple), que acorda o
   aparelho.

   ── três coisas, e só a última é nossa ──────────────────────────────────
   1. **VAPID** (RFC 8292) é como o serviço sabe que somos nós: um JWT assinado
      com uma chave nossa, e a metade pública dela viaja junto. Serve para o
      serviço poder nos calar se abusarmos — e é por isso que ele é obrigatório.
   2. **A cifra** (RFC 8291) é o que o serviço NÃO pode ler. Ele carrega a
      mensagem e não sabe o que ela diz: a chave sai de um ECDH entre uma chave
      nossa de uma vez só e a do aparelho, temperado com um segredo que o
      próprio aparelho sorteou.
   3. **O conteúdo** é a única parte que é sobre o clube.

   ── e por que isto está escrito aqui, e não instalado ───────────────────
   `web-push` é a biblioteca óbvia, e são umas quinze dependências para o que
   cabe em cento e poucas linhas de `node:crypto` — este servidor inteiro tem
   duas dependências. O que torna isso seguro de escrever à mão é que o RFC 8291
   publica um vetor de teste completo: a mesma entrada tem de dar exatamente a
   mesma saída, byte a byte, e é isso que test/push.test.js cobra.

   ── o que ele NÃO cobre ─────────────────────────────────────────────────
   O WebView de um aplicativo Capacitor não tem Push API. Isto alcança o
   navegador, o app instalado pelo navegador (PWA) e a casca TWA; para a casca
   Capacitor, o caminho é FCM, que é outra porta e outra conversa com o Google.
   ══════════════════════════════════════════════════════════════════════════ */

const CURVE = 'prime256v1';
const B64 = 'base64url';

/* O tamanho de registro do aes128gcm. Um só registro, sempre: a maior mensagem
   que este produto manda tem duzentos bytes. */
const RECORD = 4096;

/** As chaves desta instalação, ou null quando ninguém configurou. */
function keys() {
  const pub = (process.env.VAPID_PUBLIC || '').trim();
  const priv = (process.env.VAPID_PRIVATE || '').trim();
  if (!pub || !priv) return null;
  /* O assunto é como o serviço de push fala conosco se algo der errado. Um
     mailto basta, e um endereço inválido faz a Apple recusar a entrega. */
  const subject = (process.env.VAPID_SUBJECT || '').trim() || 'mailto:cineclube@example.com';
  return { public: pub, private: priv, subject };
}

/** Um par novo, para `npm run push:keys`. */
function generate() {
  const par = crypto.generateKeyPairSync('ec', { namedCurve: CURVE });
  const jwk = par.privateKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, B64),
    Buffer.from(jwk.y, B64),
  ]);
  return { public: publicKey.toString(B64), private: jwk.d };
}

/** A chave privada bruta virando um objeto que o Node assina. */
function privateKeyOf(raw) {
  const d = Buffer.from(raw, B64);
  const ecdh = crypto.createECDH(CURVE);
  ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey();
  return crypto.createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: d.toString(B64),
      x: pub.subarray(1, 33).toString(B64),
      y: pub.subarray(33, 65).toString(B64),
    },
  });
}

/* ── VAPID: quem está mandando ────────────────────────────────────────────
   Doze horas de validade, que é o teto que os serviços aceitam. O público-alvo
   é a ORIGEM do endereço de entrega, e não o endereço inteiro: o JWT vale para
   todas as inscrições daquele serviço, e é o que permite guardá-lo por um
   tempo em vez de assinar um por aparelho. */
function vapidHeader(endpoint, { public: pub, private: priv, subject }) {
  const aud = new URL(endpoint).origin;
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString(B64);
  const body = Buffer.from(
    JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })
  ).toString(B64);
  const assinado = `${header}.${body}`;
  /* `ieee-p1363` é o R||S cru de 64 bytes. O padrão do Node é DER, que um
     verificador de JWT recusa sem dizer por quê. */
  const sig = crypto.sign('sha256', Buffer.from(assinado), {
    key: privateKeyOf(priv),
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${assinado}.${sig.toString(B64)}, k=${pub}`;
}

/* ── a cifra ──────────────────────────────────────────────────────────────
   RFC 8291 por cima do RFC 8188. A ordem importa e cada passo tem um texto
   fixo que entra na conta; trocar um caractere produz uma mensagem que o
   aparelho recusa sem explicar.

   `par` e `salt` existem para o teste poder repetir o vetor do RFC. Em produção
   os dois são sorteados a cada mensagem, e é isso que faz duas mensagens iguais
   não parecerem iguais para quem as carrega. */
function encrypt(payload, sub, par = null, salt = crypto.randomBytes(16)) {
  const uaPublic = Buffer.from(sub.p256dh, B64);
  const authSecret = Buffer.from(sub.auth, B64);

  const ecdh = crypto.createECDH(CURVE);
  if (par) ecdh.setPrivateKey(Buffer.from(par, B64));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);

  /* O material de chave: o segredo do ECDH temperado com o segredo do aparelho,
     e amarrado às duas chaves públicas — é o que impede a mesma mensagem de ser
     reaproveitada contra outro aparelho. */
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    uaPublic,
    asPublic,
  ]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));

  const cek = Buffer.from(
    crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  );
  const nonce = Buffer.from(
    crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12)
  );

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  /* O 0x02 é o delimitador de ÚLTIMO registro. Com 0x01 o aparelho fica
     esperando um segundo que nunca vem. */
  const corpo = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const cabeca = Buffer.alloc(5);
  cabeca.writeUInt32BE(RECORD, 0);
  cabeca.writeUInt8(asPublic.length, 4);

  return Buffer.concat([salt, cabeca, asPublic, corpo]);
}

/* ── entregar ─────────────────────────────────────────────────────────────
   Um POST ao endereço que o aparelho deu. As respostas que importam são duas:
   201 é entregue ao serviço — não ao aparelho, que pode estar desligado —, e
   404 ou 410 querem dizer que aquele endereço não existe mais. Nesse caso a
   inscrição é apagada por quem chamou: insistir com ela é gastar uma
   requisição por dia até o fim dos tempos. */
async function send(sub, payload, { ttl = 12 * 3600 } = {}) {
  const chaves = keys();
  if (!chaves) return { ok: false, gone: false, status: 0, error: 'sem VAPID configurado' };

  let res;
  try {
    res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        TTL: String(ttl),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        Authorization: vapidHeader(sub.endpoint, chaves),
        /* Normal, e não alta: alta é para o que precisa acordar o aparelho na
           hora. Um episódio que estreia hoje espera o aparelho acordar. */
        Urgency: 'normal',
      },
      body: encrypt(payload, sub),
    });
  } catch (e) {
    // Rede fora, DNS, serviço caído: não é a inscrição que está errada.
    return { ok: false, gone: false, status: 0, error: e.message };
  }

  return {
    ok: res.status >= 200 && res.status < 300,
    gone: res.status === 404 || res.status === 410,
    status: res.status,
  };
}

module.exports = { keys, generate, encrypt, vapidHeader, send };
