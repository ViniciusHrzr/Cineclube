const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');

const router = express.Router();

const DOTS = ['#b5abfc', '#cfd3e5', '#a7a1db', '#b2b6ca', '#d2cefd', '#9397ab'];

const listStmt = db.prepare(`
  SELECT r.id, r.name, r.dot, COUNT(rv.id) AS review_count
  FROM reviewers r
  LEFT JOIN reviews rv ON rv.reviewer_id = r.id
  GROUP BY r.id
  ORDER BY r.created_at ASC
`);
const countStmt = db.prepare('SELECT COUNT(*) AS n FROM reviewers');
const insertStmt = db.prepare('INSERT INTO reviewers (id, name, dot) VALUES (?, ?, ?)');
const deleteStmt = db.prepare('DELETE FROM reviewers WHERE id = ?');
const getStmt = db.prepare('SELECT id FROM reviewers WHERE id = ?');

router.get('/', (req, res) => {
  res.json({ reviewers: listStmt.all() });
});

router.post('/', (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });
  const id = 'p' + crypto.randomUUID();
  const n = countStmt.get().n;
  const dot = DOTS[n % DOTS.length];
  insertStmt.run(id, name, dot);
  res.status(201).json({ id, name, dot, review_count: 0 });
});

router.delete('/:id', (req, res) => {
  const existing = getStmt.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Avaliador não encontrado.' });
  deleteStmt.run(req.params.id);
  res.status(204).end();
});

module.exports = router;
