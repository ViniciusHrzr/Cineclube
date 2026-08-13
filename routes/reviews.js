const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const { critsFor, finalOf, GENRES } = require('../criteria');

const router = express.Router();

const listStmt = db.prepare(`
  SELECT rv.*, r.name AS reviewer_name, r.dot AS reviewer_dot
  FROM reviews rv
  JOIN reviewers r ON r.id = rv.reviewer_id
  ORDER BY rv.date DESC
`);
const reviewerExistsStmt = db.prepare('SELECT id FROM reviewers WHERE id = ?');
const upsertStmt = db.prepare(`
  INSERT INTO reviews (id, reviewer_id, movie_id, movie_title, movie_year, movie_genre, movie_poster, movie_director, scores, final, date, comment)
  VALUES (@id, @reviewerId, @movieId, @movieTitle, @movieYear, @movieGenre, @moviePoster, @movieDirector, @scores, @final, @date, @comment)
  ON CONFLICT(reviewer_id, movie_id) DO UPDATE SET
    movie_title = excluded.movie_title, movie_year = excluded.movie_year, movie_genre = excluded.movie_genre,
    movie_poster = excluded.movie_poster, movie_director = excluded.movie_director,
    scores = excluded.scores, final = excluded.final, date = excluded.date, comment = excluded.comment
`);
const averagesStmt = db.prepare(`
  SELECT movie_id, AVG(final) AS avg, COUNT(*) AS count
  FROM reviews
  GROUP BY movie_id
`);
const deleteStmt = db.prepare('DELETE FROM reviews WHERE id = ?');
const getByIdStmt = db.prepare('SELECT id FROM reviews WHERE id = ?');
const deleteWatchlistStmt = db.prepare('DELETE FROM watchlist WHERE movie_id = ?');

function toReviewDTO(row) {
  const genre = GENRES.includes(row.movie_genre) ? row.movie_genre : 'Drama';
  const scores = JSON.parse(row.scores);
  const breakdown = critsFor(genre).map(c => ({ key: c.key, name: c.name, w: c.w, value: scores[c.key] ?? 0 }));
  return {
    id: row.id,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    reviewerDot: row.reviewer_dot,
    movieId: row.movie_id,
    movieTitle: row.movie_title,
    movieYear: row.movie_year,
    movieGenre: genre,
    moviePoster: row.movie_poster,
    movieDirector: row.movie_director,
    scores,
    final: row.final,
    date: row.date,
    comment: row.comment || '',
    breakdown
  };
}

router.get('/', (req, res) => {
  res.json({ reviews: listStmt.all().map(toReviewDTO) });
});

router.get('/averages', (req, res) => {
  const out = {};
  for (const row of averagesStmt.all()) out[row.movie_id] = { avg: row.avg, count: row.count };
  res.json({ averages: out });
});

router.post('/', (req, res) => {
  const { reviewerId, movie, scores, comment } = req.body || {};
  if (!reviewerId || !reviewerExistsStmt.get(reviewerId)) {
    return res.status(400).json({ error: 'Avaliador inválido.' });
  }
  if (!movie || !movie.id || !movie.title) {
    return res.status(400).json({ error: 'Filme inválido.' });
  }
  if (!scores || typeof scores !== 'object') {
    return res.status(400).json({ error: 'Notas inválidas.' });
  }
  const genre = GENRES.includes(movie.genre) ? movie.genre : 'Drama';
  const cs = critsFor(genre);
  const cleanScores = {};
  for (const c of cs) {
    const v = Number(scores[c.key]);
    cleanScores[c.key] = Number.isFinite(v) ? Math.min(10, Math.max(0, v)) : 0;
  }
  const final = finalOf(genre, cleanScores);
  const id = 'r' + crypto.randomUUID();
  const date = new Date().toISOString().slice(0, 10);
  const cleanComment = typeof comment === 'string' ? comment.trim().slice(0, 2000) : null;

  upsertStmt.run({
    id, reviewerId, movieId: movie.id,
    movieTitle: movie.title, movieYear: movie.year ?? null, movieGenre: genre,
    moviePoster: movie.poster ?? null, movieDirector: movie.director ?? null,
    scores: JSON.stringify(cleanScores), final, date, comment: cleanComment || null
  });
  deleteWatchlistStmt.run(movie.id);

  const saved = db.prepare(`
    SELECT rv.*, r.name AS reviewer_name, r.dot AS reviewer_dot
    FROM reviews rv JOIN reviewers r ON r.id = rv.reviewer_id
    WHERE rv.reviewer_id = ? AND rv.movie_id = ?
  `).get(reviewerId, movie.id);

  res.status(201).json(toReviewDTO(saved));
});

router.delete('/:id', (req, res) => {
  if (!getByIdStmt.get(req.params.id)) return res.status(404).json({ error: 'Avaliação não encontrada.' });
  deleteStmt.run(req.params.id);
  res.status(204).end();
});

module.exports = router;
