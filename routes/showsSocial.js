const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const auth = require('../auth');
const clubs = require('../clubs');
const wrap = require('../wrap');
const throttle = require('../throttle');
const live = require('../live');

const router = express.Router({ mergeParams: true });

/* ══════════════════════════════════════════════════════════════════════════
   A CONVERSA EM CIMA DE UM EPISÓDIO.

   O irmão de routes/social.js, e a palavra é irmão e não cópia: as regras aqui
   são as MESMAS, uma por uma, e estão escritas lá com o porquê inteiro de cada
   uma. O que muda é onde elas penduram — numa ficha de episódio em vez de numa
   ficha de filme —, e é isso que obriga o arquivo a existir em vez de a rota
   ganhar um parâmetro dizendo de que tipo é o alvo.

   Resumidas, para não obrigar a abrir o outro arquivo:

   · Comentar é o único texto livre entre pessoas, então tem trava própria.
   · Responder tem profundidade UM: uma resposta não recebe resposta.
   · Um voto por (ficha, quem votou). Zero apaga a linha, e não grava neutro.
   · Ninguém vota na própria ficha nem curte o próprio comentário — é
     aritmética e não moral: um placar que o autor pode somar em si mesmo
     deixa de medir o clube.
   · Apagar é de quem escreveu, e do ADM, que é quem modera.

   ── o clube entra por baixo, de novo ────────────────────────────────────
   Nada aqui tem `club_id`. Um comentário pendura numa ficha de episódio, e a
   ficha já sabe de que sala é. O preço é o mesmo de lá: TODA consulta passa
   por `episode_takes` para descobrir o clube, e `takeStmt` — o portão de toda
   escrita — carrega `club_id` na condição. Uma leitura que esquecer o JOIN
   mostra a conversa de outra sala; uma escrita que esquecer deixa alguém
   escrever dentro de uma sala em que não está.
   ══════════════════════════════════════════════════════════════════════════ */

const throttleComment = throttle.limit({
  name: 'show-comment',
  max: 20,
  windowMs: 60_000,
  message: espera => `Muitos comentários seguidos. Tente de novo em ${espera}.`,
});

/** O mesmo teto do outro lado. Um argumento cabe; um ensaio não. */
const MAX_BODY = 1000;

const commentsStmt = db.prepare(`
  SELECT c.id, c.take_id, c.reviewer_id, c.body, c.created_at, c.parent_id,
         r.name AS reviewer_name, r.dot AS reviewer_dot
  FROM take_comments c
  JOIN reviewers r ON r.id = c.reviewer_id
  JOIN episode_takes t ON t.id = c.take_id
  WHERE t.club_id = ?
  ORDER BY c.created_at ASC
`);
const votesStmt = db.prepare(`
  SELECT v.take_id, v.reviewer_id, v.value
  FROM take_votes v JOIN episode_takes t ON t.id = v.take_id
  WHERE t.club_id = ?
`);
const likesStmt = db.prepare(`
  SELECT l.comment_id, l.reviewer_id
  FROM take_comment_likes l
  JOIN take_comments c ON c.id = l.comment_id
  JOIN episode_takes t ON t.id = c.take_id
  WHERE t.club_id = ?
`);

const commentAuthorStmt = db.prepare(`
  SELECT c.id, c.reviewer_id
  FROM take_comments c JOIN episode_takes t ON t.id = c.take_id
  WHERE c.id = ? AND t.club_id = ?
`);
const likeStmt = db.prepare(
  'INSERT INTO take_comment_likes (comment_id, reviewer_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
);
const unlikeStmt = db.prepare(
  'DELETE FROM take_comment_likes WHERE comment_id = ? AND reviewer_id = ?'
);

const oneCommentStmt = db.prepare(`
  SELECT c.id, c.take_id, c.reviewer_id, c.body, c.created_at, c.parent_id,
         r.name AS reviewer_name, r.dot AS reviewer_dot
  FROM take_comments c
  JOIN reviewers r ON r.id = c.reviewer_id
  WHERE c.id = ?
`);
const insertCommentStmt = db.prepare(
  'INSERT INTO take_comments (id, take_id, reviewer_id, body, parent_id) VALUES (?, ?, ?, ?, ?)'
);
const commentOwnerStmt = db.prepare(`
  SELECT c.id, c.reviewer_id, c.take_id, c.parent_id
  FROM take_comments c JOIN episode_takes t ON t.id = c.take_id
  WHERE c.id = ? AND t.club_id = ?
`);
const deleteCommentStmt = db.prepare('DELETE FROM take_comments WHERE id = ?');
/* Explícito, além do ON DELETE CASCADE: uma resposta órfã não some da tela,
   ela fica invisível dentro de um pai que não existe mais. */
const deleteRepliesStmt = db.prepare('DELETE FROM take_comments WHERE parent_id = ?');

/* O portão. */
const takeStmt = db.prepare(
  'SELECT id, reviewer_id FROM episode_takes WHERE id = ? AND club_id = ?'
);
const castVoteStmt = db.prepare(`
  INSERT INTO take_votes (take_id, reviewer_id, value)
  VALUES (?, ?, ?)
  ON CONFLICT(take_id, reviewer_id) DO UPDATE SET
    value = excluded.value, created_at = datetime('now')
`);
const clearVoteStmt = db.prepare(
  'DELETE FROM take_votes WHERE take_id = ? AND reviewer_id = ?'
);

function toCommentDTO(row) {
  return {
    id: row.id,
    /* `takeId` e não `reviewId`, e é a única diferença de forma entre os dois
       lados: a tela que desenha os dois lê o campo pelo nome. */
    takeId: row.take_id,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    reviewerDot: row.reviewer_dot,
    body: row.body,
    parentId: row.parent_id || null,
    createdAt: row.created_at,
  };
}

const toVoteDTO = row => ({
  takeId: row.take_id,
  reviewerId: row.reviewer_id,
  value: Number(row.value),
});

/* Tudo de uma vez, como no outro lado: o acervo de séries desenha dezenas de
   fichas, e uma requisição por ficha seria uma tela feita de esperas. */
router.get('/', clubs.canRead('comments'), wrap(async (req, res) => {
  const [comments, votes, likes] = await Promise.all([
    commentsStmt.all(req.club.id), votesStmt.all(req.club.id), likesStmt.all(req.club.id),
  ]);
  res.json({
    comments: comments.map(toCommentDTO),
    votes: votes.map(toVoteDTO),
    commentLikes: likes.map(row => ({ commentId: row.comment_id, reviewerId: row.reviewer_id })),
  });
}));

router.post('/takes/:takeId/comments', auth.requireSession, clubs.requireMember, throttleComment, wrap(async (req, res) => {
  const take = await takeStmt.get(req.params.takeId, req.club.id);
  if (!take) return res.status(404).json({ error: 'Ficha não encontrada.' });

  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ error: 'Escreva alguma coisa antes de enviar.' });
  if (body.length > MAX_BODY) {
    return res.status(400).json({ error: `Comentário longo demais (máximo ${MAX_BODY} caracteres).` });
  }

  const parentId = req.body?.parentId ?? null;
  if (parentId != null) {
    const parent = await commentOwnerStmt.get(String(parentId), req.club.id);
    if (!parent || parent.take_id !== take.id) {
      return res.status(400).json({ error: 'Não dá para responder a esse comentário.' });
    }
    if (parent.parent_id) {
      return res.status(400).json({ error: 'Uma resposta não recebe resposta — responda o comentário.' });
    }
  }

  const id = 'k' + crypto.randomUUID();
  await insertCommentStmt.run(id, take.id, req.session.reviewer_id, body, parentId ? String(parentId) : null);
  live.emit('shows', req.session.reviewer_id, req.club.id);
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
  live.emit('shows', req.session.reviewer_id, req.club.id);
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
  live.emit('shows', who, req.club.id);
  res.json({ liked });
}));

router.put('/takes/:takeId/vote', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  const take = await takeStmt.get(req.params.takeId, req.club.id);
  if (!take) return res.status(404).json({ error: 'Ficha não encontrada.' });
  if (take.reviewer_id === req.session.reviewer_id) {
    return res.status(403).json({ error: 'Não dá para votar na sua própria ficha.' });
  }

  const value = req.body?.value;
  if (typeof value !== 'number' || ![1, -1, 0].includes(value)) {
    return res.status(400).json({ error: 'Voto inválido.' });
  }

  const voter = req.session.reviewer_id;
  if (value === 0) {
    await clearVoteStmt.run(take.id, voter);
    live.emit('shows', voter, req.club.id);
    return res.json({ vote: null });
  }
  await castVoteStmt.run(take.id, voter, value);
  live.emit('shows', voter, req.club.id);
  res.json({ vote: { takeId: take.id, reviewerId: voter, value } });
}));

module.exports = router;
