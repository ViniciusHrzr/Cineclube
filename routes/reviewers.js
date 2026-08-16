const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const auth = require('../auth');

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
const getStmt = db.prepare('SELECT id, name FROM reviewers WHERE id = ?');

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

router.get('/', (req, res) => {
  res.json({ reviewers: listStmt.all().map(toDTO) });
});

/* Joining the club. Open by design — this is a room of friends, not a service
   with a signup funnel — but a profile without a PIN is a profile anyone can
   wear, so the PIN is required at creation. */
router.post('/', (req, res) => {
  const name = (req.body?.name || '').trim();
  const pin = req.body?.pin;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });
  if (!auth.isValidPin(pin)) {
    return res.status(400).json({ error: 'O PIN precisa ter exatamente 4 dígitos.' });
  }

  const id = 'p' + crypto.randomUUID();
  const n = countStmt.get().n;
  const dot = DOTS[n % DOTS.length];
  insertStmt.run(id, name, dot);
  auth.setPin(id, pin);

  res.status(201).json({ id, name, dot, isAdmin: false, hasPin: true, review_count: 0 });
});

/* Leaving, or being removed. You may delete yourself; the admin may delete
   anyone. Reviews go with the account (ON DELETE CASCADE), which is why the
   confirmation in the client spells out how many. */
router.delete('/:id', auth.requireSession, (req, res) => {
  const target = getStmt.get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Avaliador não encontrado.' });

  const isSelf = req.session.reviewer_id === target.id;
  if (!isSelf && !req.session.is_admin) {
    return res.status(403).json({ error: 'Só o administrador do clube pode remover outro avaliador.' });
  }

  auth.destroyAllSessions(target.id);
  deleteStmt.run(target.id);
  if (isSelf) auth.clearSessionCookie(res);
  res.status(204).end();
});

module.exports = router;
