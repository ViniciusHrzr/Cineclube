const express = require('express');
const db = require('../db');
const auth = require('../auth');
const clubs = require('../clubs');
const wrap = require('../wrap');
const { fillEnglishTitle } = require('../english');
const { cleanMovie } = require('../movie');
const throttle = require('../throttle');
const live = require('../live');

const router = express.Router({ mergeParams: true });

const throttleQueue = throttle.limit({
  name: 'watchlist',
  max: 60,
  windowMs: 60 * 60_000,
  message: espera => `Muitos filmes postos na fila seguidos. Tente de novo em ${espera}.`,
});

const listStmt = db.prepare(`
  SELECT w.*, mc.original_title, mc.english_title
  FROM watchlist w
  LEFT JOIN movies_cache mc ON mc.tmdb_id = w.movie_id
  WHERE w.club_id = ?
  ORDER BY w.position IS NULL, w.position ASC, w.added_at DESC
`);
const insertStmt = db.prepare(`
  INSERT INTO watchlist (club_id, movie_id, movie_title, movie_year, movie_genre, movie_poster, position, added_by)
  VALUES (@clubId, @movieId, @movieTitle, @movieYear, @movieGenre, @moviePoster,
          COALESCE(
            (SELECT MIN(position) FROM watchlist WHERE club_id = @clubId AND movie_id = @movieId),
            (SELECT COALESCE(MAX(position), -1) + 1 FROM watchlist WHERE club_id = @clubId)),
          @addedBy)
  ON CONFLICT(club_id, movie_id, added_by) DO NOTHING
`);
const idsStmt = db.prepare('SELECT DISTINCT movie_id FROM watchlist WHERE club_id = ?');
const deleteMineStmt = db.prepare('DELETE FROM watchlist WHERE club_id = ? AND movie_id = ? AND added_by = ?');
const deleteStmt = db.prepare('DELETE FROM watchlist WHERE club_id = ? AND movie_id = ?');
const wantersStmt = db.prepare(`
  SELECT w.movie_id, w.movie_title, w.added_by, r.name AS added_by_name
  FROM watchlist w
  LEFT JOIN reviewers r ON r.id = w.added_by
  WHERE w.club_id = ? AND w.movie_id = ?
  ORDER BY w.added_at ASC
`);

const SET_POSITION = 'UPDATE watchlist SET position = ? WHERE club_id = ? AND movie_id = ?';

function toDTO(row) {
  return {
    id: row.movie_id,
    title: row.movie_title,
    original: row.original_title ?? null,
    english: row.english_title ?? null,
    year: row.movie_year,
    genre: row.movie_genre,
    poster: row.movie_poster,
    addedAt: row.added_at,
    wanters: row.added_by ? [row.added_by] : [],
  };
}

function toQueue(rows) {
  const films = new Map();
  for (const row of rows) {
    const held = films.get(row.movie_id);
    if (!held) films.set(row.movie_id, toDTO(row));
    else if (row.added_by && !held.wanters.includes(row.added_by)) held.wanters.push(row.added_by);
  }
  return [...films.values()];
}

router.get('/', clubs.requireReadable, wrap(async (req, res) => {
  const rows = await listStmt.all(req.club.id);
  res.json({ watchlist: toQueue(rows) });
}));

router.post('/', auth.requireSession, clubs.requireMember, throttleQueue, wrap(async (req, res) => {
  const limpo = cleanMovie(req.body?.movie);
  if (limpo.error) return res.status(400).json({ error: limpo.error });
  const movie = limpo.movie;

  await insertStmt.run({
    clubId: req.club.id,
    movieId: movie.id, movieTitle: movie.title, movieYear: movie.year,
    movieGenre: movie.genre, moviePoster: movie.poster,
    addedBy: req.session.reviewer_id
  });
  await fillEnglishTitle(movie.id);
  live.emit('watchlist', req.session.reviewer_id, req.club.id);
  res.status(201).json({ ok: true });
}));

router.put('/order', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'Ordem inválida.' });

  const rows = await idsStmt.all(req.club.id);
  const known = new Set(rows.map(r => Number(r.movie_id)));
  const wanted = ids.map(Number).filter(id => known.has(id));
  const rest = [...known].filter(id => !wanted.includes(id));

  const ordered = [...wanted, ...rest];
  if (ordered.length) {
    await db.batch(ordered.map((id, i) => ({ sql: SET_POSITION, args: [i, req.club.id, id] })));
  }

  const listed = await listStmt.all(req.club.id);
  live.emit('watchlist', req.session.reviewer_id, req.club.id);
  res.json({ watchlist: toQueue(listed) });
}));

router.delete('/:movieId', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  const rows = await wantersStmt.all(req.club.id, Number(req.params.movieId));
  if (!rows.length) return res.status(204).end();

  const movieId = rows[0].movie_id;
  const mine = rows.some(r => r.added_by && r.added_by === req.session.reviewer_id);
  if (!mine && !req.club.isClubAdmin && !req.session.is_admin) {
    const names = [...new Set(rows.map(r => r.added_by_name).filter(Boolean))];
    return res.status(403).json({
      error: names.length
        ? `Cada um tira o seu, e ${rows[0].movie_title} está na fila de ${names.join(', ')}.`
        : 'Este filme entrou na fila antes de ela registrar quem põe. Só o administrador do clube pode tirar.'
    });
  }

  if (mine) await deleteMineStmt.run(req.club.id, movieId, req.session.reviewer_id);
  else await deleteStmt.run(req.club.id, movieId);
  live.emit('watchlist', req.session.reviewer_id, req.club.id);
  res.status(204).end();
}));

module.exports = router;
