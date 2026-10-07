const express = require('express');
const auth = require('../auth');
const clubs = require('../clubs');
const notices = require('../notices');
const wrap = require('../wrap');

const router = express.Router({ mergeParams: true });

router.get('/', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  const me = req.session.reviewer_id;
  const manda = req.club.isClubAdmin || !!req.session.is_admin;

  const { items, seenAt, clearedAt } = await notices.forClub({
    clubId: req.club.id,
    me,
    manda,
  });

  res.json({ items, unread: notices.unreadIn(items, seenAt), seenAt, clearedAt });
}));

router.post('/clear', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  await notices.markCleared(req.club.id, req.session.reviewer_id);
  const row = await notices.marksFor(req.club.id, req.session.reviewer_id);
  res.json({
    seenAt: row?.notifications_seen_at || null,
    clearedAt: row?.notifications_cleared_at || null,
  });
}));

router.post('/seen', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  await notices.markSeen(req.club.id, req.session.reviewer_id);
  const row = await notices.marksFor(req.club.id, req.session.reviewer_id);
  res.json({ seenAt: row?.notifications_seen_at || null });
}));

module.exports = router;
