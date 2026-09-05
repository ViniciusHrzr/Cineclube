const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const auth = require('../auth');
const clubs = require('../clubs');
const wrap = require('../wrap');
const throttle = require('../throttle');
const live = require('../live');

const router = express.Router({ mergeParams: true });

/* ── comentar ─────────────────────────────────────────────────────────────
   O único texto livre que uma pessoa escreve para as outras neste produto, e
   por isso a superfície mais valiosa para quem quiser despejar qualquer coisa
   numa rede social — que é o que este produto está prestes a virar.

   Vinte por minuto. Uma discussão de clube em cima de uma ficha é rápida e
   pode ser em rajada, então o número é folgado: vinte comentários por minuto é
   mais do que qualquer pessoa digita, mesmo brigando. Passar disso não é ter
   opinião, é ter um laço.

   O voto e a curtida não têm trava própria e é de propósito: os dois são uma
   linha com chave primária por (alvo, pessoa), então apertar mil vezes não
   cria mil nada — cria e apaga a mesma linha. O teto de trás em server.js
   cuida do custo de bater na porta. */
const throttleComment = throttle.limit({
  name: 'comment',
  max: 20,
  windowMs: 60_000,
  message: espera => `Muitos comentários seguidos. Tente de novo em ${espera}.`,
});

/* ── o clube entra por baixo ──────────────────────────────────────────────
   Nada aqui tem coluna `club_id`, e é de propósito: um comentário pendura numa
   ficha, e a ficha já sabe de que sala é. Dar a ele uma coluna própria seria
   uma segunda resposta para a mesma pergunta, livre para divergir da primeira.

   O preço é que TODA consulta deste arquivo precisa passar por `reviews` para
   descobrir o clube. É um JOIN a mais e uma disciplina a mais: uma leitura que
   esquecer o JOIN mostra a conversa de outro clube, e uma escrita que esquecer
   deixa alguém comentar dentro de uma sala em que não está. Por isso `reviewStmt`
   — o portão de toda escrita daqui — carrega `club_id` na condição. */

/* ══════════════════════════════════════════════════════════════════════════
   A conversa em cima do que o clube gravou.

   O clube discute filme por voz e a discussão morre com a chamada. Duas coisas
   aqui sobrevivem a ela, e as duas se penduram numa avaliação específica em vez
   de no filme, porque é a ficha de alguém que se discute:

   · um comentário, que é alguém respondendo ao take de outra pessoa;
   · um voto em uma nota isolada — concordar com o 9 dela em fotografia sem
     concordar com o 4 dela em roteiro, que é como a discordância real se
     parece.

   ── por que tudo de uma vez ─────────────────────────────────────────────
   A tela de avaliados desenha o acervo inteiro: quarenta avaliações, cada uma
   com sua conversa e seus votos. Buscar por avaliação seriam quarenta
   requisições para montar uma tela, e um estado de carregando dentro de cada
   gaveta que abre.

   Num clube de quatro pessoas isto é da ordem de centenas de linhas no total,
   então a coleção inteira vai numa resposta só, junto com o resto do clube, e o
   cliente escreve por cima do que ele mesmo acabou de mandar. O dia em que isso
   for grande demais é o dia em que este comentário fica errado.
   ══════════════════════════════════════════════════════════════════════════ */

/** Longo o bastante para um argumento, curto o bastante para não virar ensaio. */
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
/* Explícito, além do ON DELETE CASCADE da coluna. A cascata depende de as
   chaves estrangeiras estarem ligadas, o que é verdade aqui e é uma coisa a
   menos para depender: uma resposta órfã não some da tela, ela fica invisível
   num pai que não existe mais — que é pior do que sumir. */
const deleteRepliesStmt = db.prepare('DELETE FROM review_comments WHERE parent_id = ?');

/* O portão. Toda escrita deste arquivo passa por aqui, e `club_id` na condição
   é o que impede o id de uma ficha de outra sala de ser um jeito de escrever
   dentro dela. */
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
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    reviewerDot: row.reviewer_dot,
    body: row.body,
    /** Null num comentário de primeiro nível; o id do pai numa resposta. */
    parentId: row.parent_id || null,
    createdAt: row.created_at
  };
}

function toVoteDTO(row) {
  return {
    reviewId: row.review_id,
    reviewerId: row.reviewer_id,
    value: Number(row.value)
  };
}

/* Aberto, como todo o resto da leitura neste app. O que o PIN protege é
   escrever: a ameaça aqui é um amigo votando no lugar do outro, não sigilo. */
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

/* ── escrever um comentário ───────────────────────────────────────────────
   Quem assina é a sessão e nunca o corpo, igual à avaliação. Comentar a própria
   avaliação é permitido de propósito: responder a quem te respondeu é metade de
   uma conversa. */
router.post('/reviews/:reviewId/comments', auth.requireSession, clubs.requireMember, throttleComment, wrap(async (req, res) => {
  const review = await reviewStmt.get(req.params.reviewId, req.club.id);
  if (!review) return res.status(404).json({ error: 'Avaliação não encontrada.' });

  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ error: 'Escreva alguma coisa antes de enviar.' });
  if (body.length > MAX_BODY) {
    return res.status(400).json({ error: `Comentário longo demais (máximo ${MAX_BODY} caracteres).` });
  }

  /* ── responder, e só um nível ──────────────────────────────────────────
     O pai tem de existir, tem de estar nesta mesma ficha, e tem de ser um
     comentário de primeiro nível. A terceira condição é o que mantém a
     profundidade em um: sem ela, uma resposta a uma resposta seria aceita e a
     tela teria de decidir na hora de desenhar o que fazer com uma escada que
     ela não sabe desenhar.

     A segunda evita um fio costurado entre duas fichas — uma resposta que
     aparece numa conversa cujo pai está em outra. */
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
  /* Depois da escrita, sempre. Um aviso emitido antes do commit manda o clube
     inteiro buscar um estado que ainda não existe — e não há segundo aviso a
     caminho para consertar isso. Ver live.js. */
  live.emit('social', req.session.reviewer_id, req.club.id);
  res.status(201).json(toCommentDTO(await oneCommentStmt.get(id)));
}));

/* O comentário é de quem escreveu — e do admin, que é quem varre o que não
   deveria estar aqui. Mesma regra da avaliação, uma linha acima na hierarquia:
   apagar o que você disse é desdizer, apagar o que outro disse é moderar. */
router.delete('/comments/:id', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  const row = await commentOwnerStmt.get(req.params.id, req.club.id);
  if (!row) return res.status(404).json({ error: 'Comentário não encontrado.' });
  // Moderar é do ADM da sala em que o texto foi escrito — o da instalação segue
  // valendo por cima, como em todo lugar.
  if (
    row.reviewer_id !== req.session.reviewer_id &&
    !req.club.isClubAdmin &&
    !req.session.is_admin
  ) {
    return res.status(403).json({ error: 'Você só pode apagar os seus comentários.' });
  }
  // As respostas vão junto: uma resposta sem o que ela responde é metade de um
  // diálogo, e ninguém consegue ler a metade que sobrou.
  await deleteRepliesStmt.run(row.id);
  await deleteCommentStmt.run(row.id);
  live.emit('social', req.session.reviewer_id, req.club.id);
  res.status(204).end();
}));

/* ── curtir um comentário ─────────────────────────────────────────────────
   Um estado, não dois: curtido ou não. `liked: false` apaga a linha, que é a
   diferença entre "não curti" e "curti e desfiz" — o contador não deve saber a
   segunda.

   Não se curte o próprio comentário, pela mesma aritmética que impede votar na
   própria ficha: um número que o autor pode somar em si mesmo deixa de contar
   quem concordou. Aqui é mais barato que lá — é vaidade, não distorção — mas a
   regra é a mesma e vale ser uma só. */
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

/* ── concordar com a ficha de alguém ──────────────────────────────────────
   +1, -1, ou 0 para tirar o voto. Zero apaga a linha em vez de gravar um
   neutro, porque "não votei" e "votei em cima do muro" não são a mesma
   informação e o contador não deve inventar a segunda.

   Era um voto por critério, e a rota carregava o `key` na URL. O argumento era
   bom no papel — concordar com o 9 dela em fotografia e achar o 4 em roteiro
   absurdo é o que acontece de verdade — e na prática onze polegares por ficha
   por pessoa não é uma opinião, é um formulário. O que se diz de verdade é
   sobre o take inteiro. Ver a nota em db.js.

   Não se vota na própria ficha. Não é uma regra moral, é aritmética: um placar
   em que o autor pode se somar não mede mais concordância do clube, e o único
   uso de poder fazer isso seria esse. */
router.put('/reviews/:reviewId/vote', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  const review = await reviewStmt.get(req.params.reviewId, req.club.id);
  if (!review) return res.status(404).json({ error: 'Avaliação não encontrada.' });
  if (review.reviewer_id === req.session.reviewer_id) {
    return res.status(403).json({ error: 'Não dá para votar na sua própria avaliação.' });
  }

  /* Um número de verdade, não algo que vira número. `Number(null)` e
     `Number('')` são zero, e zero aqui significa "tira o meu voto" — sem esta
     checagem um corpo malformado apagaria um voto em silêncio em vez de dar
     erro. */
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
  res.json({ vote: { reviewId: review.id, reviewerId: voter, value } });
}));

module.exports = router;
