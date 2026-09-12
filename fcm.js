const crypto = require('node:crypto');

/* ══════════════════════════════════════════════════════════════════════════
   O MESMO AVISO, PELA PORTA DO ANDROID.

   Web Push (push.js) alcança o navegador, o app instalado pelo navegador e a
   casca TWA. Não alcança o WebView de uma casca Capacitor: lá não existe Push
   API, e o aparelho é acordado pelo serviço do próprio Android — o FCM.

   São duas portas para a mesma mensagem, e quem decide qual é a linha da
   inscrição: `kind` é `web` ou `fcm`. O texto, a conta de quem recebe e o
   registro de quem já foi avisado são os mesmos dos dois lados — ver
   routes/push.js.

   ── o que o Google pede ──────────────────────────────────────────────────
   Uma conta de serviço do projeto Firebase, que é um JSON com uma chave RSA
   dentro. Com ela se assina um JWT, o JWT vira um token de acesso de uma hora,
   e o token autoriza o envio. Nada disso entra no repositório: a conta inteira
   vive numa variável de ambiente.

   Sem a conta configurada, esta porta não existe — e uma inscrição `fcm` que
   chegasse mesmo assim falha como qualquer entrega que não saiu.
   ══════════════════════════════════════════════════════════════════════════ */

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/* Os dois endereços do Google, com uma saída para o teste apontá-los a um
   servidor de mentira: sem isso, testar a entrega pediria um projeto Firebase
   de verdade e uma chave que ninguém pode guardar num repositório. Em produção
   ninguém mexe nas duas variáveis. */
const base = () => (process.env.FCM_BASE || 'https://fcm.googleapis.com').replace(/\/$/, '');
const oauth = () => process.env.FCM_OAUTH || 'https://oauth2.googleapis.com/token';

/** A conta de serviço, de uma variável só (o JSON inteiro) ou de três. */
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
  /* A chave vem de um JSON, onde as quebras de linha são `\n` literais. Num
     painel de variáveis de ambiente elas chegam assim, e um PEM sem quebras de
     verdade não é um PEM. */
  const key = (process.env.FCM_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (!projectId || !email || !key) return null;
  return { projectId, email, key };
}

const configured = () => !!account();

/* O token de acesso vale uma hora. Guardado porque uma noite de avisos são
   dezenas de entregas, e pedir um token novo em cada uma é uma volta ao Google
   por aparelho. */
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

/* ── entregar ─────────────────────────────────────────────────────────────
   A resposta que importa é `UNREGISTERED` / `NOT_FOUND`: o aplicativo foi
   desinstalado, ou o token trocado. Como no Web Push, quem chama apaga a
   inscrição — insistir é gastar uma requisição por dia até o fim dos tempos. */
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
          /* `notification` e não só `data`: com ela o Android desenha o aviso
             sozinho quando o app está fechado, que é justamente o caso. */
          notification: { title: conteudo.title, body: conteudo.body },
          data: { url: String(conteudo.url || '/') },
          android: {
            priority: 'normal',
            notification: {
              /* A mesma etiqueta substitui o aviso anterior em vez de empilhar,
                 como no worker do navegador. */
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
