const crypto = require('node:crypto');
const db = require('./db');
const auth = require('./auth');

let seq = 0;

async function signIn(name) {
  const who = name || `Sócio ${++seq}`;
  const { reviewer } = await auth.accountForGoogle({
    sub: 'g-' + crypto.randomUUID(),
    email: `p${++seq}-${crypto.randomUUID().slice(0, 8)}@exemplo.com`,
    name: who,
    verified: true,
  });
  const token = await auth.createSession(reviewer.id);
  return { ...reviewer, cookie: `cc_session=${token}` };
}

async function signInAdmin(name) {
  const p = await signIn(name || `Chefe ${++seq}`);
  await db.prepare('UPDATE reviewers SET is_admin = 1 WHERE id = ?').run(p.id);
  return { ...p, is_admin: 1 };
}

async function makeClub({ name, owner, visibility = 'private' } = {}) {
  const label = name || `Clube ${++seq}`;
  const id = 'c' + crypto.randomUUID();
  const slug = await db.freeSlug(label);
  await db
    .prepare('INSERT INTO clubs (id, name, slug, visibility, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(id, label, slug, visibility, owner || null);
  if (owner) await join(id, owner, 'admin');
  return { id, name: label, slug, visibility };
}

async function join(clubId, reviewerId, role = 'member') {
  await db
    .prepare(
      `INSERT INTO club_members (club_id, reviewer_id, role) VALUES (?, ?, ?)
       ON CONFLICT (club_id, reviewer_id) DO UPDATE SET role = excluded.role`
    )
    .run(clubId, reviewerId, role);
}

const pathIn = club => p => `/api/c/${club.slug}${p}`;

module.exports = { signIn, signInAdmin, makeClub, join, pathIn };
