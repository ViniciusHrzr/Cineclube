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
  SELECT r.id, r.name, r.dot, r.is_admin, r.avatar_rev,
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
const renameStmt = db.prepare('UPDATE reviewers SET name = ? WHERE id = ?');
const avatarStmt = db.prepare('SELECT avatar, avatar_mime FROM reviewers WHERE id = ?');
const setAvatarStmt = db.prepare(
  'UPDATE reviewers SET avatar = ?, avatar_mime = ?, avatar_rev = ? WHERE id = ?'
);

/* The picture is a URL and not the bytes. Putting base64 in this DTO would mean
   every list of reviewers — which the sign-in screen fetches before anyone is
   even signed in — carried every portrait in the club, uncacheable, on every
   request. As a URL it is one small extra request that the browser then keeps
   forever, because `rev` changes whenever the picture does. */
const avatarUrl = row => (row.avatar_rev ? `/api/reviewers/${row.id}/avatar?v=${row.avatar_rev}` : null);

function toDTO(row) {
  return {
    id: row.id,
    name: row.name,
    dot: row.dot,
    isAdmin: !!row.is_admin,
    hasPin: !!row.has_pin,
    avatar: avatarUrl(row),
    review_count: row.review_count ?? 0,
  };
}

/* ── what an uploaded picture may be ──────────────────────────────────────
   Three formats, and a ceiling. The client already shrinks anything it is given
   to a small square, so a payload near this limit means the client was not
   involved — which is exactly the case this has to survive. */
const AVATAR_TYPES = ['image/webp', 'image/jpeg', 'image/png'];
const AVATAR_MAX_BYTES = 400 * 1024;

/** A data URL in, `{ data, mime }` or an error string out. Never throws. */
function readDataUrl(value) {
  const m = /^data:([a-z/+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ''));
  if (!m) return { error: 'Imagem inválida.' };
  const [, mime, b64] = m;
  if (!AVATAR_TYPES.includes(mime)) return { error: 'A imagem precisa ser WebP, JPEG ou PNG.' };
  // Base64 is 4 characters per 3 bytes; measuring the string avoids decoding
  // something oversized just to find out that it was oversized.
  if (Math.floor((b64.length * 3) / 4) > AVATAR_MAX_BYTES) {
    return { error: 'A imagem é grande demais.' };
  }
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return { error: 'Imagem inválida.' };
  return { data: b64, mime };
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

  res.status(201).json({ id, name, dot, isAdmin: false, hasPin: true, avatar: null, review_count: 0 });
}));

/* ── your own profile, and nobody else's ──────────────────────────────────
   The name and the picture are how a person appears next to everything they
   ever said here, so the rule is the same one the reviews already follow: it
   belongs to whoever it is. The route takes no id — it edits the account the
   session is signed in as, which makes editing someone else's not something to
   forbid but something there is no way to ask for.

   The admin is deliberately not an exception. Resetting a forgotten PIN is
   letting someone back in; renaming them is speaking for them. */
router.patch('/me', auth.requireSession, wrap(async (req, res) => {
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

  const row = await db
    .prepare('SELECT id, name, dot, is_admin, avatar_rev FROM reviewers WHERE id = ?')
    .get(id);
  res.json({
    reviewer: {
      id: row.id,
      name: row.name,
      dot: row.dot,
      isAdmin: !!row.is_admin,
      avatar: avatarUrl(row),
    },
  });
}));

/* The picture itself. Readable without a session for the same reason the roster
   is: the sign-in screen shows the club before anyone has signed in.

   Immutable for a year, and truthfully so — the `rev` in the URL changes with
   every upload, so this exact URL can only ever answer with this exact image. */
router.get('/:id/avatar', wrap(async (req, res) => {
  const row = await avatarStmt.get(req.params.id);
  if (!row?.avatar) return res.status(404).end();
  const buf = Buffer.from(row.avatar, 'base64');
  res.set('Content-Type', row.avatar_mime || 'image/webp');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(buf);
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
