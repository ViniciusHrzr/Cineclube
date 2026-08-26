const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
const { critsFor, GENRES } = require('../criteria');

const router = express.Router();

/* ══════════════════════════════════════════════════════════════════════════
   O mural: o que aconteceu no clube, em ordem de tempo.

   O produto tinha três coisas que PRODUZEM sinal social — comentário, curtida,
   aviso — e nenhuma que o exibisse coletivamente. O sino é a única janela para
   tudo isso e ele é privado: se a Beren avaliou ontem à noite e o Leonardo
   discordou da montagem dela, ninguém além dos dois fica sabendo.

   ── o mesmo desenho do sino, e pelo mesmo motivo ────────────────────────
   Derivado das tabelas que já existem, sem tabela de evento. Um mural gravado
   no momento em que a coisa acontece é a mesma verdade em dois lugares, e o
   segundo é o que envelhece: uma avaliação apagada deixaria para trás a linha
   que anunciou que ela existiu.

   Aqui isso importa mais do que no sino, porque um mural é lido por todo mundo:
   uma linha sobre um comentário que não existe mais é o clube inteiro vendo o
   produto mentir.

   ── o que entra, e o que não entra ──────────────────────────────────────
   Entram avaliação, comentário, voto em critério e filme posto na fila. Fica de
   fora a curtida em comentário: ela é reação a uma reação, e um mural que
   anuncia "fulano curtiu o comentário que beltrano fez sobre a ficha de
   cicrano" é ruído com três níveis de profundidade. A curtida continua visível
   onde ela significa alguma coisa, que é ao lado do comentário.

   ── por que a avaliação é a linha rica ──────────────────────────────────
   Porque é o que este produto tem de próprio. Onze critérios por ficha
   descrevem uma opinião com uma precisão que nenhum outro app de filme tem, e
   um mural que dissesse só "fulano avaliou X — 8,5" seria o feed de qualquer
   um. Então a linha carrega o mais alto e o mais baixo que a pessoa deu: é onde
   ela se entusiasmou e onde ela se decepcionou, na mesma linha, e é isso que dá
   assunto.
   ══════════════════════════════════════════════════════════════════════════ */

/** Quantos acontecimentos o mural carrega. Além disto é arquivo, não mural. */
const LIMIT = 80;

const recentReviews = db.prepare(`
  SELECT rv.id, rv.recorded_at, rv.movie_id, rv.movie_title, rv.movie_poster,
         rv.movie_genre, rv.scores, rv.final, rv.comment,
         r.id AS actor_id, r.name AS actor_name, r.dot AS actor_dot
  FROM reviews rv
  JOIN reviewers r ON r.id = rv.reviewer_id
  ORDER BY rv.recorded_at DESC
  LIMIT ${LIMIT}
`);

const recentComments = db.prepare(`
  SELECT c.id, c.created_at, c.body,
         a.id AS actor_id, a.name AS actor_name, a.dot AS actor_dot,
         rv.id AS review_id, rv.movie_id, rv.movie_title, rv.movie_poster,
         o.name AS owner_name, o.id AS owner_id
  FROM review_comments c
  JOIN reviews rv ON rv.id = c.review_id
  JOIN reviewers a ON a.id = c.reviewer_id
  JOIN reviewers o ON o.id = rv.reviewer_id
  ORDER BY c.created_at DESC
  LIMIT ${LIMIT}
`);

const recentVotes = db.prepare(`
  SELECT v.criterion_key, v.value, v.created_at,
         a.id AS actor_id, a.name AS actor_name, a.dot AS actor_dot,
         rv.id AS review_id, rv.movie_id, rv.movie_title, rv.movie_poster,
         rv.movie_genre, o.name AS owner_name, o.id AS owner_id
  FROM criterion_votes v
  JOIN reviews rv ON rv.id = v.review_id
  JOIN reviewers a ON a.id = v.reviewer_id
  JOIN reviewers o ON o.id = rv.reviewer_id
  ORDER BY v.created_at DESC
  LIMIT ${LIMIT}
`);

/* Só a fila que sabe de quem foi a ideia. Linhas anteriores à coluna ficam de
   fora: "alguém pôs isto na fila" não é um acontecimento. */
const recentQueued = db.prepare(`
  SELECT w.movie_id, w.movie_title, w.movie_poster, w.added_at,
         r.id AS actor_id, r.name AS actor_name, r.dot AS actor_dot
  FROM watchlist w
  JOIN reviewers r ON r.id = w.added_by
  ORDER BY w.added_at DESC
  LIMIT ${LIMIT}
`);

const actorOf = row => ({ id: row.actor_id, name: row.actor_name, dot: row.actor_dot });

const criterionName = (genre, key) => {
  const named = GENRES.includes(genre) ? genre : 'Drama';
  return critsFor(named).find(c => c.key === key)?.name ?? key;
};

function excerpt(body, max = 120) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut) + '…';
}

/* ── onde a pessoa se entusiasmou e onde se decepcionou ───────────────────
   O par mais alto e mais baixo da ficha, com o nome que o gênero dá ao
   critério. Só quando há distância entre eles: uma ficha de onze notas iguais
   não tem alto nem baixo, tem uma nota, e apontar dois critérios ali seria
   inventar uma opinião que a pessoa não teve.

   Meio ponto é o menor passo que o controle permite, então uma diferença menor
   que isso não existe. Exijo um ponto inteiro: abaixo disso o "mais alto" é
   ruído de arredondamento e não uma preferência. */
const SPREAD = 1;

function endsOf(genre, raw) {
  let scores;
  try {
    scores = JSON.parse(raw) || {};
  } catch {
    return null;
  }
  const marked = critsFor(GENRES.includes(genre) ? genre : 'Drama')
    .map(c => ({ name: c.name, value: scores[c.key] }))
    .filter(c => typeof c.value === 'number');
  if (marked.length < 3) return null;

  const high = marked.reduce((a, b) => (b.value > a.value ? b : a));
  const low = marked.reduce((a, b) => (b.value < a.value ? b : a));
  if (high.value - low.value < SPREAD) return null;
  return { high, low };
}

router.get('/', wrap(async (req, res) => {
  const [reviews, comments, votes, queued] = await Promise.all([
    recentReviews.all(), recentComments.all(), recentVotes.all(), recentQueued.all()
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
      owner: { id: row.owner_id, name: row.owner_name },
      excerpt: excerpt(row.body)
    });
  }

  for (const row of votes) {
    items.push({
      id: `v:${row.review_id}:${row.criterion_key}:${row.actor_id}`,
      kind: 'vote',
      at: row.created_at,
      actor: actorOf(row),
      movieId: Number(row.movie_id),
      movieTitle: row.movie_title,
      moviePoster: row.movie_poster,
      reviewId: row.review_id,
      owner: { id: row.owner_id, name: row.owner_name },
      value: Number(row.value),
      criterion: criterionName(row.movie_genre, row.criterion_key)
    });
  }

  for (const row of queued) {
    items.push({
      id: `q:${row.movie_id}`,
      kind: 'queued',
      at: row.added_at,
      actor: actorOf(row),
      movieId: Number(row.movie_id),
      movieTitle: row.movie_title,
      moviePoster: row.movie_poster
    });
  }

  /* Ordenado depois de juntar: as quatro chegam ordenadas entre si e
     desordenadas umas com as outras. Comparação de string funciona porque
     datetime('now') grava YYYY-MM-DD HH:MM:SS, que ordena como texto. */
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  res.json({ items: items.slice(0, LIMIT) });
}));

module.exports = router;
