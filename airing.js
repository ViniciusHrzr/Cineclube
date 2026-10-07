const db = require('./db');

const AGORA_BR = "datetime('now', '-3 hours')";

const listadoNoClube = db.prepare(`
  SELECT q.show_id, q.show_title, q.show_poster,
         e.season, e.episode, e.title AS episode_title, e.air_date
  FROM show_queue q
  JOIN episodes_cache e ON e.show_id = q.show_id
  WHERE q.club_id = ? AND q.added_by = ? AND e.air_date = date(${AGORA_BR})
`);

const anunciadoNoClube = db.prepare(`
  SELECT q.show_id, q.show_title, q.show_poster, sc.shape, date(${AGORA_BR}) AS hoje
  FROM show_queue q
  JOIN shows_cache sc ON sc.tmdb_id = q.show_id
  WHERE q.club_id = ? AND q.added_by = ? AND sc.shape IS NOT NULL
`);

const listadoGeral = db.prepare(`
  SELECT DISTINCT q.added_by AS reviewer_id, q.show_id, q.show_title, q.show_poster,
         e.season, e.episode, e.title AS episode_title, e.air_date
  FROM show_queue q
  JOIN episodes_cache e ON e.show_id = q.show_id
  WHERE q.added_by <> '' AND e.air_date = date(${AGORA_BR})
`);

const anunciadoGeral = db.prepare(`
  SELECT DISTINCT q.added_by AS reviewer_id, q.show_id, q.show_title, q.show_poster,
         sc.shape, date(${AGORA_BR}) AS hoje
  FROM show_queue q
  JOIN shows_cache sc ON sc.tmdb_id = q.show_id
  WHERE q.added_by <> '' AND sc.shape IS NOT NULL
`);

const epDe = row => ({
  showId: Number(row.show_id),
  showTitle: row.show_title,
  showPoster: row.show_poster,
  season: Number(row.season),
  episode: Number(row.episode),
  episodeTitle: row.episode_title ?? null,
  airDate: row.air_date,
});

function merge(listed, announced, chaveDe = () => '') {
  const por = new Map();
  for (const row of listed) {
    por.set(`${chaveDe(row)}${row.show_id}:${row.season}x${row.episode}`, {
      ...epDe(row),
      reviewerId: row.reviewer_id,
    });
  }
  for (const row of announced) {
    let shape;
    try {
      shape = JSON.parse(row.shape);
    } catch {
      continue;
    }
    const vem = shape?.nextAir;
    if (!vem || vem.airDate !== row.hoje) continue;
    const chave = `${chaveDe(row)}${row.show_id}:${vem.season}x${vem.episode}`;
    if (por.has(chave)) continue;
    por.set(chave, {
      showId: Number(row.show_id),
      showTitle: row.show_title,
      showPoster: row.show_poster,
      season: vem.season,
      episode: vem.episode,
      episodeTitle: vem.title ?? null,
      airDate: vem.airDate,
      reviewerId: row.reviewer_id,
    });
  }
  return [...por.values()];
}

async function forQueue(clubId, reviewerId) {
  const [listed, announced] = await Promise.all([
    listadoNoClube.all(clubId, reviewerId),
    anunciadoNoClube.all(clubId, reviewerId),
  ]);
  return merge(listed, announced);
}

async function todayByReviewer() {
  const [listed, announced] = await Promise.all([listadoGeral.all(), anunciadoGeral.all()]);
  const tudo = merge(listed, announced, row => `${row.reviewer_id}|`);

  const por = new Map();
  for (const item of tudo) {
    const held = por.get(item.reviewerId);
    if (held) held.push(item);
    else por.set(item.reviewerId, [item]);
  }
  return por;
}

const tagOf = ep => `T${ep.season}E${String(ep.episode).padStart(2, '0')}`;

module.exports = { forQueue, todayByReviewer, tagOf };
