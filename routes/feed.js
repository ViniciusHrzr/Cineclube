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

   ── o que entra, e o corte de 26/08/2026 ────────────────────────────────
   Entram avaliação e comentário. Saíram o voto em critério e o filme posto na
   fila, cortados pelo dono depois de usar a primeira versão.

   O motivo é de proporção, e ele é real. Uma avaliação acontece uma vez por
   filme por pessoa. Um comentário é uma vez por pessoa por ideia — alguém
   escreveu, é assunto. Mas um voto acontece até ONZE vezes por ficha por
   pessoa: com seis membros, uma única noite de discussão enterrava a ficha que
   originou a discussão embaixo de quarenta linhas sobre ela. O sinal virava a
   moldura do ruído.

   A curtida em comentário nunca entrou, por ser reação a uma reação. E o voto
   não sumiu da tela: virou contagem na própria ficha, ao lado de quantos
   responderam — que é onde ele significa alguma coisa.

   A fila saiu junto por ser a linha mais fraca das quatro: pôr um filme na fila
   é uma intenção, não um acontecimento, e ela já tem uma aba inteira só dela.

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

const actorOf = row => ({ id: row.actor_id, name: row.actor_name, dot: row.actor_dot });

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
  const [reviews, comments] = await Promise.all([recentReviews.all(), recentComments.all()]);

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

  /* Ordenado depois de juntar: as duas chegam ordenadas entre si e desordenadas
     uma com a outra. Comparação de string funciona porque datetime('now') grava
     YYYY-MM-DD HH:MM:SS, que ordena como texto. */
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  res.json({ items: items.slice(0, LIMIT) });
}));

module.exports = router;
