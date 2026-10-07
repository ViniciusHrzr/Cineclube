const express = require('express');
const auth = require('../auth');
const clubs = require('../clubs');
const notices = require('../notices');
const wrap = require('../wrap');

const router = express.Router();

const MAX_CLUBS = 20;

router.get('/', auth.requireSession, wrap(async (req, res) => {
  const me = req.session.reviewer_id;
  const minhas = (await clubs.mineStmt.all(me)).slice(0, MAX_CLUBS);

  const porSala = await Promise.all(
    minhas.map(async sala => {
      const manda = sala.role === 'admin' || !!req.session.is_admin;
      const out = await notices.forClub({ clubId: sala.id, me, manda });
      return { sala, ...out };
    })
  );

  const items = [];
  let unread = 0;
  const estreias = new Set();
  for (const { sala, items: doClube, seenAt } of porSala) {
    for (const item of doClube) {
      if (item.kind === 'airing') {
        if (estreias.has(item.id)) continue;
        estreias.add(item.id);
      }
      if (!seenAt || String(item.at) > seenAt) unread += 1;
      items.push({
        ...item,
        id: `${sala.id}|${item.id}`,
        club: { name: sala.name, slug: sala.slug },
      });
    }
  }

  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const account = { verifyEmail: !!req.session.email && !req.session.email_verified };

  res.json({
    items: items.slice(0, notices.LIMIT),
    unread: unread + (account.verifyEmail ? 1 : 0),
    account,
    clubs: minhas.length,
  });
}));

router.post('/clear', auth.requireSession, wrap(async (req, res) => {
  const me = req.session.reviewer_id;
  const minhas = await clubs.mineStmt.all(me);
  await Promise.all(minhas.map(sala => notices.markCleared(sala.id, me)));
  res.json({ ok: true });
}));

router.post('/seen', auth.requireSession, wrap(async (req, res) => {
  const me = req.session.reviewer_id;
  const minhas = await clubs.mineStmt.all(me);
  await Promise.all(minhas.map(sala => notices.markSeen(sala.id, me)));
  res.json({ ok: true });
}));

module.exports = router;
