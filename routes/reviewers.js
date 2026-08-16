const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const auth = require('../auth');
const wrap = require('../wrap');

const router = express.Router();

const DOTS = ['#b5abfc', '#cfd3e5', '#a7a1db', '#b2b6ca', '#d2cefd', '#9397ab'];

// The sign-in screen needs this list before anyone is signed in, so it stays
// readable without a session — but it exposes only what a profile picker needs.
// `pin_hash` and `pin_salt` are never selected here, on purpose.
const listStmt = db.prepare(`
  SELECT r.id, r.name, r.dot, r.is_admin,
         (r.pin_hash IS NOT NULL) AS has_pin,
         COUNT(rv.id) AS review_count
  FROM reviewers r
  LEFT JOIN reviews rv ON rv.reviewer_id = r.id
  GROUP BY r.id
  ORDER BY r.created_at ASC
`);
const countStmt = db.prepare('SELECT COUNT(*) AS n FROM reviewers');
const insertStmt = db.prepare('INSERT INTO reviewers (id, name, dot) VALUES (?, ?, ?)');
const deleteStmt = db.prepare('DELETE FROM reviewers WHERE id = ?');
const getStmt = db.prepare('SELECT id, name, is_admin FROM reviewers WHERE id = ?');

function toDTO(row) {
  return {
    id: row.id,
    name: row.name,
    dot: row.dot,
    isAdmin: !!row.is_admin,
    hasPin: !!row.has_pin,
    review_count: row.review_count ?? 0,
  };
}

router.get('/', wrap(async (req, res) => {
  const rows = await listStmt.all();
  res.json({ reviewers: rows.map(toDTO) });
}));

/* Joining the club. Open by design — this is a room of friends, not a service
   with a signup funnel — but a profile without a PIN is a profile anyone can
   wear, so the PIN is required at creation. */
router.post('/', wrap(async (req, res) => {
  const name = (req.body?.name || '').trim();
  const pin = req.body?.pin;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });
  if (!auth.isValidPin(pin)) {
    return res.status(400).json({ error: 'O PIN precisa ter exatamente 4 dígitos.' });
  }

  const id = 'p' + crypto.randomUUID();
  const { n } = await countStmt.get();
  const dot = DOTS[n % DOTS.length];
  await insertStmt.run(id, name, dot);
  await auth.setPin(id, pin);

  res.status(201).json({ id, name, dot, isAdmin: false, hasPin: true, review_count: 0 });
}));

/* Being removed. Only the admin removes anyone, and the admin is not removable
   — not even by themselves.

   Deleting used to be allowed on your own account, which is friendlier and is
   also how the club could lose its only administrator with one click: the seat
   is held by a flag on a row, so deleting that row leaves nobody able to reset
   a PIN or remove anyone, and no route grants the flag back. The rule is
   enforced here rather than by hiding a button, because a button is not a
   permission — anyone can call the route directly.

   Reviews go with the account (ON DELETE CASCADE), which is why the
   confirmation in the client spells out how many. */
router.delete('/:id', auth.requireSession, wrap(async (req, res) => {
  const target = await getStmt.get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Avaliador não encontrado.' });

  if (!req.session.is_admin) {
    return res.status(403).json({ error: 'Só o administrador do clube pode remover um avaliador.' });
  }
  if (target.is_admin) {
    return res.status(403).json({ error: 'O administrador do clube não pode ser removido.' });
  }

  await auth.destroyAllSessions(target.id);
  await deleteStmt.run(target.id);
  res.status(204).end();
}));

module.exports = router;
