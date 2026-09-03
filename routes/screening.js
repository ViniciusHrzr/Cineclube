const express = require('express');
const db = require('../db');
const auth = require('../auth');
const clubs = require('../clubs');
const wrap = require('../wrap');
const screening = require('../screening');
const live = require('../live');

const router = express.Router({ mergeParams: true });

/* A sala é do clube, e não da internet — e agora "do clube" é uma frase com
   consequência mecânica: `req.club` já foi resolvido pelo middleware lá em
   cima, e `roomFor` devolve o quarto daquele clube e de nenhum outro. Assistir
   é uma coisa que se faz DE DENTRO, então tudo aqui exige ser membro. */
router.use(auth.requireSession, clubs.requireMember);

/** O quarto deste pedido. Uma linha em toda rota, e é o escopo inteiro. */
const roomOf = req => screening.roomFor(req.club.id);

/* The film comes from its id and is read back out of the server's own records.
   Accepting the object the client sent would let any member broadcast an
   arbitrary poster URL — and therefore an arbitrary outbound request — into
   everybody else's browser. The cache is asked first because it is the only
   one of the two that knows the runtime, which is what bounds the seek bar. */
const cachedStmt = db.prepare('SELECT tmdb_id, title, year, genre, poster, runtime FROM movies_cache WHERE tmdb_id = ?');
const queuedStmt = db.prepare(
  'SELECT movie_id, movie_title, movie_year, movie_genre, movie_poster FROM watchlist WHERE club_id = ? AND movie_id = ?'
);

async function movieById(clubId, id) {
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
  const queued = await queuedStmt.get(clubId, id);
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

router.get('/', wrap(async (req, res) => {
  res.json(screening.snapshot(roomOf(req)));
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
  // Without this the socket's idle timeout eventually kills a connection whose
  // entire job is to be idle between commands.
  req.socket.setTimeout(0);
  req.socket.setNoDelay?.(true);

  screening.startTimers();
  screening.attach(room, req.session);
  screening.subscribe(room, res);

  let gone = false;
  const leave = () => {
    if (gone) return;
    gone = true;
    screening.unsubscribe(room, res);
    screening.detach(room, req.session.reviewer_id);
  };
  // Both, because a dropped connection and a closed response do not always
  // arrive as the same event.
  req.on('close', leave);
  res.on('close', leave);
});

router.post('/open', wrap(async (req, res) => {
  const movieId = Number(req.body?.movieId);
  if (!Number.isInteger(movieId)) return res.status(400).json({ error: 'Filme inválido.' });

  const movie = await movieById(req.club.id, movieId);
  if (!movie) return res.status(404).json({ error: 'Filme não encontrado no catálogo do clube.' });

  screening.open(roomOf(req), movie);
  /* ── e o resto do clube fica sabendo ──────────────────────────────────
     A sala já avisou quem está dentro dela pelo próprio stream. Isto avisa
     quem não está: a marquise de todo mundo acende a lâmpada da Sessão sem
     que ninguém precise abrir a aba para descobrir que ela começou.

     Depois de `open`, nunca antes, pela mesma razão de sempre — um aviso
     emitido antes da mudança manda o clube buscar um estado que ainda não
     existe. Ver live.js. */
  live.emit('screening', req.session.reviewer_id, req.club.id);
  res.status(201).json(screening.snapshot(roomOf(req)));
}));

router.post('/close', wrap(async (req, res) => {
  const room = roomOf(req);
  screening.close(room);
  live.emit('screening', req.session.reviewer_id, req.club.id);
  res.json(screening.snapshot(room));
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

  /* ── só a virada, e nunca o arrasto ──────────────────────────────────
     A lâmpada da marquise respira quando o filme está rolando e fica parada
     quando alguém pausou, então play e pause interessam ao clube inteiro.
     Seek não: puxar a barra dispara comandos aos punhados, e emitir em cada
     um seria mandar toda aba aberta buscar a sala enquanto uma pessoa
     procura uma cena. Comparar o status antes e depois é o filtro exato —
     `seek` é o único que deixa ele em paz de propósito (ver screening.js). */
  const room = roomOf(req);
  const was = room.status;
  if (!screening.command(room, type, position)) {
    return res.status(409).json({ error: 'Nenhuma sessão aberta.' });
  }
  if (room.status !== was) live.emit('screening', req.session.reviewer_id, req.club.id);
  res.json(screening.snapshot(room));
}));

/* The pointer to what the club is watching, so a member who arrives late loads
   it without asking. Anything that is not a magnet or an http(s) URL is refused
   outright rather than trimmed to fit: this string goes straight into everyone
   else's player, and half a magnet is not a shorter magnet. */
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

/* ── the subtitle ─────────────────────────────────────────────────────────
   Two routes rather than a field on the snapshot, and that split is the whole
   design: the stream announces which subtitle the room is on, and this is
   where the text is actually collected. The reasoning is in `snapshot`.

   Sent as WebVTT because the browser only speaks WebVTT and the conversion
   from SubRip already happens on the screen that read the file. Converting
   once, where the file is opened, beats converting in every browser that
   receives it — and means the room stores one format instead of two. */
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

/* Whether this member can play right now, and what they are playing. The
   source tag is how the club finds out somebody opened a different file before
   the difference becomes an argument about who is at the wrong scene. */
router.post('/ready', wrap(async (req, res) => {
  const { ready, sourceTag } = req.body || {};
  const room = roomOf(req);
  screening.setReady(room, req.session.reviewer_id, ready !== false, sourceTag);
  res.json(screening.snapshot(room));
}));

module.exports = router;
