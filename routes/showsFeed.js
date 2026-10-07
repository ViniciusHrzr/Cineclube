const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
const { excerpt, seasonEndsOf } = require('../takes');
const clubs = require('../clubs');
const { SEASON_ROW } = require('../show');

const router = express.Router({ mergeParams: true });

const LIMIT = 80;

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
const episodeOf = row => (row.episode === SEASON_ROW ? null : row.episode);
const dayOf = at => String(at || '').slice(0, 10);

const antes = (a, b) => a.season < b.season || (a.season === b.season && a.episode < b.episode);

router.get('/', clubs.requireReadable, wrap(async (req, res) => {
  const [takes, comments] = await Promise.all([
    recentTakes.all(req.club.id),
    recentComments.all(req.club.id),
  ]);

  const items = [];
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
        ends: row.scores ? seasonEndsOf(row.show_genre, row.scores) : null,
        excerpt: row.comment ? excerpt(row.comment) : null,
      });
      continue;
    }

    const chave = `${row.actor_id}|${row.show_id}|${dayOf(at)}`;
    const aberta = juntando.get(chave);
    if (aberta) {
      aberta.count += 1;
      const aqui = { season: row.season, episode: row.episode };
      if (antes(aqui, aberta.from)) aberta.from = aqui;
      if (antes(aberta.to, aqui)) {
        aberta.to = { ...aqui, title: row.episode_title ?? null };
        aberta.takeId = row.id;
      }
      continue;
    }
    const linha = {
      id: `v:${row.id}`,
      kind: 'seen',
      at,
      takeId: row.id,
      actor: actorOf(row),
      showId: Number(row.show_id),
      showTitle: row.show_title,
      showPoster: row.show_poster,
      genre: row.show_genre,
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

  const filtrado =
    req.club.isMember || req.club.visibility === 'public'
      ? items
      : items.filter(i => (i.kind === 'comment' ? req.club.showComments : req.club.showReviews));

  filtrado.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  res.json({ items: filtrado.slice(0, LIMIT) });
}));

module.exports = router;
