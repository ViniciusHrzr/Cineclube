const crypto = require('node:crypto');
const express = require('express');
const db = require('../lib/db');
const auth = require('../lib/auth');
const mail = require('../lib/mail');
const throttle = require('../lib/throttle');
const wrap = require('../lib/wrap');

const router = express.Router();

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

const avatarUrl = (id, rev) => (rev ? `/api/reviewers/${id}/avatar?v=${rev}` : null);

function publicReviewer(r) {
  return {
    id: r.id,
    name: r.name,
    dot: r.dot,
    isAdmin: !!r.is_admin,
    email: r.email || null,
    emailVerified: !!r.email_verified,
    avatar: avatarUrl(r.id, r.avatar_rev),
  };
}

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const STATE_COOKIE = 'cc_oauth';

const APP_SCHEME = 'cineclube://auth';
const APP_MARK = 'app.';

const clientId = () => process.env.GOOGLE_CLIENT_ID || '';
const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET || '';
const configured = () => !!(clientId() && clientSecret());

const redirectUri = () =>
  `${(process.env.CINECLUBE_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')}/api/auth/google/callback`;

function sendStateCookie(res, value) {
  const secure = process.env.CINECLUBE_HTTPS === '1' ? '; Secure' : '';
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

router.get('/me', (req, res) => {
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
      bio: req.session.bio || null,
      avatar: avatarUrl(req.session.reviewer_id, req.session.avatar_rev),
    },
    mail: mail.configured(),
    needsPassword: !req.session.has_password,
    google: configured(),
  });
});

router.get('/google', (req, res) => {
  if (!configured()) {
    return res.status(503).json({ error: 'A entrada pelo Google não está configurada nesta instalação.' });
  }
  const state = (req.query.app ? APP_MARK : '') + crypto.randomBytes(24).toString('base64url');
  sendStateCookie(res, state);

  const url = new URL(GOOGLE_AUTH);
  url.searchParams.set('client_id', clientId());
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  res.redirect(url.toString());
});

router.get('/google/callback', wrap(async (req, res) => {
  const fail = why => res.redirect('/#entrar?erro=' + encodeURIComponent(why));

  if (!configured()) return fail('A entrada pelo Google não está configurada.');

  const { code, state, error } = req.query;
  if (error) return res.redirect('/#entrar');

  const expected = readCookie(req, STATE_COOKIE);
  sendStateCookie(res, '');
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
  res.redirect('/');
}));

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

router.post('/register', throttleRegister, wrap(async (req, res) => {
  const { name, email, password } = req.body || {};
  const out = await auth.register({ name, email, password });
  if (out.error) {
    return res.status(out.error.includes('Já existe') ? 409 : 400).json({ error: out.error });
  }
  const token = await auth.createSession(out.reviewer.id);
  auth.sendSessionCookie(res, token);

  if (out.reviewer.email) await sendVerification(out.reviewer);

  res.status(201).json({ reviewer: publicReviewer(out.reviewer) });
}));

async function sendVerification(reviewer) {
  const token = await auth.createEmailToken(reviewer.id, 'verify', reviewer.email);
  const { subject, text } = mail.verifyMail(
    reviewer.name,
    `${mail.baseUrl()}/#confirmar/${token}`
  );
  return mail.send({ to: reviewer.email, toName: reviewer.name, subject, text });
}

router.post('/verify/send', auth.requireSession, throttleVerifySend, wrap(async (req, res) => {
  const reviewer = await getReviewer.get(req.session.reviewer_id);
  if (!reviewer?.email) return res.status(400).json({ error: 'Sua conta não tem e-mail.' });
  if (reviewer.email_verified) return res.json({ ok: true, already: true });

  const out = await sendVerification(reviewer);
  res.json({ ok: true, sent: out.sent });
}));

router.post('/verify', throttleTokenTry, wrap(async (req, res) => {
  const quem = await auth.useEmailToken(req.body?.token, 'verify');
  if (!quem) {
    return res.status(400).json({ error: 'Este link não vale mais. Peça outro.' });
  }
  await auth.markVerified(quem.id);
  res.json({ ok: true, name: quem.name });
}));

router.post('/reset/request', throttleResetByIp, wrap(async (req, res) => {
  const reviewer = await auth.accountByEmail(req.body?.email);

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
        const token = await auth.createEmailToken(reviewer.id, 'verify', reviewer.email);
        const { subject, text } = mail.verifyFirstMail(
          reviewer.name,
          `${mail.baseUrl()}/#confirmar/${token}`
        );
        await mail.send({ to: reviewer.email, toName: reviewer.name, subject, text });
      }
    }
  }

  res.json({ ok: true });
}));

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
  await auth.destroyAllSessions(quem.id);

  const reviewer = await getReviewer.get(quem.id);
  const nova = await auth.createSession(quem.id);
  auth.sendSessionCookie(res, nova);
  res.json({ reviewer: publicReviewer(reviewer) });
}));

router.post('/token', throttleLogin, wrap(async (req, res) => {
  const { email, password, handoff } = req.body || {};

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

router.get('/scheme', (req, res) => res.json({ scheme: APP_SCHEME }));

router.post('/ticket', auth.requireSession, wrap(async (req, res) => {
  res.json({ ticket: await auth.createTicket(req.session.reviewer_id, 'stream') });
}));

router.post('/refresh', throttleLogin, wrap(async (req, res) => {
  const par = await auth.rotateRefresh(req.body?.refresh);
  if (!par) return res.status(401).json({ error: 'Entre de novo.' });
  res.json(par);
}));

router.post('/logout', wrap(async (req, res) => {
  await auth.destroySession(req.sessionToken);
  const family = await auth.familyOf(req.body?.refresh);
  if (family) await auth.destroyRefreshFamily(family);
  auth.clearSessionCookie(res);
  res.status(204).end();
}));

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

  if (!reviewer.email) {
    return res.status(409).json({
      error: 'Esta conta não tem e-mail. Entre pelo Google uma vez para vincular um.',
    });
  }

  await auth.setPassword(reviewer.id, password);
  await auth.destroyAllSessions(reviewer.id);
  const token = await auth.createSession(reviewer.id);
  auth.sendSessionCookie(res, token);
  res.json({ ok: true });
}));

module.exports = router;
