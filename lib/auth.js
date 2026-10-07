const crypto = require('node:crypto');
const db = require('./db');

const SESSION_COOKIE = 'cc_session';

const SESSION_DAYS = 30;
const RENEW_UNDER_DAYS = 15;

const APP_SESSION_DAYS = 1;
const REFRESH_DAYS = 90;

const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 60;

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

function isValidPassword(pw) {
  return typeof pw === 'string' && pw.length >= MIN_PASSWORD && pw.length <= MAX_PASSWORD;
}

function hashPassword(pw, salt) {
  return crypto.scryptSync(pw, salt, 64).toString('hex');
}

function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}

async function setPassword(reviewerId, pw) {
  const salt = makeSalt();
  await db.prepare(
    `UPDATE reviewers
     SET password_hash = ?, password_salt = ?, auth_attempts = 0, locked_until = NULL
     WHERE id = ?`
  ).run(hashPassword(pw, salt), salt, reviewerId);
}

async function checkPassword(reviewer, pw) {
  if (!reviewer.password_hash || !reviewer.password_salt) return 'unset';
  if (reviewer.locked_until) {
    const row = await db
      .prepare("SELECT datetime('now') < ? AS locked")
      .get(reviewer.locked_until);
    if (row.locked) return 'locked';
  }
  const expected = Buffer.from(reviewer.password_hash, 'hex');
  const actual = Buffer.from(hashPassword(pw, reviewer.password_salt), 'hex');
  const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (ok) {
    await db.prepare('UPDATE reviewers SET auth_attempts = 0, locked_until = NULL WHERE id = ?').run(reviewer.id);
    return 'ok';
  }

  const attempts = (reviewer.auth_attempts || 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    const pause = LOCK_SECONDS * (attempts - MAX_ATTEMPTS + 1);
    await db.prepare(
      `UPDATE reviewers SET auth_attempts = ?, locked_until = datetime('now', '+' || ? || ' seconds') WHERE id = ?`
    ).run(attempts, pause, reviewer.id);
  } else {
    await db.prepare('UPDATE reviewers SET auth_attempts = ? WHERE id = ?').run(attempts, reviewer.id);
  }
  return 'bad';
}

async function lockedSecondsLeft(reviewer) {
  if (!reviewer?.locked_until) return 0;
  const row = await db
    .prepare("SELECT CAST((julianday(?) - julianday('now')) * 86400 AS INTEGER) AS s")
    .get(reviewer.locked_until);
  return Math.max(0, row.s || 0);
}

const DOTS = ['#b5abfc', '#cfd3e5', '#a7a1db', '#e0b1a4', '#9fd0c0', '#d9c07a'];

async function register({ name, email, password }) {
  const mail = String(email || '').trim().toLowerCase();
  const quem = String(name || '').trim().slice(0, 60);

  if (!isValidEmail(mail)) return { error: 'E-mail inválido.' };
  if (!quem) return { error: 'Diga como você quer ser chamado.' };
  if (!isValidPassword(password)) {
    return { error: `A senha precisa ter entre ${MIN_PASSWORD} e ${MAX_PASSWORD} caracteres.` };
  }

  const taken = await db
    .prepare('SELECT id FROM reviewers WHERE email = ? COLLATE NOCASE').get(mail);
  if (taken) return { error: 'Já existe uma conta com este e-mail.' };

  const id = 'p' + crypto.randomUUID();
  const dot = DOTS[Math.floor(Math.random() * DOTS.length)];
  await db.prepare('INSERT INTO reviewers (id, name, dot, email) VALUES (?, ?, ?, ?)')
    .run(id, quem, dot, mail);
  await setPassword(id, password);
  await db.joinHomeClub(id);
  return { reviewer: await db.prepare('SELECT * FROM reviewers WHERE id = ?').get(id) };
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const isValidEmail = mail => typeof mail === 'string' && mail.length <= 200 && EMAIL_RE.test(mail);

async function accountForGoogle({ sub, email, name, verified }) {
  const byGoogle = await db.prepare('SELECT * FROM reviewers WHERE google_sub = ?').get(sub);
  if (byGoogle) return { reviewer: byGoogle, created: false };

  const adminEmail = (process.env.CINECLUBE_ADMIN_EMAIL || '').trim().toLowerCase();
  const mail = (email || '').trim().toLowerCase();

  if (mail && verified) {
    const byMail = await db
      .prepare('SELECT * FROM reviewers WHERE email = ? COLLATE NOCASE AND google_sub IS NULL')
      .get(mail);
    const heir =
      byMail ||
      (adminEmail && mail === adminEmail
        ? await db.prepare('SELECT * FROM reviewers WHERE is_admin = 1 AND google_sub IS NULL ORDER BY created_at LIMIT 1').get()
        : null);
    if (heir) {
      await db.prepare(
        `UPDATE reviewers SET google_sub = ?, email = COALESCE(email, ?), email_verified = 1
         WHERE id = ?`
      ).run(sub, mail, heir.id);
      const linked = await db.prepare('SELECT * FROM reviewers WHERE id = ?').get(heir.id);
      return { reviewer: linked, created: false };
    }
  }

  const trusted = mail && verified ? mail : null;
  const free = trusted
    ? !(await db.prepare('SELECT 1 AS x FROM reviewers WHERE email = ? COLLATE NOCASE').get(trusted))
    : false;

  const id = 'p' + crypto.randomUUID();
  const dot = DOTS[Math.floor(Math.random() * DOTS.length)];
  const verificado = free && trusted ? 1 : 0;
  await db.prepare(
    'INSERT INTO reviewers (id, name, dot, email, google_sub, email_verified) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, (name || mail || 'Alguém').slice(0, 60), dot, free ? trusted : null, sub, verificado);
  await db.joinHomeClub(id);
  const created = await db.prepare('SELECT * FROM reviewers WHERE id = ?').get(id);
  return { reviewer: created, created: true };
}

async function claimAccount(newId, oldId) {
  const nova = await db.prepare('SELECT * FROM reviewers WHERE id = ?').get(newId);
  if (!nova) return { error: 'Sessão inválida.' };

  const passos = [
    { sql: 'UPDATE reviewers SET email = NULL, google_sub = NULL WHERE id = ?', args: [newId] },
    {
      sql: `UPDATE reviewers
            SET email = ?, google_sub = ?, password_hash = ?, password_salt = ?,
                email_verified = ?, auth_attempts = 0, locked_until = NULL
            WHERE id = ?`,
      args: [
        nova.email ?? null,
        nova.google_sub ?? null,
        nova.password_hash ?? null,
        nova.password_salt ?? null,
        nova.email_verified ? 1 : 0,
        oldId,
      ],
    },
  ];

  for (const [tabela, coluna] of [
    ['club_members', 'reviewer_id'],
    ['reviews', 'reviewer_id'],
    ['review_comments', 'reviewer_id'],
    ['review_votes', 'reviewer_id'],
    ['criterion_votes', 'reviewer_id'],
    ['comment_likes', 'reviewer_id'],
  ]) {
    passos.push({
      sql: `UPDATE OR IGNORE ${tabela} SET ${coluna} = ? WHERE ${coluna} = ?`,
      args: [oldId, newId],
    });
  }
  for (const tabela of ['watchlist', 'show_queue']) {
    passos.push({
      sql: `UPDATE OR IGNORE ${tabela} SET added_by = ? WHERE added_by = ?`,
      args: [oldId, newId],
    });
    passos.push({ sql: `DELETE FROM ${tabela} WHERE added_by = ?`, args: [newId] });
  }
  passos.push({ sql: 'UPDATE clubs SET created_by = ? WHERE created_by = ?', args: [oldId, newId] });

  passos.push({ sql: 'DELETE FROM reviewers WHERE id = ?', args: [newId] });

  await db.batch(passos);
  return { reviewer: await db.prepare('SELECT * FROM reviewers WHERE id = ?').get(oldId) };
}

const sha = t => crypto.createHash('sha256').update(t).digest('hex');

async function createSession(reviewerId, kind = 'web') {
  const token = crypto.randomBytes(32).toString('base64url');
  const days = kind === 'app' ? APP_SESSION_DAYS : SESSION_DAYS;
  await db.prepare(
    `INSERT INTO sessions (token_hash, reviewer_id, kind, expires_at)
     VALUES (?, ?, ?, datetime('now', '+' || ? || ' days'))`
  ).run(sha(token), reviewerId, kind, days);
  return token;
}

async function createTokenPair(reviewerId, family = null) {
  const refresh = crypto.randomBytes(32).toString('base64url');
  const grupo = family || 'f' + crypto.randomUUID();
  await db.prepare(
    `INSERT INTO refresh_tokens (token_hash, family, reviewer_id, expires_at)
     VALUES (?, ?, ?, datetime('now', '+' || ? || ' days'))`
  ).run(sha(refresh), grupo, reviewerId, REFRESH_DAYS);

  const access = await createSession(reviewerId, 'app');
  return {
    access,
    refresh,
    expiresIn: APP_SESSION_DAYS * 86400,
  };
}

async function rotateRefresh(token) {
  if (!token || typeof token !== 'string') return null;
  const hash = sha(token);
  const row = await db.prepare(
    `SELECT family, reviewer_id, used_at, expires_at > datetime('now') AS viva
     FROM refresh_tokens WHERE token_hash = ?`
  ).get(hash);
  if (!row) return null;

  if (row.used_at) {
    await destroyRefreshFamily(row.family);
    return null;
  }

  await db.prepare("UPDATE refresh_tokens SET used_at = datetime('now') WHERE token_hash = ?").run(hash);
  if (!row.viva) return null;

  return createTokenPair(row.reviewer_id, row.family);
}

async function destroyRefreshFamily(family) {
  if (family) await db.prepare('DELETE FROM refresh_tokens WHERE family = ?').run(family);
}

const familyOf = async token =>
  token
    ? (await db.prepare('SELECT family FROM refresh_tokens WHERE token_hash = ?').get(sha(token)))
        ?.family || null
    : null;

async function readSession(token) {
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT s.reviewer_id, s.expires_at, s.kind, r.name, r.dot, r.is_admin, r.avatar_rev, r.email, r.bio,
              r.email_verified,
              (r.password_hash IS NOT NULL) AS has_password
       FROM sessions s JOIN reviewers r ON r.id = s.reviewer_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')`
    )
    .get(sha(token));
  if (!row) return null;

  if (row.kind === 'app') return row;

  const near = await db
    .prepare(`SELECT julianday(?) - julianday('now') < ? AS soon`)
    .get(row.expires_at, RENEW_UNDER_DAYS);
  if (near?.soon) {
    await db.prepare(
      `UPDATE sessions SET expires_at = datetime('now', '+${SESSION_DAYS} days') WHERE token_hash = ?`
    ).run(sha(token));
    row.renewed = true;
  }
  return row;
}

const TOKEN_HOURS = { verify: 24, reset: 1 };

async function createEmailToken(reviewerId, kind, email) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.prepare('DELETE FROM email_tokens WHERE reviewer_id = ? AND kind = ?')
    .run(reviewerId, kind);
  await db.prepare(
    `INSERT INTO email_tokens (token_hash, reviewer_id, kind, email, expires_at)
     VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' hours'))`
  ).run(sha(token), reviewerId, kind, email, TOKEN_HOURS[kind]);
  return token;
}

async function useEmailToken(token, kind) {
  if (!token || typeof token !== 'string') return null;
  const hash = sha(token);
  const row = await db.prepare(
    `SELECT t.reviewer_id, t.email, r.name, r.email AS conta_email
     FROM email_tokens t JOIN reviewers r ON r.id = t.reviewer_id
     WHERE t.token_hash = ? AND t.kind = ? AND t.expires_at > datetime('now')`
  ).get(hash, kind);

  await db.prepare('DELETE FROM email_tokens WHERE token_hash = ?').run(hash);

  if (!row) return null;
  if (!row.conta_email || row.conta_email.toLowerCase() !== String(row.email).toLowerCase()) {
    return null;
  }
  return { id: row.reviewer_id, name: row.name, email: row.conta_email };
}

async function markVerified(reviewerId) {
  await db.prepare('UPDATE reviewers SET email_verified = 1 WHERE id = ?').run(reviewerId);
}

async function accountByEmail(email) {
  const mail = String(email || '').trim().toLowerCase();
  if (!mail) return null;
  return (
    (await db.prepare('SELECT * FROM reviewers WHERE email = ? COLLATE NOCASE').get(mail)) || null
  );
}

async function destroySession(token) {
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

async function destroyAllSessions(reviewerId) {
  await db.prepare('DELETE FROM sessions WHERE reviewer_id = ?').run(reviewerId);
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

function sendSessionCookie(res, token) {
  const secure = process.env.CINECLUBE_HTTPS === '1' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

const TICKET_SECONDS = 60;

async function createTicket(reviewerId, kind = 'stream') {
  const token = crypto.randomBytes(24).toString('base64url');
  await db.prepare(
    `INSERT INTO tickets (token_hash, reviewer_id, kind, expires_at)
     VALUES (?, ?, ?, datetime('now', '+' || ? || ' seconds'))`
  ).run(sha(token), reviewerId, kind, TICKET_SECONDS);
  return token;
}

async function useTicket(token, kind = 'stream') {
  if (!token || typeof token !== 'string') return null;
  const hash = sha(token);
  const row = await db.prepare(
    `SELECT reviewer_id, expires_at > datetime('now') AS viva
     FROM tickets WHERE token_hash = ? AND kind = ?`
  ).get(hash, kind);

  await db.prepare('DELETE FROM tickets WHERE token_hash = ?').run(hash);
  if (!row?.viva) return null;

  return db.prepare(
    `SELECT r.id AS reviewer_id, r.name, r.dot, r.is_admin, r.avatar_rev, r.email, r.bio,
            r.email_verified,
            (r.password_hash IS NOT NULL) AS has_password
     FROM reviewers r WHERE r.id = ?`
  ).get(row.reviewer_id);
}

async function attachTicket(req, res, next) {
  try {
    if (!req.session && req.query?.ticket && req.path.endsWith('/stream')) {
      req.session = await useTicket(String(req.query.ticket), 'stream');
    }
    next();
  } catch (e) {
    next(e);
  }
}

function readBearer(req) {
  const raw = req.headers.authorization;
  if (!raw) return null;
  const [scheme, token] = String(raw).split(' ');
  return /^Bearer$/i.test(scheme || '') && token ? token.trim() : null;
}

async function attachSession(req, res, next) {
  try {
    const bearer = readBearer(req);
    req.sessionToken = bearer || readCookie(req, SESSION_COOKIE);
    req.sessionFromBearer = !!bearer;
    req.session = await readSession(req.sessionToken);
    if (req.session?.renewed && !bearer) sendSessionCookie(res, req.sessionToken);
    next();
  } catch (e) {
    next(e);
  }
}

const SIGN_IN = 'Entre para continuar.';

function requireSession(req, res, next) {
  if (!req.session) return res.status(401).json({ error: SIGN_IN });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session) return res.status(401).json({ error: SIGN_IN });
  if (!req.session.is_admin) return res.status(403).json({ error: 'Só o administrador pode fazer isso.' });
  next();
}

module.exports = {
  APP_SESSION_DAYS,
  MIN_PASSWORD,
  MAX_PASSWORD,
  isValidPassword,
  setPassword,
  checkPassword,
  lockedSecondsLeft,
  register,
  accountForGoogle,
  claimAccount,
  createEmailToken,
  useEmailToken,
  markVerified,
  accountByEmail,
  createSession,
  createTicket,
  useTicket,
  attachTicket,
  createTokenPair,
  rotateRefresh,
  destroyRefreshFamily,
  familyOf,
  readSession,
  destroySession,
  destroyAllSessions,
  sendSessionCookie,
  clearSessionCookie,
  attachSession,
  requireSession,
  requireAdmin,
};
