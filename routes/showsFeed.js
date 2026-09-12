const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
const { excerpt, seasonEndsOf } = require('../takes');
const clubs = require('../clubs');
const { SEASON_ROW } = require('../show');

const router = express.Router({ mergeParams: true });

/* ══════════════════════════════════════════════════════════════════════════
   O mural do universo de séries: o irmão de routes/feed.js, com as mesmas duas
   decisões estruturais — derivado das tabelas que já existem, e ordenado por
   tempo.

   O que muda é a unidade. No universo de filmes o acontecimento é raro; aqui o
   gesto principal é MARCAR VISTO, treze vezes numa noite de maratona. Uma placa
   por episódio seria uma pessoa enterrando o clube inteiro por ter passado o
   domingo com uma série. Então há três tipos de linha:

   · **avaliado** — a ficha com nota, e a linha rica: carrega o mais alto e o
     mais baixo dos nove critérios. É de uma TEMPORADA; as de episódio são de
     quando avaliar era por episódio, e continuam no mural onde sempre
     estiveram.
   · **visto** — AGRUPADO: os episódios que uma pessoa marcou da mesma série no
     mesmo dia são uma linha só. Uma maratona é um acontecimento, não seis.
   · **comentado** — alguém escreveu embaixo da ficha de outra pessoa.

   O agrupamento é aqui e não na tela porque ele muda o QUE é um item: o mural
   tem oitenta, e oitenta linhas de "viu um episódio" gastariam o limite inteiro
   com uma noite de sofá.
   ══════════════════════════════════════════════════════════════════════════ */

/** Quantos acontecimentos o mural carrega. Além disto é arquivo, não mural. */
const LIMIT = 80;

/* Mais linhas do que itens, porque as de "visto" se juntam: sem folga, uma
   maratona de trinta episódios comeria o mural antes de ele começar. */
const ROWS = LIMIT * 4;

const recentTakes = db.prepare(`
  SELECT t.id, t.watched_at, t.rated_at, t.show_id, t.show_title, t.show_poster,
         t.show_genre, t.season, t.episode, t.episode_title, t.scores, t.final, t.comment,
         r.id AS actor_id, r.name AS actor_name, r.dot AS actor_dot
  FROM episode_takes t
  JOIN reviewers r ON r.id = t.reviewer_id
  WHERE t.club_id = ?
  ORDER BY COALESCE(t.rated_at, t.watched_at) DESC
  LIMIT ${ROWS}
`);

const recentComments = db.prepare(`
  SELECT c.id, c.created_at, c.body, c.parent_id,
         a.id AS actor_id, a.name AS actor_name, a.dot AS actor_dot,
         t.id AS take_id, t.show_id, t.show_title, t.show_poster,
         t.season, t.episode, t.episode_title,
         o.name AS owner_name, o.id AS owner_id
  FROM take_comments c
  JOIN episode_takes t ON t.id = c.take_id
  JOIN reviewers a ON a.id = c.reviewer_id
  JOIN reviewers o ON o.id = t.reviewer_id
  WHERE t.club_id = ?
  ORDER BY c.created_at DESC
  LIMIT ${LIMIT}
`);

const actorOf = row => ({ id: row.actor_id, name: row.actor_name, dot: row.actor_dot });
/** Nulo na ficha de uma temporada, que é a linha zero. Ver show.js. */
const episodeOf = row => (row.episode === SEASON_ROW ? null : row.episode);
/** O dia em que a coisa aconteceu, que é a janela do agrupamento. */
const dayOf = at => String(at || '').slice(0, 10);

router.get('/', clubs.requireReadable, wrap(async (req, res) => {
  const [takes, comments] = await Promise.all([
    recentTakes.all(req.club.id),
    recentComments.all(req.club.id),
  ]);

  const items = [];
  /* Os "vistos" abertos, por (pessoa, série, dia). O primeiro do dia cria a
     linha e os seguintes engordam ela — e é o primeiro porque a consulta desce
     do mais novo, então a linha fica com a hora do episódio mais recente
     daquela sessão. */
  const juntando = new Map();

  for (const row of takes) {
    const at = row.rated_at || row.watched_at;
    if (row.final != null) {
      items.push({
        id: `t:${row.id}`,
        kind: 'take',
        at,
        actor: actorOf(row),
        showId: Number(row.show_id),
        showTitle: row.show_title,
        showPoster: row.show_poster,
        season: row.season,
        episode: episodeOf(row),
        episodeTitle: row.episode_title ?? null,
        genre: row.show_genre,
        takeId: row.id,
        final: row.final,
        /* Nulo numa nota rápida: ela não tem critério por dentro, e um alto e
           um baixo inventados a partir de um número só seriam a tela dizendo o
           que ninguém disse. */
        ends: row.scores ? seasonEndsOf(row.show_genre, row.scores) : null,
        excerpt: row.comment ? excerpt(row.comment) : null,
      });
      continue;
    }

    const chave = `${row.actor_id}|${row.show_id}|${dayOf(at)}`;
    const aberta = juntando.get(chave);
    if (aberta) {
      aberta.count += 1;
      /* O menor número visto vira o começo do trecho: "T1E01 a T1E06" é o que
         se lê de uma maratona, e a consulta chega em ordem decrescente. */
      aberta.from = { season: row.season, episode: row.episode };
      continue;
    }
    const linha = {
      id: `v:${row.id}`,
      kind: 'seen',
      at,
      actor: actorOf(row),
      showId: Number(row.show_id),
      showTitle: row.show_title,
      showPoster: row.show_poster,
      genre: row.show_genre,
      /* O episódio mais NOVO da sessão, que é o que a linha nomeia quando ela
         conta um só. */
      to: { season: row.season, episode: row.episode, title: row.episode_title ?? null },
      from: { season: row.season, episode: row.episode },
      count: 1,
    };
    juntando.set(chave, linha);
    items.push(linha);
  }

  for (const row of comments) {
    items.push({
      id: `c:${row.id}`,
      kind: 'comment',
      at: row.created_at,
      actor: actorOf(row),
      showId: Number(row.show_id),
      showTitle: row.show_title,
      showPoster: row.show_poster,
      season: row.season,
      episode: episodeOf(row),
      episodeTitle: row.episode_title ?? null,
      takeId: row.take_id,
      commentId: row.id,
      parentId: row.parent_id || null,
      owner: { id: row.owner_id, name: row.owner_name },
      excerpt: excerpt(row.body),
    });
  }

  /* A mesma política de leitura do mural de filmes, linha a linha: decidir isso
     no cliente seria o dado saindo daqui com a tela prometendo não desenhá-lo. */
  const filtrado =
    req.club.isMember || req.club.visibility === 'public'
      ? items
      : items.filter(i => (i.kind === 'comment' ? req.club.showComments : req.club.showReviews));

  filtrado.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  res.json({ items: filtrado.slice(0, LIMIT) });
}));

module.exports = router;
