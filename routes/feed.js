const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
/* As duas regras de leitura de uma ficha moram fora daqui desde que o saguão
   passou a mostrar uma inteira — ver takes.js. */
const { excerpt, endsOf } = require('../takes');
const clubs = require('../clubs');

const router = express.Router({ mergeParams: true });

/* ══════════════════════════════════════════════════════════════════════════
   O mural: o que aconteceu no clube, em ordem de tempo.

   Derivado das tabelas que já existem, sem tabela de evento — pelo mesmo motivo
   do sino, e aqui importa mais, porque um mural é lido por todo mundo: uma
   linha sobre um comentário que não existe mais é o clube inteiro vendo o
   produto mentir.

   ── o que entra, e o que foi cortado ────────────────────────────────────
   Entram avaliação e comentário. O voto em critério saiu por proporção: uma
   avaliação acontece uma vez por filme por pessoa, mas um voto acontecia até
   ONZE vezes por ficha por pessoa — uma noite de discussão enterrava a ficha
   que a originou embaixo de quarenta linhas sobre ela. Ele virou contagem na
   própria ficha, que é onde significa alguma coisa.

   A curtida nunca entrou, por ser reação a uma reação. A fila saiu por ser
   intenção e não acontecimento, e já ter uma aba só dela.

   ── por que a avaliação é a linha rica ──────────────────────────────────
   Um mural que dissesse só "fulano avaliou X — 8,5" seria o feed de qualquer
   um. A linha carrega o mais alto e o mais baixo que a pessoa deu: onde ela se
   entusiasmou e onde se decepcionou, na mesma linha, e é isso que dá assunto.
   ══════════════════════════════════════════════════════════════════════════ */

/** Quantos acontecimentos o mural carrega. Além disto é arquivo, não mural. */
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

  /* `commentId` é o que faz a linha levar ao TEXTO e não só à ficha. Sem ele,
     uma linha sobre uma resposta abria a avaliação certa e parava ali: a
     resposta mora recolhida atrás do "ver N respostas", então o feed anunciava
     um texto e entregava uma gaveta fechada por cima dele.

     `parentId` viaja porque a tela precisa saber que aquilo é resposta para
     dizê-lo na frase. */
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

  /* ── o mural obedece à política de leitura ────────────────────────────
     É a única tela feita de dois tipos de linha, então a única que precisa
     filtrar em vez de responder ou recusar: um clube fechado que mostra as
     avaliações e esconde os comentários tem um mural com metade das linhas.

     Decidido aqui, no servidor: um filtro no cliente seria o dado saindo daqui
     e a tela prometendo não desenhá-lo. */
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

  /* Ordenado depois de juntar: as duas chegam ordenadas entre si e desordenadas
     uma com a outra. Comparação de string funciona porque datetime('now') grava
     YYYY-MM-DD HH:MM:SS, que ordena como texto. */
  filtrado.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  res.json({ items: filtrado.slice(0, LIMIT) });
}));

module.exports = router;
