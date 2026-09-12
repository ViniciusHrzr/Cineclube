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

/* A fila de séries e o que cada pessoa viu. O catálogo — o que o TMDB sabe —
   mora em routes/series.js e não é de clube nenhum.

   Tudo aqui é escopado pelo clube da URL: "Beren viu S02E05" é um fato sobre a
   Beren NESTE clube, e é essa frase que faz o Trakt não servir de dono deste
   dado. */

const throttleQueue = throttle.limit({
  name: 'show-queue',
  max: 60,
  windowMs: 60 * 60_000,
  message: espera => `Muitas séries postas na fila seguidas. Tente de novo em ${espera}.`,
});

/* Marcar visto é o gesto mais repetido deste universo — uma maratona são treze
   toques em vinte minutos, e isso é uso legítimo. O teto existe para o que não
   é gente. */
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

/* `added_by` é parte da chave: acompanhar é de cada um, como na fila de filmes —
   o porquê está em routes/watchlist.js. A posição é da SÉRIE, não da linha: quem
   chega depois entra no lugar que ela já tem na lista do clube. */
const insertQueue = db.prepare(`
  INSERT INTO show_queue (club_id, show_id, show_title, show_year, show_genre, show_poster, position, added_by)
  VALUES (@clubId, @showId, @showTitle, @showYear, @showGenre, @showPoster,
          COALESCE(
            (SELECT MIN(position) FROM show_queue WHERE club_id = @clubId AND show_id = @showId),
            (SELECT COALESCE(MAX(position), -1) + 1 FROM show_queue WHERE club_id = @clubId)),
          @addedBy)
  ON CONFLICT(club_id, show_id, added_by) DO NOTHING
`);

/* Quem acompanha, com os nomes junto: a recusa precisa dizer de quem é a escolha
   que está sendo protegida, ou vira "não pode" sem sujeito. */
const queueWantersStmt = db.prepare(`
  SELECT q.show_id, q.show_title, q.added_by, r.name AS added_by_name
  FROM show_queue q
  LEFT JOIN reviewers r ON r.id = q.added_by
  WHERE q.club_id = ? AND q.show_id = ?
  ORDER BY q.added_at ASC
`);
const deleteMineQueue = db.prepare('DELETE FROM show_queue WHERE club_id = ? AND show_id = ? AND added_by = ?');
const deleteQueue = db.prepare('DELETE FROM show_queue WHERE club_id = ? AND show_id = ?');

/* Contado por episódio distinto e não por linha: quatro pessoas vendo o mesmo
   episódio é um episódio visto pelo clube, não quatro. A linha da temporada
   fica de fora da contagem de vistos — ela é uma nota, não uma sessão.

   A média é das fichas de temporada, que são as únicas linhas com nota. */
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

/* Marcar não escreve nota nenhuma, e as colunas dela ficam de fora do upsert:
   uma linha de episódio nunca as teve preenchidas desde que a nota passou a ser
   da temporada, e listá-las aqui seria abrir um caminho de volta. */
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
    /* Quem acompanha — e são vários, porque o cartaz é um só. Vazia na linha que
       a lista não sabe de quem é: anterior à coluna, ou de quem saiu do clube.
       Ver `toQueue`. */
    wanters: row.added_by ? [row.added_by] : [],
    /* O progresso do CLUBE, não o seu. Quem abre a fila está perguntando onde a
       sala está, e a resposta individual é a da tela da série. */
    seen: p?.seen ?? 0,
    rated: p?.rated ?? 0,
    average: p?.average ?? null,
    /* O SEU próximo episódio, pendurado adiante por upnext.js. Declarados aqui
       para a linha ter uma forma só: nulo é "não sei" — sem sessão, ou o TMDB
       não respondeu —, e é diferente de estar em dia. */
    upNext: null,
    upcoming: null,
    caughtUp: false,
  };
}

/* Uma linha por pessoa no banco, um cartaz por série na tela: duas pessoas
   acompanhando a mesma obra não são dois lugares na lista, são o mesmo lugar.
   Agrupado aqui e não em SQL porque a ordem importa duas vezes — a das séries é
   a do clube, e a das pessoas dentro de uma série é a da chegada. */
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
  /* ── os nove, abertos ────────────────────────────────────────────────────
     O mesmo que a ficha de um filme manda: sem isto, "T1E05 — 7,4" é a linha de
     qualquer app.

     Só o que ESTA ficha respondeu — uma ficha antiga tem as chaves que existiam
     quando foi escrita, e imprimir um critério ausente como 0,0 é pôr uma
     opinião na boca de alguém. Vazio quando a ficha é só "vi" ou nota rápida. */
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
    /* De qual das duas coisas esta linha fala, dito por extenso: o zero é onde
       a ficha da temporada mora (ver show.js), e um cliente que tivesse de
       descobrir isso sozinho descobriria errado uma vez. */
    kind: season ? 'season' : 'episode',
    season: row.season,
    episode: season ? null : row.episode,
    episodeTitle: row.episode_title ?? null,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    reviewerDot: row.reviewer_dot,
    /* Os três estados desta linha, ditos por extenso para a tela não ter de
       deduzi-los de dois nulos. */
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

/* A mesma resposta da grade do catálogo, sobre a mesma tabela: ver
   providers.js. A lista que o clube acompanha é justamente onde a pergunta
   volta — "hoje a gente vê qual?" é escolher entre o que dá para ver hoje, e
   sem isto a resposta morava em outra aba. */
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
  /* "O próximo" é uma resposta sobre UMA pessoa, então só existe quando há
     uma: quem lê um clube aberto de fora vê a lista e o progresso da sala. */
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

/* Cada um tira o seu, com o ADM do clube como única exceção — ele tira o cartaz
   inteiro. A mesma regra da fila de filmes, e o porquê está escrito em
   routes/watchlist.js. */
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

/* Tudo o que o clube gravou, para o acervo de séries. */
router.get('/takes', clubs.requireReadable, wrap(async (req, res) => {
  const rows = await allTakes.all(req.club.id);
  res.json({ takes: rows.map(takeDTO) });
}));

router.get('/:showId(\\d+)/takes', clubs.requireReadable, wrap(async (req, res) => {
  const rows = await takesForShow.all(req.club.id, Number(req.params.showId));
  res.json({ takes: rows.map(takeDTO) });
}));

/* ── as duas escritas, e a diferença entre elas ───────────────────────────
   **Um episódio se marca.** A linha existe, e isso quer dizer "eu vi". Nada
   mais: um episódio não recebe nota.

   **Uma temporada se avalia**, e é onde as duas notas moram — a rápida e a
   criteriosa, que se substituem nos dois sentidos. A última coisa que a pessoa
   disse é a que vale, e nenhuma sobra escondida na linha.

   A unidade da nota é a temporada porque é ela que tem uma forma para julgar:
   um arco que abre e fecha, um elenco que muda, um fôlego. */
router.put(
  '/:showId(\\d+)/:season(\\d+)/:episode(\\d+)',
  auth.requireSession, clubs.requireMember, throttleTake,
  wrap(async (req, res) => {
    const limpo = cleanEpisodeRef(req.params);
    if (limpo.error) return res.status(400).json({ error: limpo.error });
    const { showId, season, episode } = limpo.ref;

    const body = req.body || {};
    /* Recusado e não ignorado: um cliente antigo mandando nota de episódio
       precisa ouvir que ela não existe mais, ou some em silêncio. */
    if (body.scores || body.quick != null) {
      return res.status(400).json({ error: 'A avaliação agora é da temporada, não do episódio.' });
    }

    const genre = GENRES.includes(body.genre) ? body.genre : 'Drama';

    /* O título e o pôster viajam com a escrita e são gravados na linha, como na
       ficha de um filme: o acervo é lido com o TMDB fora da requisição, e
       "S02E05" sem o nome da série não é um registro. */
    const showTitle = text(body.showTitle, 300);
    if (!showTitle) return res.status(400).json({ error: 'Série inválida.' });
    const showPoster = text(body.showPoster, 500);
    const episodeTitle = text(body.episodeTitle, MAX_EPISODE_TITLE);

    const existing = await getTake.get(
      req.club.id, req.session.reviewer_id, showId, season, episode
    );

    await markEpisode.run({
      /* O id só é sorteado quando a linha nasce: numa regravação o upsert casa
         pela chave natural e não toca nele, que é o que faz um endereço de
         ficha continuar valendo. */
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
      /* Só as chaves que este gênero pergunta, e só números na régua. Uma chave
         inventada não entra na linha, e um valor fora de 0–10 não é nota. */
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
      /* Uma ficha de temporada sem nota seria uma linha que o mural leria como
         "viu a temporada inteira" — e ninguém vê uma temporada de uma vez.
         Quem só quer escrever escreve na conversa. */
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

/* Desmarcar apaga a linha inteira, e é o certo: a linha É o "eu vi". */
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

/* Tirar a própria nota da temporada. Não mexe em episódio marcado nenhum: o que
   se viu continua visto depois de a opinião ser retirada. */
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
