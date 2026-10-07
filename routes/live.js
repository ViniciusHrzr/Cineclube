const express = require('express');
const auth = require('../lib/auth');
const clubs = require('../lib/clubs');
const live = require('../lib/live');

const router = express.Router({ mergeParams: true });

router.get('/stream', auth.requireSession, clubs.requireMember, (req, res) => {
  if (!live.canSubscribe(req.session.reviewer_id)) {
    return res.status(429).json({ error: 'Conexões demais. Feche outras abas do Cineclube.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  req.socket.setTimeout(0);
  req.socket.setNoDelay?.(true);

  live.startTimers();
  const entry = live.subscribe(res, req.session.reviewer_id, req.club.id);

  let gone = false;
  const leave = () => {
    if (gone) return;
    gone = true;
    live.unsubscribe(entry);
  };
  req.on('close', leave);
  res.on('close', leave);
});

module.exports = router;
