const express = require('express');
const crypto = require('node:crypto');
const db = require('../lib/db');
const auth = require('../lib/auth');
const wrap = require('../lib/wrap');
const { handlesFor } = require('../lib/handles');
const clubs = require('../lib/clubs');
const live = require('../lib/live');
const { readDataUrl } = require('../lib/image');
const throttle = require('../lib/throttle');

const throttleProfile = throttle.limit({
  name: 'profile',
  max: 20,
  windowMs: 60 * 60_000,
  message: espera => `Muitas mudanças seguidas no perfil. Tente de novo em ${espera}.`,
});

const router = express.Router();
const scoped = express.Router({ mergeParams: true });

const listStmt = db.prepare(`  SELECT r.id, r.name, r.dot, r.is_admin, r.avatar_rev, r.bio, r.created_at,
         m.role, m.joined_at,
         (r.password_hash IS NOT NULL) AS has_password,
         COUNT(rv.id) AS review_count
  FROM club_members m
  JOIN reviewers r ON r.id = m.reviewer_id

  LEFT JOIN reviews rv ON rv.reviewer_id = r.id
  WHERE m.club_id = ?
  GROUP BY r.id
  ORDER BY m.joined_at ASC
`);
const deleteStmt = db.prepare('DELETE FROM reviewers WHERE id = ?');
const getStmt = db.prepare('SELECT id, name, is_admin FROM reviewers WHERE id = ?');
const renameStmt = db.prepare('UPDATE reviewers SET name = ? WHERE id = ?');
const avatarStmt = db.prepare('SELECT avatar, avatar_mime FROM reviewers WHERE id = ?');
const setAvatarStmt = db.prepare(
  'UPDATE reviewers SET avatar = ?, avatar_mime = ?, avatar_rev = ? WHERE id = ?'
);
const setBioStmt = db.prepare('UPDATE reviewers SET bio = ? WHERE id = ?');

const MAX_BIO = 140;

const avatarUrl = row => (row.avatar_rev ? `/api/reviewers/${row.id}/avatar?v=${row.avatar_rev}` : null);

function toDTO(row, handles) {
  return {
    id: row.id,
    name: row.name,
    dot: row.dot,
    handle: handles?.[row.id] ?? null,
    isAdmin: !!row.is_admin,
    role: row.role ?? null,
    hasPassword: !!row.has_password,
    avatar: avatarUrl(row),
    bio: row.bio || null,
    createdAt: row.created_at ?? null,
    joinedAt: row.joined_at ?? null,
    review_count: row.review_count ?? 0,
  };
}

scoped.get('/', clubs.requireReadable, wrap(async (req, res) => {
  const rows = await listStmt.all(req.club.id);
  const handles = handlesFor(rows);
  res.json({ reviewers: rows.map(r => toDTO(r, handles)) });
}));

router.patch('/me', auth.requireSession, throttleProfile, wrap(async (req, res) => {
  const id = req.session.reviewer_id;
  const patch = req.body || {};

  if ('name' in patch) {
    const name = String(patch.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'O nome não pode ficar vazio.' });
    if (name.length > 40) return res.status(400).json({ error: 'O nome pode ter no máximo 40 caracteres.' });
    await renameStmt.run(name, id);
  }

  if ('avatar' in patch) {
    if (patch.avatar === null) {
      await setAvatarStmt.run(null, null, null, id);
    } else {
      const read = readDataUrl(patch.avatar);
      if (read.error) return res.status(400).json({ error: read.error });
      await setAvatarStmt.run(read.data, read.mime, crypto.randomBytes(6).toString('hex'), id);
    }
  }

  if ('bio' in patch) {
    const bio = patch.bio == null ? '' : String(patch.bio).trim();
    if (bio.length > MAX_BIO) {
      return res.status(400).json({ error: `A bio pode ter no máximo ${MAX_BIO} caracteres.` });
    }
    await setBioStmt.run(bio || null, id);
  }

  for (const c of await clubs.mineStmt.all(id)) live.emit('reviewers', id, c.id);

  const row = await db
    .prepare('SELECT id, name, dot, is_admin, avatar_rev, bio FROM reviewers WHERE id = ?')
    .get(id);
  res.json({
    reviewer: {
      id: row.id,
      name: row.name,
      dot: row.dot,
      isAdmin: !!row.is_admin,
      avatar: avatarUrl(row),
      bio: row.bio || null,
    },
  });
}));

router.get('/:id/avatar', wrap(async (req, res) => {
  const row = await avatarStmt.get(req.params.id);
  if (!row?.avatar) return res.status(404).end();
  const buf = Buffer.from(row.avatar, 'base64');
  res.set('Content-Type', row.avatar_mime || 'image/webp');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(buf);
}));

router.delete('/:id', auth.requireAdmin, wrap(async (req, res) => {
  const target = await getStmt.get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Conta não encontrada.' });
  if (target.is_admin) {
    return res.status(403).json({ error: 'O administrador não pode ser removido.' });
  }

  const was = await clubs.mineStmt.all(target.id);

  await auth.destroyAllSessions(target.id);
  await deleteStmt.run(target.id);
  for (const c of was) {
    live.emit('reviewers', req.session.reviewer_id, c.id);
    live.emit('reviews', req.session.reviewer_id, c.id);
    live.emit('social', req.session.reviewer_id, c.id);
  }
  res.status(204).end();
}));

module.exports = { index: router, scoped };
