const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const mail = require('../mail');
const throttle = require('../throttle');
const wrap = require('../wrap');

const router = express.Router();

/* ══════════════════════════════════════════════════════════════════════════
   AS DUAS TRAVAS DA PORTA, e elas não são a que já existia — `auth.js` tranca
   UMA CONTA depois de cinco senhas erradas, e quem vem abaixo não está
   adivinhando.

   **Cadastrar é a raiz de todo o resto.** Toda outra trava conta por conta;
   quem pode criar mil identidades tem mil vezes cada um daqueles limites.

   **E as duas rotas rodam `scryptSync`**, caro de propósito e SÍNCRONO: cada
   tentativa para o servidor inteiro por uma fração de segundo. Sem isto, um
   laço em `/register` derruba o app pedindo educadamente, muitas vezes. A trava
   por conta não ajuda — quem varre e-mails diferentes está sempre na primeira
   tentativa de uma conta que não existe.

   Por IP, porque a conta é justamente o que ainda não existe.
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
   AS TRAVAS DOS LINKS POR E-MAIL, cada número vindo do que a ação significa:

   - **Pedir confirmação** é raro por natureza: uma vez na vida, mais o reenvio.
   - **Pedir redefinição** é medido em DOIS eixos: por conta, para ninguém
     encher a caixa de entrada de uma pessoa específica; por endereço de rede,
     porque quem varre e-mails alheios não tem conta e escaparia do primeiro.
   - **Apresentar um token** são 256 bits de acaso, então adivinhar não é um
     caminho — a trava é barata e transforma "impossível" em "impossível e
     barulhento".

   Os dois pedidos gastam um envio de verdade, que é uma cota diária com outro
   dono: um laço sem trava esgota o provedor e derruba o recurso para o clube.
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

/* A URL e não os bytes, como no elenco: eles pertencem a uma requisição
   cacheável, e não a toda resposta que por acaso mencione uma pessoa. */
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
   Entrar, por duas portas para a mesma conta.

   O Google é a porta normal: um clique, e quem cuida de segundo fator e de
   conta invadida é quem já cuida disso para o resto da vida da pessoa.

   A senha existe para a porta não ser única — o dia em que aquela conta sumir,
   ou em que a pessoa não quiser mais usá-la, o clube continua acessível.
   ══════════════════════════════════════════════════════════════════════════ */

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const STATE_COOKIE = 'cc_oauth';

/* ── a volta para dentro do aplicativo ───────────────────────────────────
   O Google recusa OAuth dentro de um WebView, então o aplicativo abre a porta
   no NAVEGADOR DO SISTEMA. A sessão nasce lá, e o que precisa atravessar de
   volta é só a permissão de criar um par de chaves aqui dentro.

   Quem atravessa é um endereço de esquema próprio — `cineclube://auth?code=` —
   com um bilhete de um minuto e de um uso. O par nunca viaja na URL: ele vale
   noventa dias, e uma URL é escrita no log de todo intermediário do caminho.

   O ESTADO carrega a marca do aplicativo, e não um cookie: quem volta do Google
   é o navegador do sistema, e o cookie que ele guardou é dele. */
const APP_SCHEME = 'cineclube://auth';
const APP_MARK = 'app.';

const clientId = () => process.env.GOOGLE_CLIENT_ID || '';
const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET || '';
const configured = () => !!(clientId() && clientSecret());

/* Precisa bater CARACTERE A CARACTERE com um dos URIs cadastrados no console do
   Google. É o erro de configuração mais comum aqui e aparece como
   `redirect_uri_mismatch` numa página do Google, longe deste arquivo — por isso
   a variável é explícita e não deduzida do cabeçalho Host, que um proxy
   reescreve. */
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

/* Quem é você? O cliente pergunta no boot para decidir entre a tela de entrada
   e o app; sessão vencida é resposta normal, não erro.

   `google` diz se a porta do Google existe nesta instalação: um botão que leva
   a um 503 é pior do que um botão que não está lá. */
router.get('/me', (req, res) => {
  /* As duas capacidades vão nos DOIS ramos. Este é o de quem está deslogado, e
     é justamente ele que a tela de entrada consulta — com `mail` só no ramo de
     baixo, "Esqueci minha senha" nunca aparecia. Nenhuma das duas conta nada
     sobre ninguém: são fatos sobre a INSTALAÇÃO. */
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
      /* A bio vem junto porque quem a lê nem sempre está numa sala com elenco
         carregado — a folha da conta abre de qualquer tela. */
      bio: req.session.bio || null,
      avatar: avatarUrl(req.session.reviewer_id, req.session.avatar_rev),
    },
    /* Se esta instalação sabe mandar e-mail. Sem isso a tela não oferece
       "reenviar confirmação" nem "esqueci minha senha": um botão que não tem
       como funcionar é pior que a ausência dele. */
    mail: mail.configured(),
    /* É um estado da conta e não um passo de um assistente: quem pular hoje
       volta a ver o convite amanhã, porque a razão de ele existir — não
       depender de uma porta só — não expira. */
    needsPassword: !req.session.has_password,
    google: configured(),
  });
});

/* O `state` vai para o Google e volta, e a cópia fica num cookie que só este
   navegador tem. Sem essa conferência na volta, qualquer um forjaria um retorno
   de callback e entraria como quem quisesse — é a proteção contra CSRF do fluxo
   inteiro. */
router.get('/google', (req, res) => {
  if (!configured()) {
    return res.status(503).json({ error: 'A entrada pelo Google não está configurada nesta instalação.' });
  }
  /* `?app=1` é o aplicativo pedindo para voltar por outro caminho. A marca vai
     no estado porque ele é a única coisa que sobrevive à ida ao Google e volta
     conferida. */
  const state = (req.query.app ? APP_MARK : '') + crypto.randomBytes(24).toString('base64url');
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

/* Toda saída daqui é um redirect e nunca um JSON: quem está olhando é um
   navegador que acabou de sair do Google, e um objeto cru na tela é o produto
   quebrando na frente de alguém que só clicou em entrar. */
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

    /* O `id_token` não é verificado por assinatura porque não veio pelo
       navegador: veio desta requisição, feita por este servidor, direto ao
       Google, sobre TLS — o próprio OpenID Connect dispensa a verificação nesse
       caso. Deixaria de valer no dia em que um id_token chegasse pelo cliente.
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

  /* ── voltando para um aplicativo ───────────────────────────────────────
     Nada de cookie: ele ficaria no navegador do sistema, que não é quem vai
     usar a conta. O que vai é um bilhete de um uso, trocado por um par de
     chaves assim que o app o receber.

     E vai numa PÁGINA, não num redirecionamento. Um 302 para um esquema que
     não é http o navegador simplesmente engole — a navegação para um aplicativo
     é considerada externa, e navegador nenhum a faz sem alguém ter tocado em
     alguma coisa. O `meta refresh` tenta primeiro, porque em muitos aparelhos
     funciona; o botão é o que sempre funciona.

     Sem script: a política de conteúdo desta instalação só aceita os scripts
     em linha cujo hash ela conhece, e eles são os do index.html. */
  if (String(state).startsWith(APP_MARK)) {
    const code = await auth.createTicket(reviewer.id, 'handoff');
    const volta = `${APP_SCHEME}?code=${encodeURIComponent(code)}`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(`<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0;url=${volta}">
<title>Entrando no Cineclube</title>
<style>
  html { color-scheme: dark }
  body { margin:0; min-height:100dvh; display:flex; flex-direction:column;
         align-items:center; justify-content:center; gap:1.5rem; padding:2rem;
         background:#07090e; color:#ffe9c4; text-align:center;
         font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif }
  p { margin:0; color:#9d9686; font-size:.95rem; line-height:1.5; max-width:28ch }
  a { display:inline-block; padding:.9rem 1.6rem; border-radius:6px;
      background:#d12a20; color:#fff6e6; text-decoration:none; font-weight:600;
      letter-spacing:.06em; text-transform:uppercase; font-size:.9rem }
</style>
</head><body>
<p>Pronto. Volte para o Cineclube para terminar de entrar.</p>
<a href="${volta}">Voltar ao Cineclube</a>
</body></html>`);
  }

  const sessionToken = await auth.createSession(reviewer.id);
  auth.sendSessionCookie(res, sessionToken);
  // A raiz, e o cliente decide o resto: sem senha ele pede uma, com senha ele
  // abre o primeiro clube da pessoa. Quem sabe disso é a tela, não esta rota.
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

/* A porta para quem não usa Google. Entra logado, porque pedir a senha que a
   pessoa acabou de escolher é o formulário duvidando dela.

   Ao contrário do login, a colisão de e-mail PRECISA ser dita: sem ela a pessoa
   fica tentando criar uma conta que já é dela e não entende por quê. Um
   cadastro sempre revela quais e-mails existem, e esconder isso quebraria o
   cadastro para proteger o que a tela de "esqueci a senha" entrega de qualquer
   jeito. */
router.post('/register', throttleRegister, wrap(async (req, res) => {
  const { name, email, password } = req.body || {};
  const out = await auth.register({ name, email, password });
  if (out.error) {
    return res.status(out.error.includes('Já existe') ? 409 : 400).json({ error: out.error });
  }
  const token = await auth.createSession(out.reviewer.id);
  auth.sendSessionCookie(res, token);

  /* A confirmação sai sozinha: o momento em que a pessoa entende por que
     confirmar é ESTE, o de acabar de criar a conta. O botão de reenviar
     continua existindo para o primeiro envio que some no spam.

     `await` e não disparado ao vento, porque `mail.send` nunca lança. E o
     cadastro não morre por causa dele: a conta já existe e a sessão já foi
     aberta acima. */
  if (out.reviewer.email) await sendVerification(out.reviewer);

  res.status(201).json({ reviewer: publicReviewer(out.reviewer) });
}));

/* ══════════════════════════════════════════════════════════════════════════
   CONFIRMAR O ENDEREÇO, E VOLTAR PARA DENTRO SEM A SENHA.

   O link do e-mail leva à TELA (`#confirmar/<token>`), e é a tela que faz o
   POST. Apontar direto para uma rota num GET custa caro: servidores de e-mail e
   antivírus ABREM os links das mensagens antes de a pessoa ver, e um token que
   se gasta ao ser aberto é um token que o scanner do Gmail queima no caminho.
   Um POST vindo da tela não é feito por scanner nenhum.

   Pedir redefinição responde sempre a mesma coisa: "e-mail não cadastrado"
   transformaria esta rota numa lista de quem tem conta aqui. O que muda é só o
   que chega — ou não chega — na caixa de entrada de quem for dono dela.
   ══════════════════════════════════════════════════════════════════════════ */

/* Um lugar só, porque são dois chamadores: o cadastro, que dispara sozinho, e o
   botão de reenviar. Escrito duas vezes, o dia em que o texto mudar ele muda em
   um dos dois. */
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
     isto, alguém em muitos endereços de rede diferentes usaria este produto
     para encher a caixa de entrada de uma pessoa. */
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
           Uma conta sem endereço confirmado não recupera senha — devolver acesso
           por um endereço que ninguém provou é devolver acesso a quem quer que
           o tenha escrito no cadastro. Só que confirmar exige estar dentro, e
           quem pede isto está fora.

           Então o pedido não é recusado em silêncio: o que chega é o link de
           CONFIRMAR. Dois passos em vez de um, num caso raro, e nenhum deles
           entrega acesso a um endereço não provado. */
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

/* ══════════════════════════════════════════════════════════════════════════
   A PORTA DO APLICATIVO.

   O navegador entra e sai com cookie, e não precisa de mais nada. Um app não
   tem cookie que preste: numa casca com os arquivos embarcados a origem é
   `capacitor://localhost`, e um cookie de outro domínio ali é cookie de
   terceiro — que o WebView pode simplesmente não guardar. Então ele recebe um
   PAR de chaves e apresenta a primeira em `Authorization: Bearer`.

   Duas formas de pegar o par, e as duas terminam no mesmo lugar:

   · **e-mail e senha** no corpo, que é a tela de entrar do app.
   · **uma sessão que já vale**, apresentada por cookie. É o caminho de quem
     entrou pelo Google numa aba do sistema: o retorno do Google cria a sessão
     de navegador, e o app a troca por um par sem pedir senha nenhuma.

   A mesma trava por endereço de rede do login, porque isto é um login. */
router.post('/token', throttleLogin, wrap(async (req, res) => {
  const { email, password, handoff } = req.body || {};

  /* A terceira forma, e ela é a volta do Google dentro de um aplicativo: um
     bilhete de um uso, criado no callback, trocado aqui pelo par de chaves. */
  if (handoff !== undefined) {
    const quem = await auth.useTicket(String(handoff || ''), 'handoff');
    if (!quem) return res.status(401).json({ error: 'Esta entrada não vale mais. Tente de novo.' });
    const par = await auth.createTokenPair(quem.reviewer_id);
    return res.json({ ...par, reviewer: publicReviewer(await getReviewer.get(quem.reviewer_id)) });
  }

  if (email === undefined && password === undefined) {
    if (!req.session) return res.status(401).json({ error: 'Entre para continuar.' });
    const par = await auth.createTokenPair(req.session.reviewer_id);
    return res.json({ ...par, reviewer: publicReviewer(await getReviewer.get(req.session.reviewer_id)) });
  }

  const mailAddr = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const reviewer = mailAddr
    ? await db.prepare('SELECT * FROM reviewers WHERE email = ? COLLATE NOCASE').get(mailAddr)
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

  const par = await auth.createTokenPair(reviewer.id);
  res.json({ ...par, reviewer: publicReviewer(reviewer) });
}));

/* O esquema que o aplicativo registra para receber a volta do Google. Servido
   e não escrito no cliente para os dois lados nunca discordarem: mudar aqui e
   esquecer lá seria uma entrada que abre o navegador e não volta nunca. */
router.get('/scheme', (req, res) => res.json({ scheme: APP_SCHEME }));

/* Um bilhete para o cano ao vivo. Vale um minuto e um uso, e existe porque
   `EventSource` não manda cabeçalho: num aplicativo, sem isto, a sala
   sincronizada e o mural ao vivo não existem. Ver auth.js. */
router.post('/ticket', auth.requireSession, wrap(async (req, res) => {
  res.json({ ticket: await auth.createTicket(req.session.reviewer_id, 'stream') });
}));

/* Troca a chave de renovação por um par novo. A chave apresentada é GASTA —
   receber a mesma duas vezes quer dizer que existem duas cópias dela no mundo,
   e aí a família inteira cai. Ver auth.js.

   Sem sessão e sem cookie: quem chama isto é justamente quem não tem mais uma
   sessão que valha. */
router.post('/refresh', throttleLogin, wrap(async (req, res) => {
  const par = await auth.rotateRefresh(req.body?.refresh);
  if (!par) return res.status(401).json({ error: 'Entre de novo.' });
  res.json(par);
}));

/* Sair. Apaga a sessão apresentada, o cookie que a carregava, e — quando quem
   sai é um app — a família de chaves inteira: sair no aparelho é sair, e uma
   chave de noventa dias que sobrevive ao "sair" é a porta que ficou aberta. */
router.post('/logout', wrap(async (req, res) => {
  await auth.destroySession(req.sessionToken);
  const family = await auth.familyOf(req.body?.refresh);
  if (family) await auth.destroyRefreshFamily(family);
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
