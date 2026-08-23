const express = require('express');
const db = require('../db');
const auth = require('../auth');
const wrap = require('../wrap');
const screening = require('../screening');

const router = express.Router();

/* Every route here needs a member. The room is the club's, not the internet's,
   and a screening is a thing you are in rather than a thing you watch from
   outside. */
router.use(auth.requireSession);

/* The film comes from its id and is read back out of the server's own records.
   Accepting the object the client sent would let any member broadcast an
   arbitrary poster URL — and therefore an arbitrary outbound request — into
   everybody else's browser. The cache is asked first because it is the only
   one of the two that knows the runtime, which is what bounds the seek bar. */
const cachedStmt = db.prepare('SELECT tmdb_id, title, year, genre, poster, runtime FROM movies_cache WHERE tmdb_id = ?');
const queuedStmt = db.prepare('SELECT movie_id, movie_title, movie_year, movie_genre, movie_poster FROM watchlist WHERE movie_id = ?');

async function movieById(id) {
  const cached = await cachedStmt.get(id);
  if (cached) {
    return {
      id: Number(cached.tmdb_id),
      title: cached.title,
      year: cached.year ?? null,
      genre: cached.genre,
      poster: cached.poster ?? null,
      runtime: cached.runtime ?? null,
    };
  }
  const queued = await queuedStmt.get(id);
  if (queued) {
    return {
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

router.get('/', wrap(async (_req, res) => {
  res.json(screening.snapshot());
}));

/* The clock. A client samples this a few times and keeps the median offset, so
   that a member whose machine is a minute fast does not spend the whole film
   a minute ahead of everybody. Deliberately does nothing else: the value of
   the answer is that it arrives quickly. */
router.get('/time', (_req, res) => {
  res.json({ t: Date.now() });
});

/* ── the stream ───────────────────────────────────────────────────────────
   The headers are all load-bearing. `no-transform` and `X-Accel-Buffering` are
   what stop an intermediary from holding frames back to fill a buffer, which
   for this endpoint means holding a play command until the film is over.
   `flushHeaders` sends them before the first frame exists, which is what makes
   the browser consider the connection open. */
router.get('/stream', (req, res) => {
  if (!screening.canSubscribe(req.session.reviewer_id)) {
    return res.status(429).json({ error: 'Conexões demais. Feche outras abas do Cineclube.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  // Without this the socket's idle timeout eventually kills a connection whose
  // entire job is to be idle between commands.
  req.socket.setTimeout(0);
  req.socket.setNoDelay?.(true);

  screening.startTimers();
  screening.attach(req.session);
  screening.subscribe(res);

  let gone = false;
  const leave = () => {
    if (gone) return;
    gone = true;
    screening.unsubscribe(res);
    screening.detach(req.session.reviewer_id);
  };
  // Both, because a dropped connection and a closed response do not always
  // arrive as the same event.
  req.on('close', leave);
  res.on('close', leave);
});

router.post('/open', wrap(async (req, res) => {
  const movieId = Number(req.body?.movieId);
  if (!Number.isInteger(movieId)) return res.status(400).json({ error: 'Filme inválido.' });

  const movie = await movieById(movieId);
  if (!movie) return res.status(404).json({ error: 'Filme não encontrado no catálogo do clube.' });

  screening.open(movie);
  res.status(201).json(screening.snapshot());
}));

router.post('/close', wrap(async (_req, res) => {
  screening.close();
  res.json(screening.snapshot());
}));

/* play, pause and seek. The position is taken from the sender because the
   sender is the one who knows where their player actually is — but it is
   clamped in the room before it becomes everyone's truth. */
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

  if (!screening.command(type, position)) {
    return res.status(409).json({ error: 'Nenhuma sessão aberta.' });
  }
  res.json(screening.snapshot());
}));

/* The pointer to what the club is watching, so a member who arrives late loads
   it without asking. Anything that is not a magnet or an http(s) URL is refused
   outright rather than trimmed to fit: this string goes straight into everyone
   else's player, and half a magnet is not a shorter magnet. */
router.post('/link', wrap(async (req, res) => {
  if (!screening.withinRate(req.session.reviewer_id)) {
    return res.status(429).json({ error: 'Comandos demais em pouco tempo.' });
  }
  if (!screening.room.open) return res.status(409).json({ error: 'Nenhuma sessão aberta.' });

  const { link } = req.body || {};
  if (!screening.setLink(link === null || link === undefined ? null : link)) {
    return res.status(400).json({ error: 'Link inválido — só magnet ou URL http(s), até 4 KB.' });
  }
  res.json(screening.snapshot());
}));

/* ── the subtitle ─────────────────────────────────────────────────────────
   Two routes rather than a field on the snapshot, and that split is the whole
   design: the stream announces which subtitle the room is on, and this is
   where the text is actually collected. The reasoning is in `snapshot`.

   Sent as WebVTT because the browser only speaks WebVTT and the conversion
   from SubRip already happens on the screen that read the file. Converting
   once, where the file is opened, beats converting in every browser that
   receives it — and means the room stores one format instead of two. */
router.get('/subtitle', (_req, res) => {
  const subtitle = screening.room.subtitle;
  if (!subtitle) return res.status(404).json({ error: 'A sessão não tem legenda.' });
  res.json(subtitle);
});

router.post('/subtitle', wrap(async (req, res) => {
  if (!screening.withinRate(req.session.reviewer_id)) {
    return res.status(429).json({ error: 'Comandos demais em pouco tempo.' });
  }
  if (!screening.room.open) return res.status(409).json({ error: 'Nenhuma sessão aberta.' });

  const { subtitle } = req.body || {};
  if (!screening.setSubtitle(subtitle === null || subtitle === undefined ? null : subtitle)) {
    return res.status(400).json({ error: 'Legenda inválida — precisa de nome e texto, até 512 KB.' });
  }
  res.json(screening.snapshot());
}));

/* Whether this member can play right now, and what they are playing. The
   source tag is how the club finds out somebody opened a different file before
   the difference becomes an argument about who is at the wrong scene. */
router.post('/ready', wrap(async (req, res) => {
  const { ready, sourceTag } = req.body || {};
  screening.setReady(req.session.reviewer_id, ready !== false, sourceTag);
  res.json(screening.snapshot());
}));

module.exports = router;
