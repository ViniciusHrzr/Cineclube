const crypto = require('node:crypto');

const CURVE = 'prime256v1';
const B64 = 'base64url';

const RECORD = 4096;

function keys() {
  const pub = (process.env.VAPID_PUBLIC || '').trim();
  const priv = (process.env.VAPID_PRIVATE || '').trim();
  if (!pub || !priv) return null;
  const subject = (process.env.VAPID_SUBJECT || '').trim() || 'mailto:cineclube@example.com';
  return { public: pub, private: priv, subject };
}

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

function vapidHeader(endpoint, { public: pub, private: priv, subject }) {
  const aud = new URL(endpoint).origin;
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString(B64);
  const body = Buffer.from(
    JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })
  ).toString(B64);
  const assinado = `${header}.${body}`;
  const sig = crypto.sign('sha256', Buffer.from(assinado), {
    key: privateKeyOf(priv),
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${assinado}.${sig.toString(B64)}, k=${pub}`;
}

function encrypt(payload, sub, par = null, salt = crypto.randomBytes(16)) {
  const uaPublic = Buffer.from(sub.p256dh, B64);
  const authSecret = Buffer.from(sub.auth, B64);

  const ecdh = crypto.createECDH(CURVE);
  if (par) ecdh.setPrivateKey(Buffer.from(par, B64));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);

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
        Urgency: 'normal',
      },
      body: encrypt(payload, sub),
    });
  } catch (e) {
    return { ok: false, gone: false, status: 0, error: e.message };
  }

  return {
    ok: res.status >= 200 && res.status < 300,
    gone: res.status === 404 || res.status === 410,
    status: res.status,
  };
}

module.exports = { keys, generate, encrypt, vapidHeader, send };
