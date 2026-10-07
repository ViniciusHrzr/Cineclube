const db = require('./db');

const bySlug = db.prepare('SELECT * FROM clubs WHERE slug = ?');
const byId = db.prepare('SELECT * FROM clubs WHERE id = ?');
const membership = db.prepare(
  'SELECT role FROM club_members WHERE club_id = ? AND reviewer_id = ?'
);

async function findClub(key) {
  if (!key) return null;
  return (await bySlug.get(key)) || (await byId.get(key)) || null;
}

async function resolve(req, res, next) {
  try {
    const club = await findClub(req.params.club);
    if (!club) return res.status(404).json({ error: 'Clube não encontrado.' });

    const mine = req.session
      ? await membership.get(club.id, req.session.reviewer_id)
      : null;

    req.club = {
      id: club.id,
      name: club.name,
      slug: club.slug,
      visibility: club.visibility,
      createdBy: club.created_by,
      role: mine?.role || null,
      isMember: !!mine,
      isClubAdmin: mine?.role === 'admin',
      showReviews: !!club.show_reviews,
      showComments: !!club.show_comments,
    };
    next();
  } catch (e) {
    next(e);
  }
}

function requireVisible(_req, _res, next) {
  next();
}

function canRead(what) {
  return function readable(req, res, next) {
    if (req.club.isMember || req.club.visibility === 'public') return next();

    const liberado =
      what === 'reviews'
        ? req.club.showReviews
        : what === 'comments'
          ? req.club.showComments
          : req.club.showReviews || req.club.showComments;

    if (liberado) return next();
    res.status(403).json({
      error: 'Este clube é fechado. Peça para entrar para ver o que tem dentro.',
    });
  };
}

const requireReadable = canRead('any');

function requireMember(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'Entre para continuar.' });
  if (req.club.isMember) return next();
  res.status(403).json({
    error:
      req.club.visibility === 'public'
        ? 'Entre no clube para fazer isso.'
        : 'Este clube é fechado. Peça para entrar.',
  });
}

function requireClubAdmin(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'Entre para continuar.' });
  if (req.club.isClubAdmin || req.session.is_admin) return next();
  res.status(403).json({ error: 'Só quem administra o clube pode fazer isso.' });
}

const rosterStmt = db.prepare(`
  SELECT r.id, r.name, r.dot, r.is_admin, r.avatar_rev, r.bio, r.created_at,
         m.role, m.joined_at
  FROM club_members m
  JOIN reviewers r ON r.id = m.reviewer_id
  WHERE m.club_id = ?
  ORDER BY m.joined_at ASC
`);

const roster = clubId => rosterStmt.all(clubId);

const mineStmt = db.prepare(`
  SELECT c.*, m.role, m.joined_at,
         (SELECT COUNT(*) FROM club_members x WHERE x.club_id = c.id) AS members
  FROM club_members m
  JOIN clubs c ON c.id = m.club_id
  WHERE m.reviewer_id = ?
  ORDER BY m.joined_at ASC
`);

module.exports = {
  resolve,
  requireVisible,
  canRead,
  requireReadable,
  requireMember,
  requireClubAdmin,
  roster,
  mineStmt,
  membership,
};
