const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const clubs = require('../clubs');
const wrap = require('../wrap');
const screening = require('../screening');
const turn = require('../turn');
const live = require('../live');
const { cleanEpisodeRef } = require('../show');
const { GENRES } = require('../criteria');

const router = express.Router({ mergeParams: true });

router.use(auth.requireSession, clubs.requireMember);

const roomOf = req => screening.roomFor(req.club.id);

const cachedStmt = db.prepare('SELECT tmdb_id, title, year, genre, poster, runtime FROM movies_cache WHERE tmdb_id = ?');
const queuedStmt = db.prepare(
  'SELECT movie_id, movie_title, movie_year, movie_genre, movie_poster FROM watchlist WHERE club_id = ? AND movie_id = ?'
);

async function movieById(clubId, id) {
  const cached = await cachedStmt.get(id);
  if (cached) {
    return {
      kind: 'movie',
      id: Number(cached.tmdb_id),
      title: cached.title,
      year: cached.year ?? null,
      genre: cached.genre,
      poster: cached.poster ?? null,
      runtime: cached.runtime ?? null,
    };
  }
  const queued = await queuedStmt.get(clubId, id);
  if (queued) {
    return {
      kind: 'movie',
      id: Number(queued.movie_id),
      title: queued.movie_title,
      year: queued.movie_year ?? null,
      genre: queued.movie_genre,
      poster: queued.movie_poster ?? null,
      runtime: null,
    };
  }
  return null;
}

const cachedEpisodeStmt = db.prepare(`
  SELECT title, runtime FROM episodes_cache
  WHERE show_id = ? AND season = ? AND episode = ?
`);
const cachedShowStmt = db.prepare(
  'SELECT tmdb_id, title, year, genre, poster, runtime FROM shows_cache WHERE tmdb_id = ?'
);
const queuedShowStmt = db.prepare(
  'SELECT show_id, show_title, show_year, show_genre, show_poster FROM show_queue WHERE club_id = ? AND show_id = ?'
);

async function episodeById(clubId, showId, season, episode) {
  const found = await cachedEpisodeStmt.get(showId, season, episode);
  if (!found) return null;

  const show =
    (await cachedShowStmt.get(showId)) ??
    (await queuedShowStmt.get(clubId, showId).then(q =>
      q
        ? {
            tmdb_id: q.show_id,
            title: q.show_title,
            year: q.show_year,
            genre: q.show_genre,
            poster: q.show_poster,
            runtime: null,
          }
        : null
    ));
  if (!show) return null;

  return {
    kind: 'episode',
    id: Number(show.tmdb_id),
    title: show.title,
    year: show.year ?? null,
    genre: show.genre,
    poster: show.poster ?? null,
    runtime: found.runtime ?? show.runtime ?? null,
    season,
    episode,
    episodeTitle: found.title ?? null,
  };
}

const seenStmt = db.prepare(`
  INSERT INTO episode_takes
    (id, club_id, reviewer_id, show_id, show_title, show_poster, show_genre,
     season, episode, episode_title, watched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(club_id, reviewer_id, show_id, season, episode) DO NOTHING
`);

async function closeEpisode(room) {
  const leaving = room.movie;
  if (!room.open || leaving?.kind !== 'episode' || !room.viewers.size) return false;

  const genre = GENRES.includes(leaving.genre) ? leaving.genre : 'Drama';
  for (const reviewerId of room.viewers.keys()) {
    try {
      await seenStmt.run(
        'e' + crypto.randomUUID(),
        room.clubId,
        reviewerId,
        leaving.id,
        leaving.title,
        leaving.poster ?? null,
        genre,
        leaving.season,
        leaving.episode,
        leaving.episodeTitle ?? null
      );
    } catch (e) {
      console.warn('[screening] falha ao marcar visto de', reviewerId, e.message);
    }
  }
  return true;
}

router.get('/', wrap(async (req, res) => {
  res.json(screening.snapshot(roomOf(req)));
}));

router.get('/time', (_req, res) => {
  res.json({ t: Date.now() });
});

router.get('/stream', (req, res) => {
  const room = roomOf(req);
  if (!screening.canSubscribe(room, req.session.reviewer_id)) {
    return res.status(429).json({ error: 'Conexões demais. Feche outras abas do Cineclube.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  req.socket.setTimeout(0);
  req.socket.setNoDelay?.(true);

  screening.startTimers();
  screening.attach(room, req.session);
  screening.subscribe(room, res, req.session.reviewer_id);

  let gone = false;
  const leave = () => {
    if (gone) return;
    gone = true;
    screening.unsubscribe(room, res);
    screening.detach(room, req.session.reviewer_id);
  };
  req.on('close', leave);
  res.on('close', leave);
});

router.post('/open', wrap(async (req, res) => {
  const asEpisode = req.body?.showId !== undefined;
  const movieId = asEpisode ? null : Number(req.body?.movieId);
  if (!asEpisode && !Number.isInteger(movieId)) {
    return res.status(400).json({ error: 'Filme inválido.' });
  }

  const ref = asEpisode ? cleanEpisodeRef(req.body) : null;
  if (ref?.error) return res.status(400).json({ error: ref.error });

  const room = roomOf(req);
  if (room.open && !screening.isHost(room, req.session.reviewer_id)) {
    return res.status(403).json({ error: `${room.host.name} está com o controle da sessão.` });
  }

  const movie = asEpisode
    ? await episodeById(req.club.id, ref.ref.showId, ref.ref.season, ref.ref.episode)
    : await movieById(req.club.id, movieId);
  if (!movie) {
    return res.status(404).json({
      error: asEpisode
        ? 'Episódio não encontrado. Abra a temporada uma vez e tente de novo.'
        : 'Filme não encontrado no catálogo do clube.',
    });
  }

  const fechou = await closeEpisode(room);

  screening.open(roomOf(req), movie, {
    id: req.session.reviewer_id,
    name: req.session.name,
    dot: req.session.dot,
  });
  live.emit('screening', req.session.reviewer_id, req.club.id);
  if (fechou) live.emit('shows', req.session.reviewer_id, req.club.id);
  res.status(201).json(screening.snapshot(roomOf(req)));
}));

router.post('/close', wrap(async (req, res) => {
  const room = roomOf(req);
  if (!screening.isHost(room, req.session.reviewer_id)) {
    return res.status(403).json({ error: `A sessão é de ${room.host.name}. Só quem abriu pode encerrar.` });
  }
  screening.close(room);
  live.emit('screening', req.session.reviewer_id, req.club.id);
  res.json(screening.snapshot(room));
}));

router.post('/command', wrap(async (req, res) => {
  if (!screening.withinRate(req.session.reviewer_id)) {
    return res.status(429).json({ error: 'Comandos demais em pouco tempo.' });
  }

  const { type } = req.body || {};
  if (!screening.COMMANDS.has(type)) return res.status(400).json({ error: 'Comando inválido.' });

  const raw = req.body?.position;
  const position = raw == null ? null : Number(raw);
  if (position != null && !Number.isFinite(position)) {
    return res.status(400).json({ error: 'Posição inválida.' });
  }

  if (!screening.isHost(roomOf(req), req.session.reviewer_id)) {
    return res
      .status(403)
      .json({ error: `${roomOf(req).host.name} está com o controle da sessão.` });
  }

  const room = roomOf(req);
  const was = room.status;
  if (!screening.command(room, type, position)) {
    return res.status(409).json({ error: 'Nenhuma sessão aberta.' });
  }
  if (room.status !== was) live.emit('screening', req.session.reviewer_id, req.club.id);
  res.json(screening.snapshot(room));
}));

router.post('/link', wrap(async (req, res) => {
  if (!screening.withinRate(req.session.reviewer_id)) {
    return res.status(429).json({ error: 'Comandos demais em pouco tempo.' });
  }
  const room = roomOf(req);
  if (!room.open) return res.status(409).json({ error: 'Nenhuma sessão aberta.' });

  const { link } = req.body || {};
  if (!screening.setLink(room, link === null || link === undefined ? null : link)) {
    return res.status(400).json({ error: 'Link inválido — só magnet ou URL http(s), até 4 KB.' });
  }
  res.json(screening.snapshot(room));
}));

router.get('/subtitle', (req, res) => {
  const subtitle = roomOf(req).subtitle;
  if (!subtitle) return res.status(404).json({ error: 'A sessão não tem legenda.' });
  res.json(subtitle);
});

router.post('/subtitle', wrap(async (req, res) => {
  if (!screening.withinRate(req.session.reviewer_id)) {
    return res.status(429).json({ error: 'Comandos demais em pouco tempo.' });
  }
  const room = roomOf(req);
  if (!room.open) return res.status(409).json({ error: 'Nenhuma sessão aberta.' });

  const { subtitle } = req.body || {};
  if (!screening.setSubtitle(room, subtitle === null || subtitle === undefined ? null : subtitle)) {
    return res.status(400).json({ error: 'Legenda inválida — precisa de nome e texto, até 512 KB.' });
  }
  res.json(screening.snapshot(room));
}));

router.post('/live', wrap(async (req, res) => {
  if (!screening.withinRate(req.session.reviewer_id)) {
    return res.status(429).json({ error: 'Comandos demais em pouco tempo.' });
  }
  const room = roomOf(req);
  if (!room.open) return res.status(409).json({ error: 'Nenhuma sessão aberta.' });

  const on = req.body?.on !== false;
  if (on) {
    if (!screening.startLive(room, req.session)) {
      return res
        .status(409)
        .json({ error: `${room.live.hostName} já está transmitindo a tela.`, live: room.live });
    }
  } else {
    screening.stopLive(room, req.session.reviewer_id);
  }
  res.json(screening.snapshot(room));
}));

router.post('/signal', wrap(async (req, res) => {
  if (!screening.withinSignalRate(req.session.reviewer_id)) {
    return res.status(429).json({ error: 'Sinalização demais em pouco tempo.' });
  }
  const room = roomOf(req);
  const { to, kind, data } = req.body || {};
  if (typeof to !== 'string' || typeof kind !== 'string') {
    return res.status(400).json({ error: 'Recado sem destinatário ou sem tipo.' });
  }
  if (to === req.session.reviewer_id) {
    return res.status(400).json({ error: 'Recado para si mesmo.' });
  }
  if (!screening.signal(room, req.session.reviewer_id, to, kind, data)) {
    return res.status(404).json({ error: 'Essa pessoa não está mais na sessão.' });
  }
  res.status(204).end();
}));

router.get('/ice', (req, res) => {
  res.json({
    iceServers: turn.iceServers(req.session.reviewer_id),
    relayed: turn.hasTurn(),
  });
});

router.post('/ready', wrap(async (req, res) => {
  const { ready, sourceTag } = req.body || {};
  const room = roomOf(req);
  screening.setReady(room, req.session.reviewer_id, ready !== false, sourceTag);
  res.json(screening.snapshot(room));
}));

module.exports = router;
