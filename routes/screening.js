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

/* A sala é do clube: `roomFor` devolve o quarto daquele clube e de nenhum
   outro. Assistir é coisa de DENTRO, então tudo aqui exige ser membro. */
router.use(auth.requireSession, clubs.requireMember);

/** O quarto deste pedido. Uma linha em toda rota, e é o escopo inteiro. */
const roomOf = req => screening.roomFor(req.club.id);

/* The film comes from its id and is read back out of the server's own records:
   accepting the object the client sent would let any member broadcast an
   arbitrary poster URL — and therefore an arbitrary outbound request — into
   everybody else's browser. The cache is asked first because it is the only one
   of the two that knows the runtime, which is what bounds the seek bar. */
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

/* ══════════════════════════════════════════════════════════════════════════
   UM EPISÓDIO NA MESMA SALA.

   Uma sala por clube, e não uma por lente: o clube é a mesma gente, e duas
   sessões ao mesmo tempo seriam as quatro pessoas divididas entre duas salas
   que nenhuma delas pediu. Assistir a um episódio é assistir, e a sincronia,
   a legenda, a fonte e a tela ao vivo não sabem nem precisam saber se o que
   está tocando tem uma temporada.

   O que muda é só a identidade do que toca: um filme é um id, um episódio é
   uma tripla. `kind` é o que a tela lê para saber qual das duas ela tem —
   sem ele, `id` seria um id do TMDB apontando para o filme errado.
   ══════════════════════════════════════════════════════════════════════════ */

/* A duração vem do episódio e não da série: é ela que limita a barra, e um
   piloto de 70 minutos numa série de 22 é exatamente o caso em que o número da
   série está errado. */
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

/* O pôster é o da SÉRIE e não o still do episódio: o cabeçalho da sessão desenha
   um retrato 2:3, e um quadro 16:9 esticado ali é a única coisa da tela que
   parece quebrada. */
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

/* ══════════════════════════════════════════════════════════════════════════
   PASSAR AO SEGUINTE É TER VISTO O ANTERIOR.

   Não é chegar: quem abre um episódio ainda não o viu, e marcar na chegada
   daria visto a quem abriu, olhou dois minutos e desistiu. O que prova que o
   clube viu o primeiro é ele pedir o segundo — então a marca acontece na
   virada, sobre o episódio que SAI.

   Para todo mundo que estava na sala naquele instante, e não só para quem
   apertou: as quatro pessoas viram o mesmo episódio junto, e três delas terem
   de ir marcar o mesmo na tela da série depois é o dever de casa que ninguém
   fazia — o progresso do clube mentia para baixo justamente nas noites em que
   ele mais viu.

   `DO NOTHING` é o que torna isto seguro de escrever no nome dos outros: a
   linha de alguém é onde a nota dela mora, e uma marca automática não pode ser
   o caminho por onde uma nota se perde. O que já existe fica exatamente como
   está.

   Encerrar a sessão não marca nada, pela mesma razão que chegar não marca:
   fechar a sala no meio é uma noite que acabou, não um episódio que terminou.
   ══════════════════════════════════════════════════════════════════════════ */
const seenStmt = db.prepare(`
  INSERT INTO episode_takes
    (id, club_id, reviewer_id, show_id, show_title, show_poster, show_genre,
     season, episode, episode_title, watched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(club_id, reviewer_id, show_id, season, episode) DO NOTHING
`);

/** Fecha o episódio que a sala está deixando para trás. Nada, se não é um. */
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
      /* Uma pessoa que não gravou não pode custar as outras três, nem impedir o
         episódio seguinte de abrir: a sala é o assunto, isto é a consequência. */
      console.warn('[screening] falha ao marcar visto de', reviewerId, e.message);
    }
  }
  return true;
}

router.get('/', wrap(async (req, res) => {
  res.json(screening.snapshot(roomOf(req)));
}));

/* The clock. A client samples this a few times and keeps the median offset, so a
   member whose machine is a minute fast does not spend the whole film a minute
   ahead. Deliberately does nothing else: the value of the answer is that it
   arrives quickly. */
router.get('/time', (_req, res) => {
  res.json({ t: Date.now() });
});

/* The headers are all load-bearing: `no-transform` and `X-Accel-Buffering` stop
   an intermediary from holding frames back to fill a buffer, which here means
   holding a play command until the film is over. `flushHeaders` sends them
   before the first frame exists, which makes the browser consider the
   connection open. */
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
  /* Com o dono da conexão, porque a sala precisa saber mandar recado para UMA
     pessoa: o aperto de mão da tela ao vivo é entre duas. Ver `sendTo`. */
  screening.subscribe(room, res, req.session.reviewer_id);

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
  /* Um corpo ou o outro: `movieId` abre um filme, a tripla abre um episódio. A
     escolha é pela presença de `showId` e não por um campo `tipo`, que seria uma
     terceira coisa a poder discordar das outras duas. */
  const asEpisode = req.body?.showId !== undefined;
  const movieId = asEpisode ? null : Number(req.body?.movieId);
  if (!asEpisode && !Number.isInteger(movieId)) {
    return res.status(400).json({ error: 'Filme inválido.' });
  }

  const ref = asEpisode ? cleanEpisodeRef(req.body) : null;
  if (ref?.error) return res.status(400).json({ error: ref.error });

  /* Trocar o filme por baixo de uma sessão aberta é o maior comando que existe
     — reinicia a sala em zero para os quatro — e, sem esta linha, também seria
     como se pega o controle de quem está com ele. Uma sala vazia perde o dono
     sozinha (ver `detach`), então isto nunca deixa um filme preso. */
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

  /* Antes de trocar, e nunca depois: quem estava vendo o episódio que sai
     acabou de terminá-lo. Depois de `open` a sala já não sabe qual era. */
  const fechou = await closeEpisode(room);

  /* Quem abre é o dono da sessão. Não há tela para escolher outro: o clube são
     quatro pessoas combinando no Discord, e um seletor de dono seria uma
     pergunta a mais para uma resposta que já está dada por quem clicou. */
  screening.open(roomOf(req), movie, {
    id: req.session.reviewer_id,
    name: req.session.name,
    dot: req.session.dot,
  });
  /* A sala já avisou quem está dentro pelo próprio stream; isto avisa quem não
     está, para a marquise de todo mundo acender a lâmpada da Sessão. Depois de
     `open` e nunca antes: um aviso emitido antes da mudança manda o clube
     buscar um estado que ainda não existe. */
  live.emit('screening', req.session.reviewer_id, req.club.id);
  // O acervo de séries mudou para todo mundo que estava na sala.
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

/* A posição vem de quem manda, porque é quem sabe onde o player dele está de
   verdade — e é limitada na sala antes de virar a verdade de todo mundo. */
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

  /* ── o controle é de uma pessoa só ───────────────────────────────────
     Recusado aqui e não só na tela: a tela do dono é a única que manda
     comandos, mas o que garante isso para a sala é esta linha — uma aba velha,
     uma requisição repetida ou alguém curioso com o console chegam por aqui do
     mesmo jeito, e cada um deles move o filme dos outros três. */
  if (!screening.isHost(roomOf(req), req.session.reviewer_id)) {
    return res
      .status(403)
      .json({ error: `${roomOf(req).host.name} está com o controle da sessão.` });
  }

  /* ── só a virada, e nunca o arrasto ──────────────────────────────────
     A lâmpada da marquise respira com o filme rolando e fica parada quando
     alguém pausou, então play e pause interessam ao clube inteiro. Seek não:
     puxar a barra dispara comandos aos punhados, e emitir em cada um mandaria
     toda aba aberta buscar a sala enquanto uma pessoa procura uma cena. */
  const room = roomOf(req);
  const was = room.status;
  if (!screening.command(room, type, position)) {
    return res.status(409).json({ error: 'Nenhuma sessão aberta.' });
  }
  if (room.status !== was) live.emit('screening', req.session.reviewer_id, req.club.id);
  res.json(screening.snapshot(room));
}));

/* O ponteiro para o que o clube está vendo, para quem chega tarde carregar sem
   perguntar. O que não for magnet ou http(s) é recusado inteiro e não aparado:
   esta string vai direto para o player de todo mundo, e meio magnet não é um
   magnet menor. */
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

/* Duas rotas em vez de um campo no snapshot, e essa divisão é o desenho: o
   stream anuncia QUAL legenda a sala está usando, e aqui o texto é buscado. O
   porquê está em `snapshot`.

   WebVTT porque o navegador só fala WebVTT, e a conversão do SubRip já acontece
   na tela que leu o arquivo: converter uma vez, onde o arquivo é aberto, ganha
   de converter em cada navegador que recebe. */
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

/* ══════════════════════════════════════════════════════════════════════════
   A TELA AO VIVO: TRÊS ROTAS E NENHUM BYTE DE VÍDEO. `/live` diz quem está com
   a tela, `/signal` carrega o aperto de mão entre dois navegadores, `/ice`
   entrega os endereços com que eles se acham. Se a imagem passasse por aqui,
   uma sessão de duas horas seria alguns gigabytes saindo de uma instância de
   512 MB, e o recurso não existiria.
   ══════════════════════════════════════════════════════════════════════════ */

/* Uma sessão aberta é pré-requisito pela mesma razão que é para o link:
   transmitir para uma sala escura é transmitir para ninguém. */
router.post('/live', wrap(async (req, res) => {
  if (!screening.withinRate(req.session.reviewer_id)) {
    return res.status(429).json({ error: 'Comandos demais em pouco tempo.' });
  }
  const room = roomOf(req);
  if (!room.open) return res.status(409).json({ error: 'Nenhuma sessão aberta.' });

  const on = req.body?.on !== false;
  if (on) {
    if (!screening.startLive(room, req.session)) {
      /* 409 e não 403: não é falta de permissão, é a vaga estar ocupada. A tela
         mostra de quem ela é, que é a informação que resolve. */
      return res
        .status(409)
        .json({ error: `${room.live.hostName} já está transmitindo a tela.`, live: room.live });
    }
  } else {
    screening.stopLive(room, req.session.reviewer_id);
  }
  res.json(screening.snapshot(room));
}));

/* O carteiro: oferta, resposta e candidatos, de um membro para outro. O servidor
   não abre o envelope — para ele é uma string opaca com remetente e
   destinatário, e as únicas perguntas que faz são se os dois estão na sala.

   204 e não 200 com corpo: o que a outra ponta responder chega pelo stream
   dela, não por esta requisição. */
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
  /* Falso quando o destinatário saiu da sala entre ele oferecer e este recado
     chegar — o que acontece o tempo todo numa reconexão. 404 é o que a outra
     ponta precisa para desistir daquele par em vez de ficar tentando. */
  if (!screening.signal(room, req.session.reviewer_id, to, kind, data)) {
    return res.status(404).json({ error: 'Essa pessoa não está mais na sessão.' });
  }
  res.status(204).end();
}));

/* Por pessoa porque a credencial de TURN é temporária e assinada com o id de
   quem pediu; ver turn.js. */
router.get('/ice', (req, res) => {
  res.json({
    iceServers: turn.iceServers(req.session.reviewer_id),
    /* Para a tela poder ser honesta antes de falhar: sem relay configurado,
       quem estiver atrás de CGNAT não vai conseguir, e dizer isso é melhor do
       que uma roda girando para sempre. */
    relayed: turn.hasTurn(),
  });
});

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
