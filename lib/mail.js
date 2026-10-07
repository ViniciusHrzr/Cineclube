const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

const TIMEOUT_MS = 8000;

const key = () => (process.env.BREVO_API_KEY || '').trim();
const from = () => (process.env.CINECLUBE_MAIL_FROM || '').trim();
const fromName = () => (process.env.CINECLUBE_MAIL_FROM_NAME || 'Cineclube').trim();

const configured = () => !!(key() && from());

let avisou = false;

function keyHint() {
  const k = key();
  const forma = `${k.length} caracteres`;
  if (k.startsWith('xkeysib-')) {
    return `[mail] a chave tem a forma certa (xkeysib-…, ${forma}), então ela foi revogada, é de outra conta, ou está incompleta. Gere outra em SMTP & API → API Keys.`;
  }
  return `[mail] a chave NÃO começa com "xkeysib-" (${forma}) — isso é a senha de SMTP, não a chave da API. No Brevo: SMTP & API → aba API Keys → Generate a new API key.`;
}

function baseUrl() {
  return (process.env.CINECLUBE_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

async function send({ to, toName, subject, text }) {
  if (!configured()) {
    if (!avisou) {
      avisou = true;
      console.warn(
        '[mail] BREVO_API_KEY ou CINECLUBE_MAIL_FROM não configurados — nenhum e-mail será enviado.'
      );
    }
    return { sent: false, reason: 'unconfigured' };
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': key(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: from(), name: fromName() },
        to: [{ email: to, name: toName || undefined }],
        subject,
        textContent: text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const detalhe = (await res.text().catch(() => '')).slice(0, 200);
      console.error(`[mail] o provedor recusou (${res.status}): ${detalhe}`);
      if (res.status === 401) console.error(keyHint());
      return { sent: false, reason: 'rejected' };
    }
    return { sent: true };
  } catch (e) {
    console.error(`[mail] falha ao enviar: ${e?.message}`);
    return { sent: false, reason: 'error' };
  }
}

const verifyMail = (nome, link) => ({
  subject: 'Confirme seu e-mail no Cineclube',
  text: [
    `Oi, ${nome}.`,
    '',
    'Confirme que este endereço é seu abrindo o link abaixo:',
    link,
    '',
    'O link vale por 24 horas.',
    '',
    'Se você não criou uma conta no Cineclube, pode ignorar esta mensagem — sem a confirmação, nada acontece.',
  ].join('\n'),
});

const resetMail = (nome, link) => ({
  subject: 'Redefinir sua senha do Cineclube',
  text: [
    `Oi, ${nome}.`,
    '',
    'Para escolher uma senha nova, abra o link abaixo:',
    link,
    '',
    'O link vale por 1 hora e só funciona uma vez.',
    '',
    'Se não foi você que pediu, ignore esta mensagem: sua senha atual continua valendo e ninguém entrou na sua conta.',
  ].join('\n'),
});

const verifyFirstMail = (nome, link) => ({
  subject: 'Confirme seu e-mail para redefinir a senha',
  text: [
    `Oi, ${nome}.`,
    '',
    'Você pediu para redefinir sua senha, mas este endereço ainda não foi confirmado.',
    'Confirme primeiro, aqui:',
    link,
    '',
    'Depois disso, peça a redefinição de novo e o link chega.',
    '',
    'O link acima vale por 24 horas. Se não foi você que pediu, pode ignorar.',
  ].join('\n'),
});

module.exports = {
  send,
  configured,
  keyHint,
  baseUrl,
  verifyMail,
  resetMail,
  verifyFirstMail,
  TIMEOUT_MS,
};
