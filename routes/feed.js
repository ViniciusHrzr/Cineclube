const express = require('express');
const db = require('../lib/db');
const wrap = require('../lib/wrap');
const { excerpt, endsOf } = require('../rules/takes');
const clubs = require('../lib/clubs');

const router = express.Router({ mergeParams: true });

const LIMIT = 80;

const recentReviews = db.prepare(`
  SELECT rv.id, rv.recorded_at, rv.movie_id, rv.movie_title, rv.movie_poster,
         rv.movie_genre, rv.scores, rv.final, rv.comment,
         r.id AS actor_id, r.name AS actor_name, r.dot AS actor_dot
  FROM reviews rv
  JOIN reviewers r ON r.id = rv.reviewer_id
  WHERE rv.club_id = ?
  ORDER BY rv.recorded_at DESC
  LIMIT ${LIMIT}
`);

const recentComments = db.prepare(`
  SELECT c.id, c.created_at, c.body, c.parent_id,
         a.id AS actor_id, a.name AS actor_name, a.dot AS actor_dot,
         rv.id AS review_id, rv.movie_id, rv.movie_title, rv.movie_poster,
         o.name AS owner_name, o.id AS owner_id
  FROM review_comments c
  JOIN reviews rv ON rv.id = c.review_id
  JOIN reviewers a ON a.id = c.reviewer_id
  JOIN reviewers o ON o.id = rv.reviewer_id
  WHERE rv.club_id = ?
  ORDER BY c.created_at DESC
  LIMIT ${LIMIT}
`);

const actorOf = row => ({ id: row.actor_id, name: row.actor_name, dot: row.actor_dot });

router.get('/', clubs.requireReadable, wrap(async (req, res) => {
  const [reviews, comments] = await Promise.all([
    recentReviews.all(req.club.id),
    recentComments.all(req.club.id),
  ]);

  const items = [];

  for (const row of reviews) {
    items.push({
      id: `r:${row.id}`,
      kind: 'review',
      at: row.recorded_at,
      actor: actorOf(row),
      movieId: Number(row.movie_id),
      movieTitle: row.movie_title,
      moviePoster: row.movie_poster,
      reviewId: row.id,
      final: row.final,
      genre: row.movie_genre,
      ends: endsOf(row.movie_genre, row.scores),
      excerpt: row.comment ? excerpt(row.comment) : null
    });
  }

  for (const row of comments) {
    items.push({
      id: `c:${row.id}`,
      kind: 'comment',
      at: row.created_at,
      actor: actorOf(row),
      movieId: Number(row.movie_id),
      movieTitle: row.movie_title,
      moviePoster: row.movie_poster,
      reviewId: row.review_id,
      commentId: row.id,
      parentId: row.parent_id || null,
      owner: { id: row.owner_id, name: row.owner_name },
      excerpt: excerpt(row.body)
    });
  }

  const filtrado =
    req.club.isMember || req.club.visibility === 'public'
      ? items
      : items.filter(i =>
          i.kind === 'review'
            ? req.club.showReviews
            : i.kind === 'comment'
              ? req.club.showComments
              : req.club.showReviews && req.club.showComments
        );

  filtrado.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  res.json({ items: filtrado.slice(0, LIMIT) });
}));

module.exports = router;
