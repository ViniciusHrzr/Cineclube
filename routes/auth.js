const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const mail = require('../mail');
const throttle = require('../throttle');
const wrap = require('../wrap');

const router = express.Router();

/* ══════════════════════════════════════════════════════════════════════════
   AS DUAS TRAVAS DA PORTA, e elas não são a que já existia.

   `auth.js` tranca UMA CONTA depois de cinco senhas erradas, por um tempo que
   cresce. Isso protege contra quem está adivinhando a senha de alguém, e não
   alcança nada do que vem abaixo — porque quem vem abaixo não está adivinhando.

   **Cadastrar é a raiz de todo o resto.** Toda outra trava deste produto conta
   por conta: trinta fichas por hora, vinte comentários por minuto. Uma conta
   nova custa uma requisição, então quem pode criar mil identidades tem mil
   vezes cada um daqueles limites, e nenhum deles quer dizer coisa alguma.

   **E as duas rotas rodam `scryptSync`**, que é caro de propósito — é o que
   torna uma senha roubada difícil de quebrar. Só que ele é síncrono e o Node
   tem uma thread: cada tentativa para o servidor inteiro por uma fração de
   segundo. Sem isto, um laço em `/register` não precisa de brecha nenhuma para
   derrubar o app; basta pedir educadamente, muitas vezes. A trava por conta não
   ajuda aqui: quem varre e-mails diferentes está sempre na primeira tentativa
   de uma conta que não existe.

   Por IP, e não por conta, porque a conta é justamente o que ainda não existe.
   Cinco cadastros por hora cobre uma casa em que duas pessoas se inscrevem na
   mesma noite; vinte entradas em quinze minutos cobre quem erra, corrige e
   volta. Os dois são paredes para um laço.
   ══════════════════════════════════════════════════════════════════════════ */
const throttleRegister = throttle.limit({
  name: 'register',
  max: 5,
  windowMs: 60 * 60_000,
  by: 'ip',
  message: espera => `Muitas contas criadas daqui. Tente de novo em ${espera}.`,
});

const throttleLogin = throttle.limit({
  name: 'login',
  max: 20,
  windowMs: 15 * 60_000,
  by: 'ip',
  message: espera => `Muitas tentativas de entrada. Tente de novo em ${espera}.`,
});

/* ══════════════════════════════════════════════════════════════════════════
   AS TRAVAS DOS LINKS POR E-MAIL

   Toda rota nova abaixo é medida, pela mesma régua do resto do app, e cada
   número vem do que a ação significa:

   - **Pedir confirmação** é raro por natureza: você confirma um endereço uma
     vez na vida, e reenvia quando o primeiro não chegou. Três por hora.
   - **Pedir redefinição** é medido em DOIS eixos, e isso não é excesso. Por
     conta, para ninguém encher a caixa de entrada de uma pessoa específica; por
     endereço de rede, porque quem varre e-mails alheios não tem conta nenhuma e
     escaparia inteiro de um limite por conta.
   - **Apresentar um token** é o único que um programa tentaria adivinhar. São
     256 bits de acaso, então adivinhar não é um caminho — mas a trava é barata
     e transforma "impossível" em "impossível e barulhento".

   Os dois pedidos ainda gastam um envio de e-mail de verdade, que é uma cota
   diária com outro dono. Um laço sem trava aqui esgota o provedor e derruba o
   recurso para o clube inteiro.
   ══════════════════════════════════════════════════════════════════════════ */
const throttleVerifySend = throttle.limit({
  name: 'verify:send',
  max: 3,
  windowMs: 60 * 60_000,
  message: espera => `Já mandamos a confirmação. Tente de novo em ${espera}.`,
});

const throttleResetByIp = throttle.limit({
  name: 'reset:ip',
  max: 10,
  windowMs: 60 * 60_000,
  by: 'ip',
  message: espera => `Muitos pedidos daqui. Tente de novo em ${espera}.`,
});

const throttleTokenTry = throttle.limit({
  name: 'token:try',
  max: 20,
  windowMs: 15 * 60_000,
  by: 'ip',
  message: espera => `Muitas tentativas. Tente de novo em ${espera}.`,
});

const getReviewer = db.prepare('SELECT * FROM reviewers WHERE id = ?');

/* The picture travels as a URL for the same reason it does in the roster: the
   bytes belong in one cacheable request, not in every response that happens to
   mention a person. `rev` is what makes that cache safe. */
const avatarUrl = (id, rev) => (rev ? `/api/reviewers/${id}/avatar?v=${rev}` : null);

/** Never leak the hash, the salt, or the lock bookkeeping. */
function publicReviewer(r) {
  return {
    id: r.id,
    name: r.name,
    dot: r.dot,
    isAdmin: !!r.is_admin,
    email: r.email || null,
    /* Se o endereço já foi provado. A tela precisa disto para saber se mostra o
       aviso de confirmar e se oferece fundar um clube. */
    emailVerified: !!r.email_verified,
    avatar: avatarUrl(r.id, r.avatar_rev),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Entrar.

   Duas portas para a mesma conta, e a ordem entre elas é deliberada.

   O Google é a porta normal: um clique, nenhuma senha nova para inventar, e
   quem cuida de segundo fator e de conta invadida é quem já cuida disso para o
   resto da vida da pessoa.

   A senha existe para a porta não ser única. Ela é pedida uma vez, logo depois
   da primeira entrada pelo Google, e o dia em que aquela conta sumir — ou em
   que a pessoa simplesmente não quiser usá-la — o clube continua acessível. Um
   produto com uma porta só é um produto que alguém pode perder inteiro por um
   motivo que não tem nada a ver com ele.
   ══════════════════════════════════════════════════════════════════════════ */

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const STATE_COOKIE = 'cc_oauth';

const clientId = () => process.env.GOOGLE_CLIENT_ID || '';
const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET || '';
const configured = () => !!(clientId() && clientSecret());

/* Precisa bater CARACTERE A CARACTERE com um dos URIs cadastrados no console do
   Google — esquema, porta e caminho. É o erro de configuração mais comum aqui,
   e ele aparece como `redirect_uri_mismatch` numa página do Google, longe deste
   arquivo, então a variável é explícita em vez de deduzida do cabeçalho Host:
   um proxy que reescreve Host produziria um URI que ninguém cadastrou. */
const redirectUri = () =>
  `${(process.env.CINECLUBE_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')}/api/auth/google/callback`;

function sendStateCookie(res, value) {
  const secure = process.env.CINECLUBE_HTTPS === '1' ? '; Secure' : '';
  // Lax e não Strict: o navegador volta do Google por uma navegação de topo, e
  // Strict não manda cookie nenhum numa requisição que veio de outro site.
  res.setHeader(
    'Set-Cookie',
    `${STATE_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=600${secure}`
  );
}

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/* Quem é você? O cliente pergunta isto no boot para decidir entre a tela de
   entrada e o app. Sessão ausente ou vencida é uma resposta normal, não um erro.

   `google` diz se a porta do Google existe nesta instalação: sem as variáveis
   configuradas o botão não deve nem aparecer, e um botão que leva a um 503 é
   pior do que um botão que não está lá. */
router.get('/me', (req, res) => {
  /* ── as duas capacidades vão nos DOIS ramos ────────────────────────────
     Este é o ramo de quem está deslogado, e é justamente ele que a tela de
     entrada consulta. `mail` estava só no ramo de baixo, então "Esqueci minha
     senha" nunca aparecia: a única tela que precisa da resposta é a única que
     não a recebia.

     Nenhuma das duas conta nada sobre ninguém — são fatos sobre a INSTALAÇÃO,
     do mesmo tipo que já se descobre olhando se o botão do Google está lá. */
  if (!req.session) {
    return res.json({ reviewer: null, google: configured(), mail: mail.configured() });
  }
  res.json({
    reviewer: {
      id: req.session.reviewer_id,
      name: req.session.name,
      dot: req.session.dot,
      isAdmin: !!req.session.is_admin,
      email: req.session.email || null,
      emailVerified: !!req.session.email_verified,
      /* A bio vem junto porque o saguão precisa dela: lá não existe elenco de
         clube nenhum de onde lê-la, e a folha de conta é a mesma nos dois
         lugares. */
      bio: req.session.bio || null,
      avatar: avatarUrl(req.session.reviewer_id, req.session.avatar_rev),
    },
    /* Se esta instalação sabe mandar e-mail. Sem isso a tela não oferece
       "reenviar confirmação" nem "esqueci minha senha": um botão que não tem
       como funcionar é pior que a ausência dele. */
    mail: mail.configured(),
    /* A tela de cadastro de senha vive disto. É um estado da conta e não um
       passo de um assistente: quem pular hoje volta a ver o convite amanhã,
       porque a razão de ela existir — não depender de uma porta só — não
       expira. */
    needsPassword: !req.session.has_password,
    google: configured(),
  });
});

/* ── a ida ────────────────────────────────────────────────────────────────
   O `state` é um número aleatório que vai para o Google e volta, e a cópia dele
   fica num cookie que só este navegador tem. Sem essa conferência na volta,
   qualquer um poderia forjar um retorno de callback e entrar como quem ele
   quisesse — é a proteção contra CSRF do fluxo inteiro, e é a única coisa aqui
   que não pode ser esquecida. */
router.get('/google', (req, res) => {
  if (!configured()) {
    return res.status(503).json({ error: 'A entrada pelo Google não está configurada nesta instalação.' });
  }
  const state = crypto.randomBytes(24).toString('base64url');
  sendStateCookie(res, state);

  const url = new URL(GOOGLE_AUTH);
  url.searchParams.set('client_id', clientId());
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  // Sempre a tela de contas: quem tem duas escolhe, em vez de entrar com a que
  // o navegador lembra e descobrir depois que trouxe a errada.
  url.searchParams.set('prompt', 'select_account');
  res.redirect(url.toString());
});

/* ── e a volta ────────────────────────────────────────────────────────────
   Toda saída daqui é um redirect para a página, e nunca um JSON: quem está
   olhando é um navegador que acabou de sair do Google, e um objeto cru na tela
   é o produto quebrando na frente de alguém que só clicou em entrar. O erro
   viaja no endereço e a tela de entrada o mostra. */
router.get('/google/callback', wrap(async (req, res) => {
  const fail = why => res.redirect('/#entrar?erro=' + encodeURIComponent(why));

  if (!configured()) return fail('A entrada pelo Google não está configurada.');

  const { code, state, error } = req.query;
  // A pessoa apertou "cancelar" na tela do Google. Não é falha de nada.
  if (error) return res.redirect('/#entrar');

  const expected = readCookie(req, STATE_COOKIE);
  sendStateCookie(res, ''); // usado uma vez, e só uma
  if (!code || !state || !expected || state !== expected) {
    return fail('A volta do Google não confere. Tente entrar de novo.');
  }

  let payload;
  try {
    const body = new URLSearchParams({
      code: String(code),
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    });
    const r = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error('[auth] o Google recusou a troca do código:', r.status, detail);
      return fail('O Google recusou a entrada. Tente de novo.');
    }
    const token = await r.json();

    /* ── por que o id_token não é verificado por assinatura ────────────────
       Porque ele não veio pelo navegador: veio desta requisição, feita por este
       servidor, direto ao endpoint do Google, sobre TLS. O próprio OpenID
       Connect dispensa a verificação de assinatura exatamente nesse caso — o
       canal já é a prova de origem. Verificar exigiria buscar e rodar as chaves
       públicas do Google, que é trabalho e uma dependência a mais para provar
       uma coisa que o TLS já provou.

       Isto deixaria de valer no dia em que um id_token chegasse pelo cliente.
       Nenhum chega. */
    const [, claims] = String(token.id_token || '').split('.');
    payload = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8'));
  } catch (e) {
    console.error('[auth] falha ao falar com o Google:', e);
    return fail('Não foi possível falar com o Google. Tente de novo.');
  }

  if (!payload?.sub) return fail('O Google não disse quem você é. Tente de novo.');

  const { reviewer } = await auth.accountForGoogle({
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    verified: payload.email_verified === true || payload.email_verified === 'true',
  });

  const sessionToken = await auth.createSession(reviewer.id);
  auth.sendSessionCookie(res, sessionToken);
  // A raiz, e o cliente decide o resto: sem senha ele pede uma, com clube ele
  // abre o saguão. Quem sabe disso é a tela, não esta rota.
  res.redirect('/');
}));

/* ── e-mail e senha ───────────────────────────────────────────────────────
   Uma forma só de falhar para senha errada e para e-mail que não existe, para
   este endpoint não virar um jeito de descobrir quem tem conta aqui. */
router.post('/login', throttleLogin, wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const mail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const reviewer = mail
    ? await db.prepare('SELECT * FROM reviewers WHERE email = ? COLLATE NOCASE').get(mail)
    : null;

  const wrong = () => res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  if (!reviewer || !auth.isValidPassword(password)) return wrong();

  const result = await auth.checkPassword(reviewer, password);
  if (result === 'locked') {
    const left = await auth.lockedSecondsLeft(await getReviewer.get(reviewer.id));
    return res.status(429).json({ error: `Muitas tentativas. Tente de novo em ${left}s.`, retryAfter: left });
  }
  if (result === 'unset') {
    return res.status(409).json({
      error: 'Esta conta ainda não tem senha. Entre pelo Google uma vez para cadastrar uma.',
    });
  }
  if (result !== 'ok') {
    const after = await getReviewer.get(reviewer.id);
    const left = await auth.lockedSecondsLeft(after);
    if (left > 0) {
      return res.status(429).json({ error: `Muitas tentativas. Tente de novo em ${left}s.`, retryAfter: left });
    }
    return wrong();
  }

  const token = await auth.createSession(reviewer.id);
  auth.sendSessionCookie(res, token);
  res.json({ reviewer: publicReviewer(reviewer) });
}));

/* ── criar uma conta ──────────────────────────────────────────────────────
   A porta para quem não usa Google. Entra logado, porque pedir para a pessoa
   digitar a senha que ela acabou de escolher é o formulário duvidando dela.

   Mesma frase para "e-mail já cadastrado" e nada mais — aqui, ao contrário do
   login, a colisão precisa ser dita: sem ela a pessoa fica tentando criar uma
   conta que já é dela e não entende por quê. É a troca honesta: um cadastro
   sempre revela quais e-mails existem, e esconder isso quebraria o cadastro
   inteiro para proteger uma informação que a tela de "esqueci a senha" de
   qualquer produto também entrega. */
router.post('/register', throttleRegister, wrap(async (req, res) => {
  const { name, email, password } = req.body || {};
  const out = await auth.register({ name, email, password });
  if (out.error) {
    return res.status(out.error.includes('Já existe') ? 409 : 400).json({ error: out.error });
  }
  const token = await auth.createSession(out.reviewer.id);
  auth.sendSessionCookie(res, token);

  /* ── a confirmação sai sozinha ─────────────────────────────────────────
     Sem isto, o link só existia depois de a pessoa achar o sino e apertar um
     botão — e o momento em que ela entende por que confirmar é ESTE, o de
     acabar de criar a conta. Pedir a mesma ação duas telas depois é pedi-la a
     alguém que já esqueceu o motivo.

     O botão de reenviar continua existindo, e não é redundância: primeiro
     envio some no spam, gente digita o endereço errado, provedor cai. Um é o
     caminho normal; o outro é o conserto.

     `await` e não disparado ao vento, porque `mail.send` nunca lança — o pior
     caso é `sent: false`, que já está tratado. Mas o cadastro não morre por
     causa dele: a conta já existe e a sessão já foi aberta acima. */
  if (out.reviewer.email) await sendVerification(out.reviewer);

  res.status(201).json({ reviewer: publicReviewer(out.reviewer) });
}));

/* ══════════════════════════════════════════════════════════════════════════
   Reivindicar a conta de antes do Google.

   O porquê inteiro está em auth.js. Aqui só a forma: quem já tinha conta escolhe
   o próprio nome numa lista curta e prova com o PIN que sempre usou.

   A lista só mostra contas que dividem um clube com quem perguntou. Como as
   contas de antes estão todas no clube fundador, que é fechado, isso quer dizer
   que ver a lista exige o ADM já ter deixado a pessoa entrar — e é esse aval, e
   não o PIN, que impede um estranho de chutar quatro dígitos num rosto alheio.
   ══════════════════════════════════════════════════════════════════════════ */
router.get('/claimable', auth.requireSession, wrap(async (req, res) => {
  const rows = await auth.claimable(req.session.reviewer_id);
  res.json({
    accounts: rows.map(r => ({
      id: r.id,
      name: r.name,
      dot: r.dot,
      avatar: avatarUrl(r.id, r.avatar_rev),
    })),
  });
}));

/* "Não é nenhuma dessas." Grava a resposta, e a tela não volta — em navegador
   nenhum. Antes isto era um `useState` que sumia no primeiro F5, o que na
   prática queria dizer que a pergunta não tinha resposta possível. */
router.post('/claim/dismiss', auth.requireSession, wrap(async (req, res) => {
  await auth.dismissClaim(req.session.reviewer_id);
  res.json({ ok: true });
}));

router.post('/claim', auth.requireSession, wrap(async (req, res) => {
  const { reviewerId, pin } = req.body || {};
  const me = req.session.reviewer_id;
  if (!reviewerId || reviewerId === me) {
    return res.status(400).json({ error: 'Escolha qual conta é a sua.' });
  }

  /* Quem reivindica precisa ser uma conta de agora. Uma conta adormecida
     reivindicando outra seria duas contas mortas se fundindo — e o caminho para
     alguém encadear reivindicações sem nunca provar nada com uma credencial de
     verdade. */
  const quem = await getReviewer.get(me);
  if (!quem?.google_sub && !quem?.password_hash) {
    return res.status(409).json({ error: 'Entre pelo Google ou com uma senha antes de reivindicar.' });
  }

  /* A mesma condição da lista, cobrada aqui — porque a lista é uma sugestão e o
     id viaja no corpo do pedido. Sem esta linha, um estranho tentaria PINs em
     qualquer conta só por saber um id, e a proteção inteira seria decorativa. */
  if (!(await auth.canClaim(me, reviewerId))) {
    return res.status(403).json({ error: 'Você só reivindica uma conta de um clube em que já está.' });
  }

  const veredito = await auth.checkClaimPin(reviewerId, pin);
  if (veredito === 'gone') {
    return res.status(404).json({ error: 'Essa conta já foi reivindicada, ou não existe mais.' });
  }
  if (veredito === 'locked') {
    const left = await auth.lockedSecondsLeft(await getReviewer.get(reviewerId));
    return res.status(429).json({ error: `Muitas tentativas. Tente de novo em ${left}s.`, retryAfter: left });
  }
  if (veredito !== 'ok') return res.status(401).json({ error: 'PIN incorreto.' });

  const out = await auth.claimAccount(me, reviewerId);
  if (out.error) return res.status(409).json(out);

  /* A sessão apontava para a conta que acabou de deixar de existir. Uma nova,
     na conta de verdade — sem isto o navegador ficaria segurando um token órfão
     e a pessoa cairia na tela de entrada logo depois de acertar o PIN. */
  const token = await auth.createSession(out.reviewer.id);
  auth.sendSessionCookie(res, token);
  res.json({ reviewer: publicReviewer(out.reviewer) });
}));

/* ══════════════════════════════════════════════════════════════════════════
   CONFIRMAR O ENDEREÇO, E VOLTAR PARA DENTRO SEM A SENHA.

   As duas coisas moram juntas porque são a mesma: um segredo de vida curta que
   só chega a quem lê aquela caixa, e cuja apresentação é a prova.

   ── por que o link do e-mail não é a rota ─────────────────────────────────
   O link leva à TELA (`#confirmar/<token>`), e é a tela que faz o POST. A
   tentação é apontar direto para uma rota e resolver num GET, e ela custa caro:
   servidores de e-mail e antivírus ABREM os links das mensagens antes de a
   pessoa ver, para conferir se são seguros. Um token que se gasta ao ser aberto
   é um token que o scanner do Gmail queima no caminho, e a pessoa clica num
   link que já não vale sem ninguém ter errado nada.

   Um POST vindo da tela não é feito por scanner nenhum.

   ── e por que pedir redefinição sempre responde a mesma coisa ─────────────
   "E-mail não cadastrado" transforma esta rota numa lista de quem tem conta
   aqui: basta pedir uma redefinição para cada endereço que se queira testar. A
   resposta é idêntica exista a conta ou não, e o que muda é só o que chega (ou
   não chega) na caixa de entrada de quem for dono dela.

   O cadastro revela colisão de e-mail e continua revelando — lá a informação é
   necessária para a pessoa entender por que não consegue criar a conta, e
   escondê-la quebraria o cadastro para proteger o que a tela de "esqueci minha
   senha" de qualquer produto entrega de qualquer jeito. Aqui não é necessária.
   ══════════════════════════════════════════════════════════════════════════ */

/* Cria o link e manda. Um lugar só, porque são dois chamadores: o cadastro, que
   dispara sozinho, e o botão de reenviar. Escrito duas vezes, o dia em que o
   texto do e-mail mudar ele muda em um dos dois. */
async function sendVerification(reviewer) {
  const token = await auth.createEmailToken(reviewer.id, 'verify', reviewer.email);
  const { subject, text } = mail.verifyMail(
    reviewer.name,
    `${mail.baseUrl()}/#confirmar/${token}`
  );
  return mail.send({ to: reviewer.email, toName: reviewer.name, subject, text });
}

/** Reenviar a confirmação para o próprio endereço. */
router.post('/verify/send', auth.requireSession, throttleVerifySend, wrap(async (req, res) => {
  const reviewer = await getReviewer.get(req.session.reviewer_id);
  if (!reviewer?.email) return res.status(400).json({ error: 'Sua conta não tem e-mail.' });
  if (reviewer.email_verified) return res.json({ ok: true, already: true });

  const out = await sendVerification(reviewer);
  /* Um provedor fora do ar não é erro do produto, e a tela sabe dizer a
     diferença entre "mandamos" e "não conseguimos mandar agora". */
  res.json({ ok: true, sent: out.sent });
}));

/** Apresentar o token de confirmação. Não exige sessão: pode chegar de outro aparelho. */
router.post('/verify', throttleTokenTry, wrap(async (req, res) => {
  const quem = await auth.useEmailToken(req.body?.token, 'verify');
  if (!quem) {
    return res.status(400).json({ error: 'Este link não vale mais. Peça outro.' });
  }
  await auth.markVerified(quem.id);
  res.json({ ok: true, name: quem.name });
}));

/* Pedir para redefinir. Sem sessão, por definição: quem chegou aqui não
   consegue entrar. */
router.post('/reset/request', throttleResetByIp, wrap(async (req, res) => {
  const reviewer = await auth.accountByEmail(req.body?.email);

  /* Um segundo eixo, por conta, e ele só existe quando a conta existe: sem
     isto, alguém em muitos endereços de rede diferentes poderia usar este
     produto para encher a caixa de entrada de uma pessoa. */
  if (reviewer) {
    const cabe = throttle.take(`reset:conta|${reviewer.id}`, 5, 60 * 60_000);
    if (cabe.ok) {
      if (reviewer.email_verified) {
        const token = await auth.createEmailToken(reviewer.id, 'reset', reviewer.email);
        const { subject, text } = mail.resetMail(
          reviewer.name,
          `${mail.baseUrl()}/#senha/${token}`
        );
        await mail.send({ to: reviewer.email, toName: reviewer.name, subject, text });
      } else {
        /* ── o caminho que evita o beco sem saída ──────────────────────────
           Uma conta sem endereço confirmado não recupera senha — é a regra do
           produto, e ela está certa: devolver acesso por um endereço que
           ninguém provou é devolver acesso a quem quer que tenha escrito
           aquele endereço no cadastro.

           Só que confirmar exige estar dentro, e quem está pedindo isto está
           fora. Aplicada ao pé da letra, a regra tranca a pessoa para sempre.

           Então o pedido não é recusado em silêncio: o que chega é o link de
           CONFIRMAR. Clicando nele o endereço fica provado, e o pedido de
           redefinição seguinte funciona. São dois passos em vez de um, num
           caso raro, e nenhum deles entrega acesso a um endereço não provado. */
        const token = await auth.createEmailToken(reviewer.id, 'verify', reviewer.email);
        const { subject, text } = mail.verifyFirstMail(
          reviewer.name,
          `${mail.baseUrl()}/#confirmar/${token}`
        );
        await mail.send({ to: reviewer.email, toName: reviewer.name, subject, text });
      }
    }
  }

  /* Sempre a mesma resposta, com conta ou sem. Ver a nota de abertura. */
  res.json({ ok: true });
}));

/** Apresentar o token de redefinição junto da senha nova. */
router.post('/reset', throttleTokenTry, wrap(async (req, res) => {
  const { token, password } = req.body || {};
  if (!auth.isValidPassword(password)) {
    return res.status(400).json({
      error: `A senha precisa ter entre ${auth.MIN_PASSWORD} e ${auth.MAX_PASSWORD} caracteres.`,
    });
  }
  const quem = await auth.useEmailToken(token, 'reset');
  if (!quem) return res.status(400).json({ error: 'Este link não vale mais. Peça outro.' });

  await auth.setPassword(quem.id, password);
  /* ── e todo mundo sai ──────────────────────────────────────────────────
     Redefinir uma senha é o que se faz quando se suspeita que alguém entrou.
     Deixar as sessões abertas seria trocar a fechadura e não recolher as
     cópias da chave. É a mesma regra da troca de senha por dentro do app.

     Inclusive a de quem está redefinindo: logo abaixo nasce uma nova, para a
     pessoa não ser mandada para a tela de entrada no segundo em que acabou de
     provar quem é. */
  await auth.destroyAllSessions(quem.id);

  const reviewer = await getReviewer.get(quem.id);
  const nova = await auth.createSession(quem.id);
  auth.sendSessionCookie(res, nova);
  res.json({ reviewer: publicReviewer(reviewer) });
}));

router.post('/logout', wrap(async (req, res) => {
  await auth.destroySession(req.sessionToken);
  auth.clearSessionCookie(res);
  res.status(204).end();
}));

/* Cadastrar ou trocar a própria senha. A atual é exigida quando já existe uma,
   para quem chegar num navegador destrancado não conseguir trancar o dono fora
   da própria conta. Na primeira vez não existe atual — é justamente o caso da
   tela que aparece depois da primeira entrada pelo Google. */
router.post('/password', auth.requireSession, wrap(async (req, res) => {
  const { current, password } = req.body || {};
  if (!auth.isValidPassword(password)) {
    return res.status(400).json({
      error: `A senha precisa ter entre ${auth.MIN_PASSWORD} e ${auth.MAX_PASSWORD} caracteres.`,
    });
  }
  const reviewer = await getReviewer.get(req.session.reviewer_id);
  if (!reviewer) return res.status(404).json({ error: 'Conta não encontrada.' });

  if (reviewer.password_hash) {
    if (!auth.isValidPassword(current)) return res.status(401).json({ error: 'Senha atual incorreta.' });
    const result = await auth.checkPassword(reviewer, current);
    if (result === 'locked') {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde antes de tentar de novo.' });
    }
    if (result !== 'ok') return res.status(401).json({ error: 'Senha atual incorreta.' });
  }

  /* Sem e-mail não há como entrar com senha nenhuma, e uma conta pode não ter
     um: as de exemplo nascem sem. Recusar é mais honesto do que gravar uma
     senha que nunca vai poder ser usada. */
  if (!reviewer.email) {
    return res.status(409).json({
      error: 'Esta conta não tem e-mail. Entre pelo Google uma vez para vincular um.',
    });
  }

  await auth.setPassword(reviewer.id, password);
  // Todo outro navegador com esta conta é deslogado; este continua.
  await auth.destroyAllSessions(reviewer.id);
  const token = await auth.createSession(reviewer.id);
  auth.sendSessionCookie(res, token);
  res.json({ ok: true });
}));

module.exports = router;
