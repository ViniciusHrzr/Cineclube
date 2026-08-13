const express = require('express');
const db = require('../db');
const { GENRES } = require('../criteria');

const router = express.Router();

const listStmt = db.prepare('SELECT * FROM watchlist ORDER BY added_at DESC');
const insertStmt = db.prepare(`
  INSERT INTO watchlist (movie_id, movie_title, movie_year, movie_genre, movie_poster)
  VALUES (@movieId, @movieTitle, @movieYear, @movieGenre, @moviePoster)
  ON CONFLICT(movie_id) DO NOTHING
`);
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

router.post('/', (req, res) => {
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

router.delete('/:movieId', (req, res) => {
  deleteStmt.run(Number(req.params.movieId));
  res.status(204).end();
});

module.exports = router;
