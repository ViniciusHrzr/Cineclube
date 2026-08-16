const express = require('express');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();

const getReviewer = db.prepare('SELECT * FROM reviewers WHERE id = ?');

/** Never leak the hash, the salt, or the lock bookkeeping. */
function publicReviewer(r) {
  return { id: r.id, name: r.name, dot: r.dot, isAdmin: !!r.is_admin };
}

/* Who am I? The client asks this on boot to decide between the sign-in screen
   and the app. A missing or expired session is a normal answer, not an error. */
router.get('/me', (req, res) => {
  if (!req.session) return res.json({ reviewer: null });
  res.json({
    reviewer: {
      id: req.session.reviewer_id,
      name: req.session.name,
      dot: req.session.dot,
      isAdmin: !!req.session.is_admin,
    },
  });
});

router.post('/login', (req, res) => {
  const { reviewerId, pin } = req.body || {};
  const reviewer = reviewerId && getReviewer.get(reviewerId);

  // One shape of failure for a wrong PIN and for a reviewer that does not
  // exist, so the endpoint cannot be used to enumerate the club.
  if (!reviewer || !auth.isValidPin(pin)) {
    return res.status(401).json({ error: 'PIN incorreto.' });
  }

  const result = auth.checkPin(reviewer, pin);
  if (result === 'locked') {
    const left = auth.lockedSecondsLeft(getReviewer.get(reviewerId));
    return res.status(429).json({ error: `Muitas tentativas. Tente de novo em ${left}s.`, retryAfter: left });
  }
  if (result === 'unset') {
    return res.status(409).json({ error: 'Este avaliador ainda não tem PIN. Peça ao administrador para definir um.' });
  }
  if (result !== 'ok') {
    const after = getReviewer.get(reviewerId);
    const left = auth.lockedSecondsLeft(after);
    if (left > 0) {
      return res.status(429).json({ error: `Muitas tentativas. Tente de novo em ${left}s.`, retryAfter: left });
    }
    return res.status(401).json({ error: 'PIN incorreto.' });
  }

  const token = auth.createSession(reviewer.id);
  auth.sendSessionCookie(res, token);
  res.json({ reviewer: publicReviewer(reviewer) });
});

router.post('/logout', (req, res) => {
  auth.destroySession(req.sessionToken);
  auth.clearSessionCookie(res);
  res.status(204).end();
});

/* Change your own PIN. The current one is required, so someone who walks up to
   an unlocked browser still cannot lock the owner out of their own account. */
router.post('/pin', auth.requireSession, (req, res) => {
  const { currentPin, newPin } = req.body || {};
  if (!auth.isValidPin(newPin)) {
    return res.status(400).json({ error: 'O novo PIN precisa ter exatamente 4 dígitos.' });
  }
  const reviewer = getReviewer.get(req.session.reviewer_id);
  if (!reviewer) return res.status(404).json({ error: 'Avaliador não encontrado.' });

  if (reviewer.pin_hash) {
    if (!auth.isValidPin(currentPin)) return res.status(401).json({ error: 'PIN atual incorreto.' });
    const result = auth.checkPin(reviewer, currentPin);
    if (result === 'locked') {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde antes de tentar de novo.' });
    }
    if (result !== 'ok') return res.status(401).json({ error: 'PIN atual incorreto.' });
  }

  auth.setPin(reviewer.id, newPin);
  // Every other browser holding this account is signed out; this one stays.
  auth.destroyAllSessions(reviewer.id);
  const token = auth.createSession(reviewer.id);
  auth.sendSessionCookie(res, token);
  res.json({ ok: true });
});

/* The admin resets someone else's PIN — the way back in when a member forgets
   theirs. It cannot read the old PIN, because nothing can. */
router.post('/pin/reset', auth.requireAdmin, (req, res) => {
  const { reviewerId, newPin } = req.body || {};
  if (!auth.isValidPin(newPin)) {
    return res.status(400).json({ error: 'O novo PIN precisa ter exatamente 4 dígitos.' });
  }
  const target = reviewerId && getReviewer.get(reviewerId);
  if (!target) return res.status(404).json({ error: 'Avaliador não encontrado.' });

  auth.setPin(target.id, newPin);
  auth.destroyAllSessions(target.id); // any live session of theirs ends here
  res.json({ ok: true, reviewer: publicReviewer(target) });
});

module.exports = router;
