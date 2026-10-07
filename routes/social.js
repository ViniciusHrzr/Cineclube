const express = require('express');
const crypto = require('node:crypto');
const db = require('../lib/db');
const auth = require('../lib/auth');
const clubs = require('../lib/clubs');
const wrap = require('../lib/wrap');
const throttle = require('../lib/throttle');
const live = require('../lib/live');

const MAX_BODY = 1000;

function socialRoutes({
  comments,
  votes,
  likes,
  subject,
  subjectKey,
  subjectFields,
  subjectName,
  collection,
  param,
  prefix,
  channel,
  throttleName,
  alsoAsReview,
}) {
  const router = express.Router({ mergeParams: true });

  const throttleComment = throttle.limit({
    name: throttleName,
    max: 20,
    windowMs: 60_000,
    message: espera => `Muitos comentários seguidos. Tente de novo em ${espera}.`,
  });

  const commentsStmt = db.prepare(`
    SELECT c.id, c.${subjectKey}, c.reviewer_id, c.body, c.created_at, c.parent_id,
           r.name AS reviewer_name, r.dot AS reviewer_dot
    FROM ${comments} c
    JOIN reviewers r ON r.id = c.reviewer_id
    JOIN ${subject} s ON s.id = c.${subjectKey}
    WHERE s.club_id = ?
    ORDER BY c.created_at ASC
  `);
  const votesStmt = db.prepare(`
    SELECT v.${subjectKey}, v.reviewer_id, v.value
    FROM ${votes} v JOIN ${subject} s ON s.id = v.${subjectKey}
    WHERE s.club_id = ?
  `);
  const likesStmt = db.prepare(`
    SELECT l.comment_id, l.reviewer_id
    FROM ${likes} l
    JOIN ${comments} c ON c.id = l.comment_id
    JOIN ${subject} s ON s.id = c.${subjectKey}
    WHERE s.club_id = ?
  `);

  const commentAuthorStmt = db.prepare(`
    SELECT c.id, c.reviewer_id
    FROM ${comments} c JOIN ${subject} s ON s.id = c.${subjectKey}
    WHERE c.id = ? AND s.club_id = ?
  `);
  const likeStmt = db.prepare(
    `INSERT INTO ${likes} (comment_id, reviewer_id) VALUES (?, ?) ON CONFLICT DO NOTHING`
  );
  const unlikeStmt = db.prepare(
    `DELETE FROM ${likes} WHERE comment_id = ? AND reviewer_id = ?`
  );

  const oneCommentStmt = db.prepare(`
    SELECT c.id, c.${subjectKey}, c.reviewer_id, c.body, c.created_at, c.parent_id,
           r.name AS reviewer_name, r.dot AS reviewer_dot
    FROM ${comments} c
    JOIN reviewers r ON r.id = c.reviewer_id
    WHERE c.id = ?
  `);
  const insertCommentStmt = db.prepare(
    `INSERT INTO ${comments} (id, ${subjectKey}, reviewer_id, body, parent_id) VALUES (?, ?, ?, ?, ?)`
  );
  const commentOwnerStmt = db.prepare(`
    SELECT c.id, c.reviewer_id, c.${subjectKey}, c.parent_id
    FROM ${comments} c JOIN ${subject} s ON s.id = c.${subjectKey}
    WHERE c.id = ? AND s.club_id = ?
  `);
  const deleteCommentStmt = db.prepare(`DELETE FROM ${comments} WHERE id = ?`);
  const deleteRepliesStmt = db.prepare(`DELETE FROM ${comments} WHERE parent_id = ?`);

  const subjectStmt = db.prepare(
    `SELECT ${subjectFields} FROM ${subject} WHERE id = ? AND club_id = ?`
  );
  const castVoteStmt = db.prepare(`
    INSERT INTO ${votes} (${subjectKey}, reviewer_id, value)
    VALUES (?, ?, ?)
    ON CONFLICT(${subjectKey}, reviewer_id) DO UPDATE SET
      value = excluded.value, created_at = datetime('now')
  `);
  const clearVoteStmt = db.prepare(
    `DELETE FROM ${votes} WHERE ${subjectKey} = ? AND reviewer_id = ?`
  );

  const idsOf = value => (alsoAsReview ? { reviewId: value, takeId: value } : { takeId: value });

  const toCommentDTO = row => ({
    id: row.id,
    ...idsOf(row[subjectKey]),
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    reviewerDot: row.reviewer_dot,
    body: row.body,
    parentId: row.parent_id || null,
    createdAt: row.created_at,
  });

  const toVoteDTO = row => ({
    ...idsOf(row[subjectKey]),
    reviewerId: row.reviewer_id,
    value: Number(row.value),
  });

  router.get('/', clubs.canRead('comments'), wrap(async (req, res) => {
    const [comentarios, votos, curtidas] = await Promise.all([
      commentsStmt.all(req.club.id), votesStmt.all(req.club.id), likesStmt.all(req.club.id),
    ]);
    res.json({
      comments: comentarios.map(toCommentDTO),
      votes: votos.map(toVoteDTO),
      commentLikes: curtidas.map(row => ({
        commentId: row.comment_id,
        reviewerId: row.reviewer_id,
      })),
    });
  }));

  router.post(
    `/${collection}/:${param}/comments`,
    auth.requireSession, clubs.requireMember, throttleComment,
    wrap(async (req, res) => {
      const alvo = await subjectStmt.get(req.params[param], req.club.id);
      if (!alvo) return res.status(404).json({ error: `${subjectName} não encontrada.` });

      const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
      if (!body) return res.status(400).json({ error: 'Escreva alguma coisa antes de enviar.' });
      if (body.length > MAX_BODY) {
        return res.status(400).json({ error: `Comentário longo demais (máximo ${MAX_BODY} caracteres).` });
      }

      const parentId = req.body?.parentId ?? null;
      if (parentId != null) {
        const parent = await commentOwnerStmt.get(String(parentId), req.club.id);
        if (!parent || parent[subjectKey] !== alvo.id) {
          return res.status(400).json({ error: 'Não dá para responder a esse comentário.' });
        }
        if (parent.parent_id) {
          return res.status(400).json({ error: 'Uma resposta não recebe resposta — responda o comentário.' });
        }
      }

      const id = prefix + crypto.randomUUID();
      await insertCommentStmt.run(
        id, alvo.id, req.session.reviewer_id, body, parentId ? String(parentId) : null
      );
      live.emit(channel, req.session.reviewer_id, req.club.id);
      res.status(201).json(toCommentDTO(await oneCommentStmt.get(id)));
    })
  );

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
    live.emit(channel, req.session.reviewer_id, req.club.id);
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
    live.emit(channel, who, req.club.id);
    res.json({ liked });
  }));

  router.put(`/${collection}/:${param}/vote`, auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
    const alvo = await subjectStmt.get(req.params[param], req.club.id);
    if (!alvo) return res.status(404).json({ error: `${subjectName} não encontrada.` });
    if (alvo.reviewer_id === req.session.reviewer_id) {
      return res.status(403).json({
        error: `Não dá para votar na sua própria ${subjectName.toLowerCase()}.`,
      });
    }

    const value = req.body?.value;
    if (typeof value !== 'number' || ![1, -1, 0].includes(value)) {
      return res.status(400).json({ error: 'Voto inválido.' });
    }

    const voter = req.session.reviewer_id;
    if (value === 0) {
      await clearVoteStmt.run(alvo.id, voter);
      live.emit(channel, voter, req.club.id);
      return res.json({ vote: null });
    }
    await castVoteStmt.run(alvo.id, voter, value);
    live.emit(channel, voter, req.club.id);
    res.json({ vote: { ...idsOf(alvo.id), reviewerId: voter, value } });
  }));

  return router;
}

const reviews = () => socialRoutes({
  comments: 'review_comments',
  votes: 'review_votes',
  likes: 'comment_likes',
  subject: 'reviews',
  subjectKey: 'review_id',
  subjectFields: 'id, reviewer_id, scores',
  subjectName: 'Avaliação',
  collection: 'reviews',
  param: 'reviewId',
  prefix: 'c',
  channel: 'social',
  throttleName: 'comment',
  alsoAsReview: true,
});

const takes = () => socialRoutes({
  comments: 'take_comments',
  votes: 'take_votes',
  likes: 'take_comment_likes',
  subject: 'episode_takes',
  subjectKey: 'take_id',
  subjectFields: 'id, reviewer_id',
  subjectName: 'Ficha',
  collection: 'takes',
  param: 'takeId',
  prefix: 'k',
  channel: 'shows',
  throttleName: 'show-comment',
  alsoAsReview: false,
});

module.exports = { reviews, takes };
