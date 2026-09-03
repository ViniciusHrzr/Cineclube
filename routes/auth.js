const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const wrap = require('../wrap');

const router = express.Router();

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
  if (!req.session) return res.json({ reviewer: null, google: configured() });
  res.json({
    reviewer: {
      id: req.session.reviewer_id,
      name: req.session.name,
      dot: req.session.dot,
      isAdmin: !!req.session.is_admin,
      email: req.session.email || null,
      /* A bio vem junto porque o saguão precisa dela: lá não existe elenco de
         clube nenhum de onde lê-la, e a folha de conta é a mesma nos dois
         lugares. */
      bio: req.session.bio || null,
      avatar: avatarUrl(req.session.reviewer_id, req.session.avatar_rev),
    },
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
router.post('/login', wrap(async (req, res) => {
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
