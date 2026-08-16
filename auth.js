const crypto = require('node:crypto');
const db = require('./db');

/* ══════════════════════════════════════════════════════════════════════════
   PIN sign-in.

   The club watches together on Discord, each member in their own browser, so
   a reviewer is an account and the PIN is its credential. Three rules hold
   this file together:

   1. The PIN is never stored, logged, or returned. Only a scrypt hash and a
      per-account salt go into the database.
   2. Four digits is 10 000 guesses. Failures are counted and the account locks
      for a growing pause, so an online guessing run stops being practical.
   3. The session cookie carries a random token; the database stores only its
      SHA-256. Reading the table does not let anyone impersonate a member.

   Everything that touches the database is async — see db.js.
   ══════════════════════════════════════════════════════════════════════════ */

const SESSION_COOKIE = 'cc_session';
const SESSION_HOURS = 24;
const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 60; // multiplied by how far past the limit the account is

const PIN_RE = /^\d{4}$/;

function isValidPin(pin) {
  return typeof pin === 'string' && PIN_RE.test(pin);
}

function hashPin(pin, salt) {
  return crypto.scryptSync(pin, salt, 64).toString('hex');
}

function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}

async function setPin(reviewerId, pin) {
  const salt = makeSalt();
  await db.prepare(
    'UPDATE reviewers SET pin_hash = ?, pin_salt = ?, pin_attempts = 0, locked_until = NULL WHERE id = ?'
  ).run(hashPin(pin, salt), salt, reviewerId);
}

/** Constant-time check. Returns one of: 'ok' | 'bad' | 'unset' | 'locked'. */
async function checkPin(reviewer, pin) {
  if (!reviewer.pin_hash || !reviewer.pin_salt) return 'unset';
  if (reviewer.locked_until) {
    const row = await db
      .prepare("SELECT datetime('now') < ? AS locked")
      .get(reviewer.locked_until);
    if (row.locked) return 'locked';
  }
  const expected = Buffer.from(reviewer.pin_hash, 'hex');
  const actual = Buffer.from(hashPin(pin, reviewer.pin_salt), 'hex');
  const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (ok) {
    await db.prepare('UPDATE reviewers SET pin_attempts = 0, locked_until = NULL WHERE id = ?').run(reviewer.id);
    return 'ok';
  }

  const attempts = (reviewer.pin_attempts || 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    const pause = LOCK_SECONDS * (attempts - MAX_ATTEMPTS + 1);
    await db.prepare(
      `UPDATE reviewers SET pin_attempts = ?, locked_until = datetime('now', '+' || ? || ' seconds') WHERE id = ?`
    ).run(attempts, pause, reviewer.id);
  } else {
    await db.prepare('UPDATE reviewers SET pin_attempts = ? WHERE id = ?').run(attempts, reviewer.id);
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

/* ── sessions ─────────────────────────────────────────────────────────── */

const sha = t => crypto.createHash('sha256').update(t).digest('hex');

async function createSession(reviewerId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.prepare(
    `INSERT INTO sessions (token_hash, reviewer_id, expires_at)
     VALUES (?, ?, datetime('now', '+${SESSION_HOURS} hours'))`
  ).run(sha(token), reviewerId);
  return token;
}

async function readSession(token) {
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT s.reviewer_id, r.name, r.dot, r.is_admin
       FROM sessions s JOIN reviewers r ON r.id = s.reviewer_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')`
    )
    .get(sha(token));
  return row || null;
}

async function destroySession(token) {
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

async function destroyAllSessions(reviewerId) {
  await db.prepare('DELETE FROM sessions WHERE reviewer_id = ?').run(reviewerId);
}

/* ── cookie plumbing ──────────────────────────────────────────────────────
   Express 4 ships no cookie parser and this needs exactly one cookie, so
   pulling a dependency in for it would be the expensive way to read a string. */

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
  // `secure` only behind TLS: in development this runs over plain http, and a
  // Secure cookie there would simply never be sent back.
  const secure = process.env.CINECLUBE_HTTPS === '1' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

/* ── middleware ───────────────────────────────────────────────────────── */

/** Attaches req.session when a valid cookie is present. Never rejects. */
async function attachSession(req, _res, next) {
  try {
    req.sessionToken = readCookie(req, SESSION_COOKIE);
    req.session = await readSession(req.sessionToken);
    next();
  } catch (e) {
    // A database failure here is a server error, not a signed-out visitor.
    next(e);
  }
}

function requireSession(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'Entre com seu PIN para continuar.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'Entre com seu PIN para continuar.' });
  if (!req.session.is_admin) return res.status(403).json({ error: 'Só o administrador do clube pode fazer isso.' });
  next();
}

module.exports = {
  SESSION_COOKIE,
  SESSION_HOURS,
  MAX_ATTEMPTS,
  isValidPin,
  setPin,
  checkPin,
  lockedSecondsLeft,
  createSession,
  readSession,
  destroySession,
  destroyAllSessions,
  sendSessionCookie,
  clearSessionCookie,
  attachSession,
  requireSession,
  requireAdmin,
};
