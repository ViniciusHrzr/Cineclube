const express = require('express');
const crypto = require('node:crypto');
const db = require('../lib/db');
const auth = require('../lib/auth');
const clubs = require('../lib/clubs');
const wrap = require('../lib/wrap');
const { answeredIn, critsFor, finalOf, GENRES } = require('../rules/criteria');
const { fillEnglishTitle } = require('../tmdb/english');
const { cleanMovie } = require('../rules/movie');
const throttle = require('../lib/throttle');
const live = require('../lib/live');

const router = express.Router({ mergeParams: true });

const DA_SALA = `(
  rv.club_id = ?
  OR rv.reviewer_id IN (SELECT reviewer_id FROM club_members WHERE club_id = ?)
)`;

const CAMPOS = `
  rv.*, r.name AS reviewer_name, r.dot AS reviewer_dot,
  mc.runtime AS cached_runtime, mc.tmdb_score, mc.tmdb_votes,
  mc.original_title, mc.english_title,
  oc.name AS origin_name, oc.slug AS origin_slug
`;
const JUNCOES = `
  FROM reviews rv
  JOIN reviewers r ON r.id = rv.reviewer_id
  LEFT JOIN movies_cache mc ON mc.tmdb_id = rv.movie_id
  LEFT JOIN clubs oc ON oc.id = rv.club_id
`;
const listStmt = db.prepare(`
  SELECT ${CAMPOS} ${JUNCOES} WHERE ${DA_SALA} ORDER BY rv.date DESC
`);
const upsertStmt = db.prepare(`  INSERT INTO reviews (id, club_id, reviewer_id, movie_id, movie_title, movie_year, movie_genre, movie_poster, movie_director, movie_runtime, scores, quick, final, date, comment, recorded_at)
  VALUES (@id, @clubId, @reviewerId, @movieId, @movieTitle, @movieYear, @movieGenre, @moviePoster, @movieDirector, @movieRuntime, @scores, @quick, @final, @date, @comment, datetime('now'))
  ON CONFLICT(reviewer_id, movie_id) DO UPDATE SET

    recorded_at = datetime('now'),
    club_id = excluded.club_id,
    movie_title = excluded.movie_title, movie_year = excluded.movie_year, movie_genre = excluded.movie_genre,
    movie_poster = excluded.movie_poster, movie_director = excluded.movie_director,
    movie_runtime = COALESCE(excluded.movie_runtime, reviews.movie_runtime),
    scores = excluded.scores, quick = excluded.quick, final = excluded.final,
    date = excluded.date, comment = excluded.comment
`);
const averagesStmt = db.prepare(`
  SELECT rv.movie_id, AVG(rv.final) AS avg, COUNT(*) AS count
  FROM reviews rv
  WHERE ${DA_SALA}
  GROUP BY rv.movie_id
`);
const savedStmt = db.prepare(`
  SELECT ${CAMPOS} ${JUNCOES} WHERE rv.reviewer_id = ? AND rv.movie_id = ?
`);
const ownerStmt = db.prepare('SELECT id, reviewer_id FROM reviews WHERE id = ?');
const deleteStmt = db.prepare('DELETE FROM reviews WHERE id = ?');
const deleteWatchlistStmt = db.prepare('DELETE FROM watchlist WHERE club_id = ? AND movie_id = ?');

function toReviewDTO(row, clubId) {
  const genre = GENRES.includes(row.movie_genre) ? row.movie_genre : 'Drama';
  const scores = JSON.parse(row.scores);
  const breakdown = answeredIn(genre, scores).map(c => ({
    key: c.key, name: c.name, w: c.w, group: c.group, value: scores[c.key]
  }));
  return {
    id: row.id,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    reviewerDot: row.reviewer_dot,
    movieId: row.movie_id,
    movieTitle: row.movie_title,
    movieOriginal: row.original_title ?? null,
    movieEnglish: row.english_title ?? null,
    movieYear: row.movie_year,
    movieGenre: genre,
    moviePoster: row.movie_poster,
    movieDirector: row.movie_director,
    movieRuntime: row.movie_runtime ?? row.cached_runtime ?? null,
    crowd: row.tmdb_votes > 0 ? { score: row.tmdb_score, votes: row.tmdb_votes } : null,
    scores,
    quick: row.quick ?? null,
    final: row.final,
    date: row.date,
    comment: row.comment || '',
    origin:
      row.club_id && clubId && row.club_id !== clubId
        ? { name: row.origin_name ?? null, slug: row.origin_slug ?? null }
        : null,
    breakdown
  };
}

router.get('/', clubs.canRead('reviews'), wrap(async (req, res) => {
  const rows = await listStmt.all(req.club.id, req.club.id);
  res.json({ reviews: rows.map(r => toReviewDTO(r, req.club.id)) });
}));

router.get('/averages', clubs.canRead('reviews'), wrap(async (req, res) => {
  const out = {};
  for (const row of await averagesStmt.all(req.club.id, req.club.id)) {
    out[row.movie_id] = { avg: row.avg, count: row.count };
  }
  res.json({ averages: out });
}));

const throttleReview = throttle.limit({
  name: 'review',
  max: 30,
  windowMs: 60 * 60_000,
  message: espera => `Muitas avaliações gravadas seguidas. Tente de novo em ${espera}.`,
});

router.post('/', auth.requireSession, clubs.requireMember, throttleReview, wrap(async (req, res) => {
  const { scores, comment } = req.body || {};
  const reviewerId = req.session.reviewer_id;
  const limpo = cleanMovie(req.body?.movie);
  if (limpo.error) return res.status(400).json({ error: limpo.error });
  const movie = limpo.movie;
  const genre = movie.genre;

  let cleanScores = {};
  let quick = null;
  let final;

  if (scores && typeof scores === 'object') {
    for (const c of critsFor(genre)) {
      const v = Number(scores[c.key]);
      cleanScores[c.key] = Number.isFinite(v) ? Math.min(10, Math.max(0, v)) : 0;
    }
    final = finalOf(genre, cleanScores);
  } else if (req.body?.quick !== undefined && req.body?.quick !== null) {
    const n = Number(req.body.quick);
    if (!Number.isFinite(n) || n < 0 || n > 10) {
      return res.status(400).json({ error: 'A nota tem de estar entre 0 e 10.' });
    }
    quick = n;
    final = n;
  } else {
    return res.status(400).json({ error: 'Notas inválidas.' });
  }

  const id = 'r' + crypto.randomUUID();
  const date = new Date().toISOString().slice(0, 10);
  const cleanComment = typeof comment === 'string' ? comment.trim().slice(0, 2000) : null;

  await upsertStmt.run({
    id, clubId: req.club.id, reviewerId, movieId: movie.id,
    movieTitle: movie.title, movieYear: movie.year, movieGenre: genre,
    moviePoster: movie.poster, movieDirector: movie.director,
    movieRuntime: movie.runtime,
    scores: JSON.stringify(cleanScores), quick, final, date, comment: cleanComment || null
  });
  await deleteWatchlistStmt.run(req.club.id, movie.id);
  await fillEnglishTitle(movie.id);

  live.emit('reviews', reviewerId, req.club.id);
  live.emit('watchlist', reviewerId, req.club.id);

  const saved = await savedStmt.get(reviewerId, movie.id);
  res.status(201).json(toReviewDTO(saved, req.club.id));
}));

router.delete('/:id', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  const row = await ownerStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Avaliação não encontrada.' });
  if (row.reviewer_id !== req.session.reviewer_id) {
    return res.status(403).json({ error: 'Você só pode excluir as suas próprias avaliações.' });
  }
  await deleteStmt.run(row.id);
  live.emit('reviews', req.session.reviewer_id, req.club.id);
  live.emit('social', req.session.reviewer_id, req.club.id);
  res.status(204).end();
}));

module.exports = router;
