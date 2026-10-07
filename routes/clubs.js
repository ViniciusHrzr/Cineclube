const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const clubs = require('../clubs');
const throttle = require('../throttle');
const live = require('../live');
const wrap = require('../wrap');
const { readDataUrl } = require('../image');

const index = express.Router();
const scoped = express.Router({ mergeParams: true });

const throttleFound = throttle.limit({
  name: 'club:create',
  max: 5,
  windowMs: 24 * 60 * 60_000,
  message: espera => `Muitos clubes fundados hoje. Tente de novo em ${espera}.`,
});

const throttleClubEdit = throttle.limit({
  name: 'club:edit',
  max: 20,
  windowMs: 60 * 60_000,
  message: espera => `Muitas mudanças seguidas na sala. Tente de novo em ${espera}.`,
});

const MAX_NAME = 40;
const MAX_TAGLINE = 140;

const photoUrl = c => (c.photo_rev ? `/api/c/${c.slug}/photo?v=${c.photo_rev}` : null);

function toDTO(row, extra = {}) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    tagline: row.tagline || null,
    visibility: row.visibility,
    showReviews: !!row.show_reviews,
    showComments: !!row.show_comments,
    photo: photoUrl(row),
    createdAt: row.created_at ?? null,
    ...extra,
  };
}

index.get('/', wrap(async (req, res) => {
  const me = req.session?.reviewer_id || null;

  const mine = me ? await clubs.mineStmt.all(me) : [];
  const held = new Set(mine.map(c => c.id));

  const open = await db.prepare(`
    SELECT c.*, COUNT(m.reviewer_id) AS members
    FROM clubs c
    LEFT JOIN club_members m ON m.club_id = c.id
    GROUP BY c.id
    ORDER BY c.created_at ASC
  `).all();

  const asked = me
    ? (await db.prepare('SELECT club_id FROM club_join_requests WHERE reviewer_id = ?').all(me))
        .map(r => r.club_id)
    : [];
  const pending = new Set(asked);

  const founded = me && !req.session?.is_admin
    ? Number(
        (await db.prepare('SELECT COUNT(*) AS n FROM clubs WHERE created_by = ?').get(me))?.n
      ) > 0
    : false;

  res.json({
    founded,
    mine: mine.map(c =>
      toDTO(c, { role: c.role, isMember: true, members: Number(c.members) || 0 })
    ),
    open: open
      .filter(c => !held.has(c.id))
      .map(c => toDTO(c, { members: Number(c.members) || 0, requested: pending.has(c.id) })),
  });
}));

index.post('/', auth.requireSession, throttleFound, wrap(async (req, res) => {
  if (req.session.email && !req.session.email_verified) {
    return res.status(403).json({
      error: 'Confirme seu e-mail para fundar um clube. O link está na sua caixa de entrada.',
      needsVerifiedEmail: true,
    });
  }

  if (!req.session.is_admin) {
    const founded = await db.prepare('SELECT COUNT(*) AS n FROM clubs WHERE created_by = ?')
      .get(req.session.reviewer_id);
    if (Number(founded?.n) > 0) {
      return res.status(403).json({
        error: 'Você já tem um clube. Cada pessoa funda um — entre nos outros pela vitrine.',
        alreadyFounded: true,
      });
    }
  }

  const name = String(req.body?.name || '').trim();
  const tagline = String(req.body?.tagline || '').trim();
  const visibility = req.body?.visibility === 'private' ? 'private' : 'public';

  if (!name) return res.status(400).json({ error: 'O clube precisa de um nome.' });
  if (name.length > MAX_NAME) {
    return res.status(400).json({ error: `O nome pode ter no máximo ${MAX_NAME} caracteres.` });
  }
  if (tagline.length > MAX_TAGLINE) {
    return res.status(400).json({ error: `A descrição pode ter no máximo ${MAX_TAGLINE} caracteres.` });
  }

  const taken = await db.prepare('SELECT id FROM clubs WHERE name = ? COLLATE NOCASE').get(name);
  if (taken) return res.status(409).json({ error: 'Já existe um clube com esse nome.' });

  let photo = null;
  if (req.body?.photo) {
    photo = readDataUrl(req.body.photo);
    if (photo.error) return res.status(400).json({ error: photo.error });
  }

  const id = 'c' + crypto.randomUUID();
  const slug = await db.freeSlug(name);
  await db.prepare(
    `INSERT INTO clubs (id, name, slug, tagline, visibility, created_by, photo, photo_mime, photo_rev)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, name, slug, tagline || null, visibility, req.session.reviewer_id,
    photo?.data ?? null, photo?.mime ?? null, photo ? crypto.randomUUID().slice(0, 8) : null
  );
  await db.prepare(
    `INSERT INTO club_members (club_id, reviewer_id, role) VALUES (?, ?, 'admin')`
  ).run(id, req.session.reviewer_id);

  const row = await db.prepare('SELECT * FROM clubs WHERE id = ?').get(id);
  res.status(201).json({ club: toDTO(row, { role: 'admin', isMember: true }) });
}));

scoped.get('/', clubs.requireVisible, wrap(async (req, res) => {
  const row = await db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.club.id);
  const { n } = await db
    .prepare('SELECT COUNT(*) AS n FROM club_members WHERE club_id = ?').get(req.club.id);
  const asked = req.session
    ? await db.prepare('SELECT 1 AS x FROM club_join_requests WHERE club_id = ? AND reviewer_id = ?')
        .get(req.club.id, req.session.reviewer_id)
    : null;

  const pending =
    req.club.isClubAdmin || req.session?.is_admin
      ? (await db
          .prepare('SELECT COUNT(*) AS n FROM club_join_requests WHERE club_id = ?')
          .get(req.club.id)).n
      : 0;

  res.json({
    club: toDTO(row, {
      members: n,
      role: req.club.role,
      isMember: req.club.isMember,
      isCreator: !!req.session && row.created_by === req.session.reviewer_id,
      requested: !!asked,
      pending: Number(pending) || 0,
    }),
  });
}));

scoped.get('/photo', clubs.requireVisible, wrap(async (req, res) => {
  const row = await db.prepare('SELECT photo, photo_mime FROM clubs WHERE id = ?').get(req.club.id);
  if (!row?.photo) return res.status(404).json({ error: 'Este clube não tem foto.' });
  res.setHeader('Content-Type', row.photo_mime || 'image/webp');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.end(Buffer.from(row.photo, 'base64'));
}));

scoped.patch('/', clubs.requireClubAdmin, throttleClubEdit, wrap(async (req, res) => {
  const patch = req.body || {};

  if ('name' in patch) {
    const name = String(patch.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'O nome não pode ficar vazio.' });
    if (name.length > MAX_NAME) {
      return res.status(400).json({ error: `O nome pode ter no máximo ${MAX_NAME} caracteres.` });
    }
    const taken = await db
      .prepare('SELECT id FROM clubs WHERE name = ? COLLATE NOCASE AND id <> ?')
      .get(name, req.club.id);
    if (taken) return res.status(409).json({ error: 'Já existe um clube com esse nome.' });
    const slug = await db.freeSlug(name, req.club.id);
    await db.prepare('UPDATE clubs SET name = ?, slug = ? WHERE id = ?').run(name, slug, req.club.id);
  }

  if ('tagline' in patch) {
    const line = String(patch.tagline ?? '').trim();
    if (line.length > MAX_TAGLINE) {
      return res.status(400).json({ error: `A descrição pode ter no máximo ${MAX_TAGLINE} caracteres.` });
    }
    await db.prepare('UPDATE clubs SET tagline = ? WHERE id = ?').run(line || null, req.club.id);
  }

  if ('visibility' in patch) {
    const v = patch.visibility === 'public' ? 'public' : 'private';
    await db.prepare('UPDATE clubs SET visibility = ? WHERE id = ?').run(v, req.club.id);
    if (v === 'public') {
      const esperando = await db
        .prepare('SELECT reviewer_id FROM club_join_requests WHERE club_id = ?')
        .all(req.club.id);
      if (esperando.length) {
        await db.batch(esperando.map(r => ({
          sql: 'INSERT INTO club_members (club_id, reviewer_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
          args: [req.club.id, r.reviewer_id],
        })));
        await db.prepare('DELETE FROM club_join_requests WHERE club_id = ?').run(req.club.id);
      }
    }
  }

  for (const [campo, coluna] of [
    ['showReviews', 'show_reviews'],
    ['showComments', 'show_comments'],
  ]) {
    if (campo in patch) {
      await db.prepare(`UPDATE clubs SET ${coluna} = ? WHERE id = ?`)
        .run(patch[campo] ? 1 : 0, req.club.id);
    }
  }

  if ('photo' in patch) {
    if (patch.photo === null) {
      await db.prepare('UPDATE clubs SET photo = NULL, photo_mime = NULL, photo_rev = NULL WHERE id = ?')
        .run(req.club.id);
    } else {
      const img = readDataUrl(patch.photo);
      if (img.error) return res.status(400).json({ error: img.error });
      await db.prepare('UPDATE clubs SET photo = ?, photo_mime = ?, photo_rev = ? WHERE id = ?')
        .run(img.data, img.mime, crypto.randomUUID().slice(0, 8), req.club.id);
    }
  }

  const row = await db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.club.id);
  live.emit('club', req.session.reviewer_id, req.club.id);
  res.json({
    club: toDTO(row, {
      role: req.club.role,
      isMember: true,
      isCreator: row.created_by === req.session.reviewer_id,
    }),
  });
}));

scoped.delete('/', auth.requireSession, wrap(async (req, res) => {
  const row = await db.prepare('SELECT * FROM clubs WHERE id = ?').get(req.club.id);
  if (!row.created_by || row.created_by !== req.session.reviewer_id) {
    return res.status(403).json({ error: 'Só quem fundou o clube pode encerrá-lo.' });
  }

  live.emit('club', req.session.reviewer_id, req.club.id);

  await db.prepare('DELETE FROM clubs WHERE id = ?').run(req.club.id);
  res.status(204).end();
}));

scoped.get('/members', clubs.requireReadable, wrap(async (req, res) => {
  const rows = await clubs.roster(req.club.id);
  res.json({
    members: rows.map(r => ({
      id: r.id,
      name: r.name,
      dot: r.dot,
      role: r.role,
      avatar: r.avatar_rev ? `/api/reviewers/${r.id}/avatar?v=${r.avatar_rev}` : null,
      joinedAt: r.joined_at,
    })),
  });
}));

scoped.delete('/members/:id', auth.requireSession, wrap(async (req, res) => {
  const target = req.params.id;
  const me = req.session.reviewer_id;
  const isSelf = target === me;

  if (!isSelf && !req.club.isClubAdmin && !req.session.is_admin) {
    return res.status(403).json({ error: 'Só quem administra o clube pode tirar alguém.' });
  }

  if (req.club.createdBy && target === req.club.createdBy) {
    return res.status(409).json({
      error: isSelf
        ? 'Você fundou este clube, então administra ele enquanto ele existir. Para sair de vez, encerre o clube.'
        : 'Quem fundou o clube não pode ser tirado dele.',
    });
  }

  const held = await clubs.membership.get(req.club.id, target);
  if (!held) return res.status(404).json({ error: 'Essa pessoa não está no clube.' });

  if (held.role === 'admin') {
    const { n } = await db
      .prepare(`SELECT COUNT(*) AS n FROM club_members WHERE club_id = ? AND role = 'admin'`)
      .get(req.club.id);
    if (n <= 1) {
      return res.status(409).json({
        error: isSelf
          ? 'Você é o único ADM. Promova outra pessoa antes de sair.'
          : 'Este é o único ADM do clube.',
      });
    }
  }

  await db.prepare('DELETE FROM club_members WHERE club_id = ? AND reviewer_id = ?')
    .run(req.club.id, target);
  live.emit('club', me, req.club.id);
  res.status(204).end();
}));

scoped.patch('/members/:id', clubs.requireClubAdmin, wrap(async (req, res) => {
  const role = req.body?.role === 'admin' ? 'admin' : 'member';
  const target = req.params.id;
  const held = await clubs.membership.get(req.club.id, target);
  if (!held) return res.status(404).json({ error: 'Essa pessoa não está no clube.' });

  if (req.club.createdBy && target === req.club.createdBy && role !== 'admin') {
    return res.status(409).json({ error: 'Quem fundou o clube não deixa de administrá-lo.' });
  }

  if (held.role === 'admin' && role === 'member') {
    const { n } = await db
      .prepare(`SELECT COUNT(*) AS n FROM club_members WHERE club_id = ? AND role = 'admin'`)
      .get(req.club.id);
    if (n <= 1) return res.status(409).json({ error: 'O clube ficaria sem nenhum ADM.' });
  }

  await db.prepare('UPDATE club_members SET role = ? WHERE club_id = ? AND reviewer_id = ?')
    .run(role, req.club.id, target);
  live.emit('club', req.session.reviewer_id, req.club.id);
  res.json({ ok: true, role });
}));

scoped.post('/join', auth.requireSession, wrap(async (req, res) => {
  if (req.club.isMember) return res.status(409).json({ error: 'Você já está neste clube.' });

  if (req.club.visibility === 'public') {
    await db.prepare(
      'INSERT INTO club_members (club_id, reviewer_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
    ).run(req.club.id, req.session.reviewer_id);
    await db.prepare('DELETE FROM club_join_requests WHERE club_id = ? AND reviewer_id = ?')
      .run(req.club.id, req.session.reviewer_id);
    live.emit('club', req.session.reviewer_id, req.club.id);
    return res.status(201).json({ joined: true });
  }

  await db.prepare(
    'INSERT INTO club_join_requests (club_id, reviewer_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
  ).run(req.club.id, req.session.reviewer_id);
  live.emit('club', req.session.reviewer_id, req.club.id);
  res.status(201).json({ requested: true });
}));

scoped.delete('/join', auth.requireSession, wrap(async (req, res) => {
  await db.prepare('DELETE FROM club_join_requests WHERE club_id = ? AND reviewer_id = ?')
    .run(req.club.id, req.session.reviewer_id);
  res.status(204).end();
}));

scoped.get('/requests', clubs.requireClubAdmin, wrap(async (req, res) => {
  const rows = await db.prepare(`
    SELECT r.id, r.name, r.dot, r.avatar_rev, q.created_at
    FROM club_join_requests q
    JOIN reviewers r ON r.id = q.reviewer_id
    WHERE q.club_id = ?
    ORDER BY q.created_at ASC
  `).all(req.club.id);
  res.json({
    requests: rows.map(r => ({
      id: r.id,
      name: r.name,
      dot: r.dot,
      avatar: r.avatar_rev ? `/api/reviewers/${r.id}/avatar?v=${r.avatar_rev}` : null,
      createdAt: r.created_at,
    })),
  });
}));

scoped.post('/requests/:id', clubs.requireClubAdmin, wrap(async (req, res) => {
  const target = req.params.id;
  const approve = req.body?.approve !== false;

  const asked = await db
    .prepare('SELECT 1 AS x FROM club_join_requests WHERE club_id = ? AND reviewer_id = ?')
    .get(req.club.id, target);
  if (!asked) return res.status(404).json({ error: 'Esse pedido não existe mais.' });

  if (approve) {
    await db.prepare(
      'INSERT INTO club_members (club_id, reviewer_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
    ).run(req.club.id, target);
  }
  await db.prepare('DELETE FROM club_join_requests WHERE club_id = ? AND reviewer_id = ?')
    .run(req.club.id, target);

  live.emit('club', req.session.reviewer_id, req.club.id);
  res.json({ ok: true, approved: approve });
}));

module.exports = { index, scoped };
