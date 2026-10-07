const crypto = require('node:crypto');

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

const base = () => (process.env.FCM_BASE || 'https://fcm.googleapis.com').replace(/\/$/, '');
const oauth = () => process.env.FCM_OAUTH || 'https://oauth2.googleapis.com/token';

function account() {
  const inteiro = (process.env.FCM_SERVICE_ACCOUNT || '').trim();
  if (inteiro) {
    try {
      const j = JSON.parse(inteiro);
      if (j.project_id && j.client_email && j.private_key) {
        return { projectId: j.project_id, email: j.client_email, key: j.private_key };
      }
    } catch {
      console.warn('[fcm] FCM_SERVICE_ACCOUNT não é um JSON legível.');
      return null;
    }
    return null;
  }

  const projectId = (process.env.FCM_PROJECT_ID || '').trim();
  const email = (process.env.FCM_CLIENT_EMAIL || '').trim();
  const key = (process.env.FCM_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (!projectId || !email || !key) return null;
  return { projectId, email, key };
}

const configured = () => !!account();

let held = null;

async function accessToken(conta) {
  if (held && held.até > Date.now() + 60_000) return held.token;

  const agora = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const corpo = Buffer.from(
    JSON.stringify({
      iss: conta.email,
      scope: SCOPE,
      aud: oauth(),
      iat: agora,
      exp: agora + 3600,
    })
  ).toString('base64url');

  const assinado = `${header}.${corpo}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(assinado), conta.key).toString('base64url');

  const res = await fetch(oauth(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${assinado}.${sig}`,
    }),
  });
  if (!res.ok) throw new Error(`o Google recusou a conta de serviço: ${res.status}`);

  const { access_token: token, expires_in: dura } = await res.json();
  held = { token, até: Date.now() + (dura || 3600) * 1000 };
  return token;
}

async function send(sub, conteudo) {
  const conta = account();
  if (!conta) return { ok: false, gone: false, status: 0, error: 'sem conta de serviço' };

  let res;
  let corpo;
  try {
    const token = await accessToken(conta);
    res = await fetch(`${base()}/v1/projects/${conta.projectId}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: sub.endpoint,
          notification: { title: conteudo.title, body: conteudo.body },
          data: { url: String(conteudo.url || '/') },
          android: {
            priority: 'normal',
            notification: {
              tag: String(conteudo.tag || 'cineclube'),
              icon: 'ic_launcher',
            },
          },
        },
      }),
    });
    corpo = await res.text();
  } catch (e) {
    return { ok: false, gone: false, status: 0, error: e.message };
  }

  const morto =
    res.status === 404 ||
    (res.status === 400 && /UNREGISTERED|INVALID_ARGUMENT/.test(corpo)) ||
    /UNREGISTERED/.test(corpo);

  return { ok: res.ok, gone: !res.ok && morto, status: res.status };
}

module.exports = { configured, send };
