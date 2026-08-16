const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { GENRES } = require('../criteria');

const router = express.Router();

// position is the club's arrangement; added_at only breaks ties for rows that
// predate the column.
const listStmt = db.prepare(
  'SELECT * FROM watchlist ORDER BY position IS NULL, position ASC, added_at DESC'
);
const insertStmt = db.prepare(`
  INSERT INTO watchlist (movie_id, movie_title, movie_year, movie_genre, movie_poster, position)
  VALUES (@movieId, @movieTitle, @movieYear, @movieGenre, @moviePoster,
          (SELECT COALESCE(MAX(position), -1) + 1 FROM watchlist))
  ON CONFLICT(movie_id) DO NOTHING
`);
const setPositionStmt = db.prepare('UPDATE watchlist SET position = ? WHERE movie_id = ?');
const idsStmt = db.prepare('SELECT movie_id FROM watchlist');
const deleteStmt = db.prepare('DELETE FROM watchlist WHERE movie_id = ?');

function toDTO(row) {
  return {
    id: row.movie_id,
    title: row.movie_title,
    year: row.movie_year,
    genre: row.movie_genre,
    poster: row.movie_poster,
    addedAt: row.added_at
  };
}

router.get('/', (req, res) => {
  res.json({ watchlist: listStmt.all().map(toDTO) });
});

// The queue is shared, so changing it is a club action and needs a member.
router.post('/', auth.requireSession, (req, res) => {
  const { movie } = req.body || {};
  if (!movie || !movie.id || !movie.title) {
    return res.status(400).json({ error: 'Filme inválido.' });
  }
  const genre = GENRES.includes(movie.genre) ? movie.genre : 'Drama';
  insertStmt.run({
    movieId: movie.id, movieTitle: movie.title, movieYear: movie.year ?? null,
    movieGenre: genre, moviePoster: movie.poster ?? null
  });
  res.status(201).json({ ok: true });
});

/* Reordering the queue. The client sends the whole order it wants, which is
   simpler to reason about than a from/to pair and cannot leave a gap: anything
   the client omits keeps its relative place at the end, so a stale tab cannot
   drop a film somebody else just added. */
router.put('/order', auth.requireSession, (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'Ordem inválida.' });

  const known = new Set(idsStmt.all().map(r => Number(r.movie_id)));
  const wanted = ids.map(Number).filter(id => known.has(id));
  const rest = [...known].filter(id => !wanted.includes(id));

  db.exec('BEGIN');
  try {
    [...wanted, ...rest].forEach((id, i) => setPositionStmt.run(i, id));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json({ watchlist: listStmt.all().map(toDTO) });
});

router.delete('/:movieId', auth.requireSession, (req, res) => {
  deleteStmt.run(Number(req.params.movieId));
  res.status(204).end();
});

module.exports = router;
