const express = require('express');
const db = require('../db');
const auth = require('../auth');
const wrap = require('../wrap');
const { fillEnglishTitle } = require('../english');
const { GENRES } = require('../criteria');

const router = express.Router();

/* position is the club's arrangement; added_at only breaks ties for rows that
   predate the column.

   The original title comes through the cache rather than being copied into this
   table, the same way the archive reads the TMDB score: the queue row is a
   pointer to a film, and every film in it passed through the catalogue on its
   way here, so the cache knows the name. Null on the film the cache somehow
   never saw, which the card draws as simply not having a second line. */
const listStmt = db.prepare(`
  SELECT w.*, mc.original_title, mc.english_title
  FROM watchlist w
  LEFT JOIN movies_cache mc ON mc.tmdb_id = w.movie_id
  ORDER BY w.position IS NULL, w.position ASC, w.added_at DESC
`);
/* `added_by` é a sessão, como toda escrita neste app. A fila continua sendo do
   clube — quem pôs não ganha nenhum direito sobre a linha, qualquer um tira —
   mas o mural precisa saber de quem foi a ideia para ter o que contar. */
const insertStmt = db.prepare(`
  INSERT INTO watchlist (movie_id, movie_title, movie_year, movie_genre, movie_poster, position, added_by)
  VALUES (@movieId, @movieTitle, @movieYear, @movieGenre, @moviePoster,
          (SELECT COALESCE(MAX(position), -1) + 1 FROM watchlist), @addedBy)
  ON CONFLICT(movie_id) DO NOTHING
`);
const idsStmt = db.prepare('SELECT movie_id FROM watchlist');
const deleteStmt = db.prepare('DELETE FROM watchlist WHERE movie_id = ?');

const SET_POSITION = 'UPDATE watchlist SET position = ? WHERE movie_id = ?';

function toDTO(row) {
  return {
    id: row.movie_id,
    title: row.movie_title,
    original: row.original_title ?? null,
    english: row.english_title ?? null,
    year: row.movie_year,
    genre: row.movie_genre,
    poster: row.movie_poster,
    addedAt: row.added_at
  };
}

router.get('/', wrap(async (req, res) => {
  const rows = await listStmt.all();
  res.json({ watchlist: rows.map(toDTO) });
}));

// The queue is shared, so changing it is a club action and needs a member.
router.post('/', auth.requireSession, wrap(async (req, res) => {
  const { movie } = req.body || {};
  if (!movie || !movie.id || !movie.title) {
    return res.status(400).json({ error: 'Filme inválido.' });
  }
  const genre = GENRES.includes(movie.genre) ? movie.genre : 'Drama';
  await insertStmt.run({
    movieId: movie.id, movieTitle: movie.title, movieYear: movie.year ?? null,
    movieGenre: genre, moviePoster: movie.poster ?? null,
    addedBy: req.session.reviewer_id
  });
  /* A fila é uma das telas que filtram o banco, então o filme entra nela já
     sabendo por quais nomes pode ser procurado depois. */
  await fillEnglishTitle(movie.id);
  res.status(201).json({ ok: true });
}));

/* Reordering the queue. The client sends the whole order it wants, which is
   simpler to reason about than a from/to pair and cannot leave a gap: anything
   the client omits keeps its relative place at the end, so a stale tab cannot
   drop a film somebody else just added. */
router.put('/order', auth.requireSession, wrap(async (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'Ordem inválida.' });

  const rows = await idsStmt.all();
  const known = new Set(rows.map(r => Number(r.movie_id)));
  const wanted = ids.map(Number).filter(id => known.has(id));
  const rest = [...known].filter(id => !wanted.includes(id));

  // batch runs the whole thing in one transaction: either the queue moves or
  // nothing does.
  const ordered = [...wanted, ...rest];
  if (ordered.length) {
    await db.batch(ordered.map((id, i) => ({ sql: SET_POSITION, args: [i, id] })));
  }

  const listed = await listStmt.all();
  res.json({ watchlist: listed.map(toDTO) });
}));

router.delete('/:movieId', auth.requireSession, wrap(async (req, res) => {
  await deleteStmt.run(Number(req.params.movieId));
  res.status(204).end();
}));

module.exports = router;
