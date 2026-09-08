/* ══════════════════════════════════════════════════════════════════════════
   MANDAR UM E-MAIL: confirmar um endereço, e devolver o acesso a quem perdeu a
   senha. As duas são um segredo de vida curta que só chega a quem lê aquela
   caixa, e cuja apresentação é a prova.

   HTTP e não SMTP: SMTP exigiria `nodemailer`, e este app tem duas dependências
   de produção — magreza é propriedade de segurança no processo que guarda as
   senhas do clube. Brevo porque deixa verificar UM REMETENTE (um Gmail) em vez
   de exigir domínio próprio, e este produto mora num subdomínio do Render.

   Sem `BREVO_API_KEY` nada é enviado e nada quebra: `send` devolve
   `sent: false` e diz por quê. As rotas tratam o não-envio como uma resposta
   possível, nunca como exceção.
   ══════════════════════════════════════════════════════════════════════════ */

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/* Um provedor lento não pode virar requisição pendurada: quem pediu o link está
   olhando um botão girando, e o cano deste app é uma thread só. */
const TIMEOUT_MS = 8000;

const key = () => (process.env.BREVO_API_KEY || '').trim();
const from = () => (process.env.CINECLUBE_MAIL_FROM || '').trim();
const fromName = () => (process.env.CINECLUBE_MAIL_FROM_NAME || 'Cineclube').trim();

/** Está configurado para enviar? As telas perguntam antes de oferecer o botão. */
const configured = () => !!(key() && from());

/* Um aviso só por processo. Sem isto, um app sem chave escreveria a mesma linha
   em todo pedido de link — e um log que se repete é um log que não se lê. */
let avisou = false;

/* `Key not found` quase nunca é chave errada digitada: é a chave ERRADA
   copiada. A página "SMTP & API" do Brevo mostra a senha de SMTP em destaque e
   a chave da API v3 na aba ao lado, e colar a primeira aqui dá exatamente esta
   mensagem sem sugerir que foi isso. Uma chave v3 começa com `xkeysib-`.

   Nada da chave sai no log: só o comprimento e um sim/não sobre o prefixo, que
   é marcador público do formato (como `sk_live_` ou `ghp_`) e identifica o TIPO
   da credencial, não a credencial. */
function keyHint() {
  const k = key();
  const forma = `${k.length} caracteres`;
  if (k.startsWith('xkeysib-')) {
    return `[mail] a chave tem a forma certa (xkeysib-…, ${forma}), então ela foi revogada, é de outra conta, ou está incompleta. Gere outra em SMTP & API → API Keys.`;
  }
  return `[mail] a chave NÃO começa com "xkeysib-" (${forma}) — isso é a senha de SMTP, não a chave da API. No Brevo: SMTP & API → aba API Keys → Generate a new API key.`;
}

/* O link do e-mail precisa ser absoluto, e a fonte é a mesma variável do fluxo
   do Google. Relativo, num cliente de e-mail, não é link. */
function baseUrl() {
  return (process.env.CINECLUBE_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

/* Devolve `{ sent }` e nunca lança: um provedor fora do ar não é motivo para
   responder 500, e a tela sabe dizer que o link pode não chegar.

   No log vai o status e o começo da resposta do provedor. A chave nunca, o
   corpo nunca — um corpo de e-mail carrega o token. */
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
        /* Texto puro: a versão em HTML seria uma segunda cópia da mesma
           mensagem para manter em dia, e é a que os clientes mais estragam. */
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
    /* Só a mensagem: um erro de rede pode ter trazido junto a requisição
       inteira, e a requisição inteira tem o token dentro. */
    console.error(`[mail] falha ao enviar: ${e?.message}`);
    return { sent: false, reason: 'error' };
  }
}

/* As duas mensagens moram aqui e não na rota porque são texto do produto. As
   duas dizem quanto o link dura e o que fazer se você não pediu nada — a
   segunda frase é a que importa: quem recebe uma redefinição sem ter pedido
   precisa entender que ninguém entrou na conta dela. */

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

/* Redefinição pedida por conta com endereço ainda não confirmado. Não dá a
   senha de volta — dá o passo que falta antes disso. */
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
