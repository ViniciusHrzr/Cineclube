const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const clubs = require('../clubs');
const wrap = require('../wrap');
const throttle = require('../throttle');
const live = require('../live');
const series = require('../series');
const upnext = require('../upnext');
const { providerCache } = require('../providers');
const { GENRES, seasonCritsFor, seasonFinalOf, seasonAnsweredIn } = require('../criteria');
const {
  cleanShow, cleanEpisodeRef, cleanSeasonRef, text, SEASON_ROW, MAX_EPISODE_TITLE,
} = require('../show');

const router = express.Router({ mergeParams: true });

const throttleQueue = throttle.limit({
  name: 'show-queue',
  max: 60,
  windowMs: 60 * 60_000,
  message: espera => `Muitas séries postas na fila seguidas. Tente de novo em ${espera}.`,
});

const throttleTake = throttle.limit({
  name: 'episode-take',
  max: 400,
  windowMs: 60 * 60_000,
  message: espera => `Muitos episódios marcados seguidos. Tente de novo em ${espera}.`,
});

const queueStmt = db.prepare(`
  SELECT q.*, sc.original_title, sc.english_title, sc.status, sc.episodes AS total_episodes
  FROM show_queue q
  LEFT JOIN shows_cache sc ON sc.tmdb_id = q.show_id
  WHERE q.club_id = ?
  ORDER BY q.position IS NULL, q.position ASC, q.added_at DESC
`);

const insertQueue = db.prepare(`
  INSERT INTO show_queue (club_id, show_id, show_title, show_year, show_genre, show_poster, position, added_by)
  VALUES (@clubId, @showId, @showTitle, @showYear, @showGenre, @showPoster,
          COALESCE(
            (SELECT MIN(position) FROM show_queue WHERE club_id = @clubId AND show_id = @showId),
            (SELECT COALESCE(MAX(position), -1) + 1 FROM show_queue WHERE club_id = @clubId)),
          @addedBy)
  ON CONFLICT(club_id, show_id, added_by) DO NOTHING
`);

const queueWantersStmt = db.prepare(`
  SELECT q.show_id, q.show_title, q.added_by, r.name AS added_by_name
  FROM show_queue q
  LEFT JOIN reviewers r ON r.id = q.added_by
  WHERE q.club_id = ? AND q.show_id = ?
  ORDER BY q.added_at ASC
`);
const deleteMineQueue = db.prepare('DELETE FROM show_queue WHERE club_id = ? AND show_id = ? AND added_by = ?');
const deleteQueue = db.prepare('DELETE FROM show_queue WHERE club_id = ? AND show_id = ?');

const progressStmt = db.prepare(`
  SELECT show_id,
         COUNT(DISTINCT CASE WHEN episode <> ${SEASON_ROW} THEN season || 'x' || episode END) AS seen,
         COUNT(DISTINCT CASE WHEN episode = ${SEASON_ROW} AND final IS NOT NULL THEN season END) AS rated,
         AVG(final) AS average
  FROM episode_takes
  WHERE club_id = ?
  GROUP BY show_id
`);

const takesForShow = db.prepare(`
  SELECT t.*, r.name AS reviewer_name, r.dot AS reviewer_dot
  FROM episode_takes t
  JOIN reviewers r ON r.id = t.reviewer_id
  WHERE t.club_id = ? AND t.show_id = ?
  ORDER BY t.season ASC, t.episode ASC, t.watched_at ASC
`);

const allTakes = db.prepare(`
  SELECT t.*, r.name AS reviewer_name, r.dot AS reviewer_dot
  FROM episode_takes t
  JOIN reviewers r ON r.id = t.reviewer_id
  WHERE t.club_id = ?
  ORDER BY t.watched_at DESC
`);

const getTake = db.prepare(`
  SELECT * FROM episode_takes
  WHERE club_id = ? AND reviewer_id = ? AND show_id = ? AND season = ? AND episode = ?
`);

const markEpisode = db.prepare(`
  INSERT INTO episode_takes
    (id, club_id, reviewer_id, show_id, show_title, show_poster, show_genre,
     season, episode, episode_title, watched_at)
  VALUES
    (@id, @clubId, @reviewerId, @showId, @showTitle, @showPoster, @showGenre,
     @season, @episode, @episodeTitle, datetime('now'))
  ON CONFLICT(club_id, reviewer_id, show_id, season, episode) DO UPDATE SET
    show_title = excluded.show_title,
    show_poster = excluded.show_poster,
    show_genre = excluded.show_genre,
    episode_title = COALESCE(excluded.episode_title, episode_takes.episode_title)
`);

const upsertSeasonTake = db.prepare(`
  INSERT INTO episode_takes
    (id, club_id, reviewer_id, show_id, show_title, show_poster, show_genre,
     season, episode, scores, quick, final, comment, watched_at, rated_at)
  VALUES
    (@id, @clubId, @reviewerId, @showId, @showTitle, @showPoster, @showGenre,
     @season, @episode, @scores, @quick, @final, @comment,
     datetime('now'), @ratedAt)
  ON CONFLICT(club_id, reviewer_id, show_id, season, episode) DO UPDATE SET
    show_title = excluded.show_title,
    show_poster = excluded.show_poster,
    show_genre = excluded.show_genre,
    scores = excluded.scores,
    quick = excluded.quick,
    final = excluded.final,
    comment = excluded.comment,
    rated_at = excluded.rated_at
`);

const deleteTake = db.prepare(`
  DELETE FROM episode_takes
  WHERE club_id = ? AND reviewer_id = ? AND show_id = ? AND season = ? AND episode = ?
`);

function queueDTO(row, progress) {
  const p = progress.get(Number(row.show_id));
  return {
    id: row.show_id,
    title: row.show_title,
    original: row.original_title ?? null,
    english: row.english_title ?? null,
    year: row.show_year,
    genre: row.show_genre,
    poster: row.show_poster,
    status: row.status ?? null,
    totalEpisodes: row.total_episodes ?? null,
    addedAt: row.added_at,
    wanters: row.added_by ? [row.added_by] : [],
    seen: p?.seen ?? 0,
    rated: p?.rated ?? 0,
    average: p?.average ?? null,
    upNext: null,
    upcoming: null,
    caughtUp: false,
  };
}

function toQueue(rows, progress) {
  const shows = new Map();
  for (const row of rows) {
    const held = shows.get(row.show_id);
    if (!held) shows.set(row.show_id, queueDTO(row, progress));
    else if (row.added_by && !held.wanters.includes(row.added_by)) held.wanters.push(row.added_by);
  }
  return [...shows.values()];
}

function takeDTO(row) {
  const genre = GENRES.includes(row.show_genre) ? row.show_genre : 'Drama';
  const scores = row.scores ? JSON.parse(row.scores) : null;
  const breakdown = scores
    ? seasonAnsweredIn(genre, scores).map(c => ({
        key: c.key, name: c.name, w: c.w, group: c.group, value: scores[c.key],
      }))
    : [];
  const season = row.episode === SEASON_ROW;
  return {
    id: row.id,
    showId: row.show_id,
    showTitle: row.show_title,
    showPoster: row.show_poster,
    genre: row.show_genre,
    kind: season ? 'season' : 'episode',
    season: row.season,
    episode: season ? null : row.episode,
    episodeTitle: row.episode_title ?? null,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    reviewerDot: row.reviewer_dot,
    scores,
    quick: row.quick ?? null,
    final: row.final ?? null,
    comment: row.comment ?? null,
    watchedAt: row.watched_at,
    ratedAt: row.rated_at ?? null,
    breakdown,
  };
}

async function progressMap(clubId) {
  const rows = await progressStmt.all(clubId);
  return new Map(rows.map(r => [Number(r.show_id), {
    seen: Number(r.seen), rated: Number(r.rated),
    average: r.average != null ? Number(r.average) : null,
  }]));
}

const fillProviders = providerCache({
  table: 'shows_cache',
  kind: 'show',
  fetch: id => series.watchProvidersFor(id),
});

router.get('/', clubs.requireReadable, wrap(async (req, res) => {
  const [rows, progress] = await Promise.all([
    queueStmt.all(req.club.id),
    progressMap(req.club.id),
  ]);
  const shows = toQueue(rows, progress);
  await fillProviders(shows);
  if (req.session?.reviewer_id) {
    await upnext.fill(shows, { clubId: req.club.id, reviewerId: req.session.reviewer_id });
  }
  res.json({ shows });
}));

router.post('/', auth.requireSession, clubs.requireMember, throttleQueue, wrap(async (req, res) => {
  const limpo = cleanShow(req.body?.show);
  if (limpo.error) return res.status(400).json({ error: limpo.error });
  const show = limpo.show;

  await insertQueue.run({
    clubId: req.club.id,
    showId: show.id, showTitle: show.title, showYear: show.year,
    showGenre: show.genre, showPoster: show.poster,
    addedBy: req.session.reviewer_id,
  });
  live.emit('shows', req.session.reviewer_id, req.club.id);
  res.status(201).json({ ok: true });
}));

router.delete('/:showId(\\d+)', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  const rows = await queueWantersStmt.all(req.club.id, Number(req.params.showId));
  if (!rows.length) return res.status(204).end();

  const showId = rows[0].show_id;
  const mine = rows.some(r => r.added_by && r.added_by === req.session.reviewer_id);
  if (!mine && !req.club.isClubAdmin && !req.session.is_admin) {
    const names = [...new Set(rows.map(r => r.added_by_name).filter(Boolean))];
    return res.status(403).json({
      error: names.length
        ? `Cada um tira o seu, e ${rows[0].show_title} está na lista de ${names.join(', ')}.`
        : 'Esta série entrou na fila antes de ela registrar quem põe. Só o administrador do clube pode tirar.',
    });
  }

  if (mine) await deleteMineQueue.run(req.club.id, showId, req.session.reviewer_id);
  else await deleteQueue.run(req.club.id, showId);
  live.emit('shows', req.session.reviewer_id, req.club.id);
  res.status(204).end();
}));

router.get('/takes', clubs.requireReadable, wrap(async (req, res) => {
  const rows = await allTakes.all(req.club.id);
  res.json({ takes: rows.map(takeDTO) });
}));

router.get('/:showId(\\d+)/takes', clubs.requireReadable, wrap(async (req, res) => {
  const rows = await takesForShow.all(req.club.id, Number(req.params.showId));
  res.json({ takes: rows.map(takeDTO) });
}));

router.put(
  '/:showId(\\d+)/:season(\\d+)/:episode(\\d+)',
  auth.requireSession, clubs.requireMember, throttleTake,
  wrap(async (req, res) => {
    const limpo = cleanEpisodeRef(req.params);
    if (limpo.error) return res.status(400).json({ error: limpo.error });
    const { showId, season, episode } = limpo.ref;

    const body = req.body || {};
    if (body.scores || body.quick != null) {
      return res.status(400).json({ error: 'A avaliação agora é da temporada, não do episódio.' });
    }

    const genre = GENRES.includes(body.genre) ? body.genre : 'Drama';

    const showTitle = text(body.showTitle, 300);
    if (!showTitle) return res.status(400).json({ error: 'Série inválida.' });
    const showPoster = text(body.showPoster, 500);
    const episodeTitle = text(body.episodeTitle, MAX_EPISODE_TITLE);

    const existing = await getTake.get(
      req.club.id, req.session.reviewer_id, showId, season, episode
    );

    await markEpisode.run({
      id: existing?.id || 'e' + crypto.randomUUID(),
      clubId: req.club.id,
      reviewerId: req.session.reviewer_id,
      showId, showTitle, showPoster, showGenre: genre,
      season, episode, episodeTitle,
    });

    const saved = await getTake.get(
      req.club.id, req.session.reviewer_id, showId, season, episode
    );
    live.emit('shows', req.session.reviewer_id, req.club.id);
    res.status(existing ? 200 : 201).json({ take: takeDTO({ ...saved, reviewer_name: null, reviewer_dot: null }) });
  })
);

router.put(
  '/:showId(\\d+)/:season(\\d+)',
  auth.requireSession, clubs.requireMember, throttleTake,
  wrap(async (req, res) => {
    const limpo = cleanSeasonRef(req.params);
    if (limpo.error) return res.status(400).json({ error: limpo.error });
    const { showId, season, episode } = limpo.ref;

    const body = req.body || {};
    const genre = GENRES.includes(body.genre) ? body.genre : 'Drama';

    const showTitle = text(body.showTitle, 300);
    if (!showTitle) return res.status(400).json({ error: 'Série inválida.' });
    const showPoster = text(body.showPoster, 500);

    let scores = null;
    let quick = null;
    let final = null;

    if (body.scores && typeof body.scores === 'object') {
      const allowed = new Set(seasonCritsFor(genre).map(c => c.key));
      const clean = {};
      for (const [key, value] of Object.entries(body.scores)) {
        if (!allowed.has(key)) continue;
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0 || n > 10) continue;
        clean[key] = n;
      }
      if (!Object.keys(clean).length) {
        return res.status(400).json({ error: 'A avaliação criteriosa não trouxe nenhuma nota.' });
      }
      scores = JSON.stringify(clean);
      final = seasonFinalOf(genre, clean);
    } else if (body.quick !== undefined && body.quick !== null) {
      const n = Number(body.quick);
      if (!Number.isFinite(n) || n < 0 || n > 10) {
        return res.status(400).json({ error: 'A nota tem de estar entre 0 e 10.' });
      }
      quick = n;
      final = n;
    } else {
      return res.status(400).json({ error: 'Uma avaliação de temporada precisa de uma nota.' });
    }

    const existing = await getTake.get(
      req.club.id, req.session.reviewer_id, showId, season, episode
    );

    await upsertSeasonTake.run({
      id: existing?.id || 'e' + crypto.randomUUID(),
      clubId: req.club.id,
      reviewerId: req.session.reviewer_id,
      showId, showTitle, showPoster, showGenre: genre,
      season, episode,
      scores, quick, final,
      comment: text(body.comment, 2000),
      ratedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });

    const saved = await getTake.get(
      req.club.id, req.session.reviewer_id, showId, season, episode
    );
    live.emit('shows', req.session.reviewer_id, req.club.id);
    res.status(existing ? 200 : 201).json({ take: takeDTO({ ...saved, reviewer_name: null, reviewer_dot: null }) });
  })
);

router.delete(
  '/:showId(\\d+)/:season(\\d+)/:episode(\\d+)',
  auth.requireSession, clubs.requireMember,
  wrap(async (req, res) => {
    const limpo = cleanEpisodeRef(req.params);
    if (limpo.error) return res.status(400).json({ error: limpo.error });
    const { showId, season, episode } = limpo.ref;
    await deleteTake.run(req.club.id, req.session.reviewer_id, showId, season, episode);
    live.emit('shows', req.session.reviewer_id, req.club.id);
    res.status(204).end();
  })
);

router.delete(
  '/:showId(\\d+)/:season(\\d+)',
  auth.requireSession, clubs.requireMember,
  wrap(async (req, res) => {
    const limpo = cleanSeasonRef(req.params);
    if (limpo.error) return res.status(400).json({ error: limpo.error });
    const { showId, season, episode } = limpo.ref;
    await deleteTake.run(req.club.id, req.session.reviewer_id, showId, season, episode);
    live.emit('shows', req.session.reviewer_id, req.club.id);
    res.status(204).end();
  })
);

module.exports = router;
