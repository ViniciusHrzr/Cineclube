const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const auth = require('../auth');
const clubs = require('../clubs');
const wrap = require('../wrap');
const throttle = require('../throttle');
const live = require('../live');

const router = express.Router({ mergeParams: true });

const throttleComment = throttle.limit({
  name: 'comment',
  max: 20,
  windowMs: 60_000,
  message: espera => `Muitos comentários seguidos. Tente de novo em ${espera}.`,
});

const MAX_BODY = 1000;

const commentsStmt = db.prepare(`
  SELECT c.id, c.review_id, c.reviewer_id, c.body, c.created_at, c.parent_id,
         r.name AS reviewer_name, r.dot AS reviewer_dot
  FROM review_comments c
  JOIN reviewers r ON r.id = c.reviewer_id
  JOIN reviews rv ON rv.id = c.review_id
  WHERE rv.club_id = ?
  ORDER BY c.created_at ASC
`);
const votesStmt = db.prepare(`
  SELECT v.review_id, v.reviewer_id, v.value
  FROM review_votes v JOIN reviews rv ON rv.id = v.review_id
  WHERE rv.club_id = ?
`);
const likesStmt = db.prepare(`
  SELECT l.comment_id, l.reviewer_id
  FROM comment_likes l
  JOIN review_comments c ON c.id = l.comment_id
  JOIN reviews rv ON rv.id = c.review_id
  WHERE rv.club_id = ?
`);

const commentAuthorStmt = db.prepare(`
  SELECT c.id, c.reviewer_id
  FROM review_comments c JOIN reviews rv ON rv.id = c.review_id
  WHERE c.id = ? AND rv.club_id = ?
`);
const likeStmt = db.prepare(
  'INSERT INTO comment_likes (comment_id, reviewer_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
);
const unlikeStmt = db.prepare(
  'DELETE FROM comment_likes WHERE comment_id = ? AND reviewer_id = ?'
);

const oneCommentStmt = db.prepare(`
  SELECT c.id, c.review_id, c.reviewer_id, c.body, c.created_at, c.parent_id,
         r.name AS reviewer_name, r.dot AS reviewer_dot
  FROM review_comments c
  JOIN reviewers r ON r.id = c.reviewer_id
  WHERE c.id = ?
`);
const insertCommentStmt = db.prepare(
  'INSERT INTO review_comments (id, review_id, reviewer_id, body, parent_id) VALUES (?, ?, ?, ?, ?)'
);
const commentOwnerStmt = db.prepare(`
  SELECT c.id, c.reviewer_id, c.review_id, c.parent_id
  FROM review_comments c JOIN reviews rv ON rv.id = c.review_id
  WHERE c.id = ? AND rv.club_id = ?
`);
const deleteCommentStmt = db.prepare('DELETE FROM review_comments WHERE id = ?');
const deleteRepliesStmt = db.prepare('DELETE FROM review_comments WHERE parent_id = ?');

const reviewStmt = db.prepare(
  'SELECT id, reviewer_id, scores FROM reviews WHERE id = ? AND club_id = ?'
);
const castVoteStmt = db.prepare(`
  INSERT INTO review_votes (review_id, reviewer_id, value)
  VALUES (?, ?, ?)
  ON CONFLICT(review_id, reviewer_id) DO UPDATE SET
    value = excluded.value, created_at = datetime('now')
`);
const clearVoteStmt = db.prepare(
  'DELETE FROM review_votes WHERE review_id = ? AND reviewer_id = ?'
);

function toCommentDTO(row) {
  return {
    id: row.id,
    reviewId: row.review_id,
    takeId: row.review_id,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    reviewerDot: row.reviewer_dot,
    body: row.body,
    parentId: row.parent_id || null,
    createdAt: row.created_at
  };
}

function toVoteDTO(row) {
  return {
    reviewId: row.review_id,
    takeId: row.review_id,
    reviewerId: row.reviewer_id,
    value: Number(row.value)
  };
}

router.get('/', clubs.canRead('comments'), wrap(async (req, res) => {
  const [comments, votes, likes] = await Promise.all([
    commentsStmt.all(req.club.id), votesStmt.all(req.club.id), likesStmt.all(req.club.id)
  ]);
  res.json({
    comments: comments.map(toCommentDTO),
    votes: votes.map(toVoteDTO),
    commentLikes: likes.map(row => ({ commentId: row.comment_id, reviewerId: row.reviewer_id }))
  });
}));

router.post('/reviews/:reviewId/comments', auth.requireSession, clubs.requireMember, throttleComment, wrap(async (req, res) => {
  const review = await reviewStmt.get(req.params.reviewId, req.club.id);
  if (!review) return res.status(404).json({ error: 'Avaliação não encontrada.' });

  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ error: 'Escreva alguma coisa antes de enviar.' });
  if (body.length > MAX_BODY) {
    return res.status(400).json({ error: `Comentário longo demais (máximo ${MAX_BODY} caracteres).` });
  }

  const parentId = req.body?.parentId ?? null;
  if (parentId != null) {
    const parent = await commentOwnerStmt.get(String(parentId), req.club.id);
    if (!parent || parent.review_id !== review.id) {
      return res.status(400).json({ error: 'Não dá para responder a esse comentário.' });
    }
    if (parent.parent_id) {
      return res.status(400).json({ error: 'Uma resposta não recebe resposta — responda o comentário.' });
    }
  }

  const id = 'c' + crypto.randomUUID();
  await insertCommentStmt.run(id, review.id, req.session.reviewer_id, body, parentId ? String(parentId) : null);
  live.emit('social', req.session.reviewer_id, req.club.id);
  res.status(201).json(toCommentDTO(await oneCommentStmt.get(id)));
}));

router.delete('/comments/:id', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  const row = await commentOwnerStmt.get(req.params.id, req.club.id);
  if (!row) return res.status(404).json({ error: 'Comentário não encontrado.' });
  if (
    row.reviewer_id !== req.session.reviewer_id &&
    !req.club.isClubAdmin &&
    !req.session.is_admin
  ) {
    return res.status(403).json({ error: 'Você só pode apagar os seus comentários.' });
  }
  await deleteRepliesStmt.run(row.id);
  await deleteCommentStmt.run(row.id);
  live.emit('social', req.session.reviewer_id, req.club.id);
  res.status(204).end();
}));

router.put('/comments/:id/like', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  const comment = await commentAuthorStmt.get(req.params.id, req.club.id);
  if (!comment) return res.status(404).json({ error: 'Comentário não encontrado.' });
  if (comment.reviewer_id === req.session.reviewer_id) {
    return res.status(403).json({ error: 'Não dá para curtir o seu próprio comentário.' });
  }

  const liked = req.body?.liked;
  if (typeof liked !== 'boolean') return res.status(400).json({ error: 'Curtida inválida.' });

  const who = req.session.reviewer_id;
  if (liked) await likeStmt.run(comment.id, who);
  else await unlikeStmt.run(comment.id, who);
  live.emit('social', who, req.club.id);
  res.json({ liked });
}));

router.put('/reviews/:reviewId/vote', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  const review = await reviewStmt.get(req.params.reviewId, req.club.id);
  if (!review) return res.status(404).json({ error: 'Avaliação não encontrada.' });
  if (review.reviewer_id === req.session.reviewer_id) {
    return res.status(403).json({ error: 'Não dá para votar na sua própria avaliação.' });
  }

  const value = req.body?.value;
  if (typeof value !== 'number' || ![1, -1, 0].includes(value)) {
    return res.status(400).json({ error: 'Voto inválido.' });
  }

  const voter = req.session.reviewer_id;
  if (value === 0) {
    await clearVoteStmt.run(review.id, voter);
    live.emit('social', voter, req.club.id);
    return res.json({ vote: null });
  }
  await castVoteStmt.run(review.id, voter, value);
  live.emit('social', voter, req.club.id);
  res.json({ vote: { reviewId: review.id, takeId: review.id, reviewerId: voter, value } });
}));

module.exports = router;
