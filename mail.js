/* ══════════════════════════════════════════════════════════════════════════
   MANDAR UM E-MAIL.

   Duas coisas neste produto precisam disso, e são a mesma coisa com dois usos:
   confirmar que um endereço é seu, e devolver o acesso a quem perdeu a senha.
   As duas se resumem a um segredo de vida curta que só chega a quem lê aquela
   caixa de entrada, e cuja apresentação é a prova.

   ── por que HTTP e não SMTP ───────────────────────────────────────────────
   SMTP exigiria `nodemailer`. Este app tem duas dependências de produção, e essa
   magreza é uma propriedade de segurança: é o processo que guarda as senhas do
   clube. A API do Brevo é um POST com `fetch`, que o Node já tem.

   ── e por que Brevo ───────────────────────────────────────────────────────
   Porque ele deixa verificar UM REMETENTE — um endereço de Gmail — em vez de
   exigir um domínio próprio. Os concorrentes com API melhor exigem domínio para
   escrever a qualquer pessoa, e este produto mora num subdomínio do Render.

   ── sem chave, o app continua de pé ───────────────────────────────────────
   Sem `BREVO_API_KEY` nada é enviado e nada quebra: `send` devolve `sent: false`
   e diz por quê. É o estado do desenvolvimento e dos testes, e é o estado da
   produção enquanto a chave não estiver lá. As rotas que dependem disto tratam
   o não-envio como uma resposta possível, nunca como uma exceção.
   ══════════════════════════════════════════════════════════════════════════ */

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/* Oito segundos. Um provedor de e-mail lento não pode virar uma requisição
   pendurada: quem pediu um link está olhando para um botão girando, e o cano
   deste app é uma thread só. */
const TIMEOUT_MS = 8000;

const key = () => (process.env.BREVO_API_KEY || '').trim();
const from = () => (process.env.CINECLUBE_MAIL_FROM || '').trim();
const fromName = () => (process.env.CINECLUBE_MAIL_FROM_NAME || 'Cineclube').trim();

/** Está configurado para enviar? As telas perguntam antes de oferecer o botão. */
const configured = () => !!(key() && from());

/* Um aviso só por processo. Sem isto, um app sem chave escreveria a mesma linha
   em todo pedido de link — e um log que se repete é um log que não se lê. */
let avisou = false;

/* ══════════════════════════════════════════════════════════════════════════
   O QUE UM 401 QUASE SEMPRE QUER DIZER.

   `Key not found` é o provedor dizendo que não reconhece a chave, e a causa
   quase nunca é uma chave errada digitada: é a chave ERRADA copiada. A página
   "SMTP & API" do Brevo mostra as credenciais de SMTP em destaque — um login e
   uma senha mestra — e a chave da API v3 fica na aba ao lado. Copiar a senha de
   SMTP e colar aqui produz exatamente esta mensagem, e nada na mensagem sugere
   que foi isso.

   Uma chave v3 começa com `xkeysib-`. Então o diagnóstico é conferir a FORMA e
   dizer o que está errado, em vez de deixar quem está lendo o log adivinhar.

   ── e o que este log não conta ────────────────────────────────────────────
   Nada da chave. Sai o comprimento e um sim/não sobre o prefixo — e `xkeysib-`
   é o marcador público do formato, do mesmo tipo que `sk_live_` ou `ghp_`: ele
   identifica o TIPO da credencial, não a credencial. Um segredo em log é um
   segredo vazado, e um diagnóstico que exige vazar o segredo para funcionar não
   é um diagnóstico, é o problema seguinte.
   ══════════════════════════════════════════════════════════════════════════ */
function keyHint() {
  const k = key();
  const forma = `${k.length} caracteres`;
  if (k.startsWith('xkeysib-')) {
    return `[mail] a chave tem a forma certa (xkeysib-…, ${forma}), então ela foi revogada, é de outra conta, ou está incompleta. Gere outra em SMTP & API → API Keys.`;
  }
  return `[mail] a chave NÃO começa com "xkeysib-" (${forma}) — isso é a senha de SMTP, não a chave da API. No Brevo: SMTP & API → aba API Keys → Generate a new API key.`;
}

/* ── o endereço público deste app ─────────────────────────────────────────
   O link do e-mail precisa ser absoluto, e a única fonte disso é a mesma
   variável que o fluxo do Google já usa. Sem ela o link sairia relativo, o que
   num cliente de e-mail não é um link. */
function baseUrl() {
  return (process.env.CINECLUBE_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

/* ══════════════════════════════════════════════════════════════════════════
   O envio.

   Devolve `{ sent }` e nunca lança. Um provedor fora do ar não é motivo para
   uma rota responder 500: quem pediu o link pediu uma coisa que pode não
   chegar, e a tela sabe dizer isso. Lançar aqui transformaria uma falha
   externa e temporária num erro do produto.

   O que vai para o log é o suficiente para consertar e nada além: o status e o
   começo da resposta do provedor. A chave nunca, o corpo nunca — um corpo de
   e-mail carrega o token, e um token em log é um token vazado.
   ══════════════════════════════════════════════════════════════════════════ */
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
        /* Texto puro, e só. Um e-mail deste produto tem quatro linhas e um
           link; a versão em HTML seria uma segunda cópia da mesma mensagem para
           manter em dia, e é a que os clientes de e-mail mais estragam. */
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

/* ══════════════════════════════════════════════════════════════════════════
   As duas mensagens.

   Escritas aqui e não na rota, porque são texto do produto — a mesma razão pela
   qual as frases do sino são escritas pelo servidor e não montadas na tela.

   As duas dizem quanto tempo o link dura e as duas dizem o que fazer se você
   não pediu nada. A segunda frase é a que importa: um e-mail de redefinição que
   não explica o que ele é assusta quem o recebe sem ter pedido, e essa pessoa é
   exatamente quem precisa entender que ninguém entrou na conta dela.
   ══════════════════════════════════════════════════════════════════════════ */

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

/* O e-mail que responde a um pedido de redefinição feito por uma conta cujo
   endereço ainda não foi confirmado. Não dá a senha de volta — dá o passo que
   falta antes disso. Ver a nota em routes/auth.js sobre por que existem dois
   caminhos e não um. */
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
