const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const clubs = require('../clubs');
const wrap = require('../wrap');
const throttle = require('../throttle');
const live = require('../live');
const { GENRES, episodeCritsFor, episodeFinalOf, episodeAnsweredIn } = require('../criteria');
const { cleanShow, cleanEpisodeRef, text, MAX_EPISODE_TITLE } = require('../show');

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

const insertQueue = db.prepare(`
  INSERT INTO show_queue (club_id, show_id, show_title, show_year, show_genre, show_poster, position, added_by)
  VALUES (@clubId, @showId, @showTitle, @showYear, @showGenre, @showPoster,
          (SELECT COALESCE(MAX(position), -1) + 1 FROM show_queue WHERE club_id = @clubId), @addedBy)
  ON CONFLICT(club_id, show_id) DO NOTHING
`);

const queueOwnerStmt = db.prepare(`
  SELECT q.show_id, q.show_title, q.added_by, r.name AS added_by_name
  FROM show_queue q
  LEFT JOIN reviewers r ON r.id = q.added_by
  WHERE q.club_id = ? AND q.show_id = ?
`);
const deleteQueue = db.prepare('DELETE FROM show_queue WHERE club_id = ? AND show_id = ?');

/* Contado por episódio distinto e não por linha: quatro pessoas vendo o mesmo
   episódio é um episódio visto pelo clube, não quatro. */
const progressStmt = db.prepare(`
  SELECT show_id,
         COUNT(DISTINCT season || 'x' || episode) AS seen,
         COUNT(DISTINCT CASE WHEN final IS NOT NULL THEN season || 'x' || episode END) AS rated,
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

const upsertTake = db.prepare(`
  INSERT INTO episode_takes
    (id, club_id, reviewer_id, show_id, show_title, show_poster, show_genre,
     season, episode, episode_title, scores, quick, final, comment, watched_at, rated_at)
  VALUES
    (@id, @clubId, @reviewerId, @showId, @showTitle, @showPoster, @showGenre,
     @season, @episode, @episodeTitle, @scores, @quick, @final, @comment,
     datetime('now'), @ratedAt)
  ON CONFLICT(club_id, reviewer_id, show_id, season, episode) DO UPDATE SET
    show_title = excluded.show_title,
    show_poster = excluded.show_poster,
    show_genre = excluded.show_genre,
    episode_title = COALESCE(excluded.episode_title, episode_takes.episode_title),
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
    addedBy: row.added_by || null,
    /* O progresso do CLUBE, não o seu. Quem abre a fila está perguntando onde a
       sala está, e a resposta individual é a da tela da série. */
    seen: p?.seen ?? 0,
    rated: p?.rated ?? 0,
    average: p?.average ?? null,
  };
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
    ? episodeAnsweredIn(genre, scores).map(c => ({
        key: c.key, name: c.name, w: c.w, group: c.group, value: scores[c.key],
      }))
    : [];
  return {
    id: row.id,
    showId: row.show_id,
    showTitle: row.show_title,
    showPoster: row.show_poster,
    genre: row.show_genre,
    season: row.season,
    episode: row.episode,
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

router.get('/', clubs.requireReadable, wrap(async (req, res) => {
  const [rows, progress] = await Promise.all([
    queueStmt.all(req.club.id),
    progressMap(req.club.id),
  ]);
  res.json({ shows: rows.map(r => queueDTO(r, progress)) });
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

/* Tirar é de quem pôs, com o ADM do clube como única exceção. A mesma regra da
   fila de filmes, e o porquê está escrito em routes/watchlist.js. */
router.delete('/:showId(\\d+)', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  const row = await queueOwnerStmt.get(req.club.id, Number(req.params.showId));
  if (!row) return res.status(204).end();

  const mine = !!row.added_by && row.added_by === req.session.reviewer_id;
  if (!mine && !req.club.isClubAdmin && !req.session.is_admin) {
    return res.status(403).json({
      error: row.added_by_name
        ? `Só quem pôs a série na fila pode tirar, e ${row.show_title} foi escolha de ${row.added_by_name}.`
        : 'Esta série entrou na fila antes de ela registrar quem põe. Só o administrador do clube pode tirar.',
    });
  }

  await deleteQueue.run(req.club.id, row.show_id);
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

/* ── marcar e avaliar, no mesmo lugar ─────────────────────────────────────
   Uma rota de escrita só, porque é uma linha só. O corpo diz qual dos três
   estados está sendo gravado:

   · nada, ou { watched: true } — visto, sem nota
   · { quick: 8 }               — a nota objetiva
   · { scores: {...} }          — a avaliação criteriosa

   As duas notas se substituem nos dois sentidos: a última coisa que a pessoa
   disse é a que vale, e nenhuma sobra escondida na linha. */
router.put(
  '/:showId(\\d+)/:season(\\d+)/:episode(\\d+)',
  auth.requireSession, clubs.requireMember, throttleTake,
  wrap(async (req, res) => {
    const limpo = cleanEpisodeRef(req.params);
    if (limpo.error) return res.status(400).json({ error: limpo.error });
    const { showId, season, episode } = limpo.ref;

    const body = req.body || {};
    const genre = GENRES.includes(body.genre) ? body.genre : 'Drama';

    /* O título e o pôster viajam com a escrita e são gravados na linha, como na
       ficha de um filme: o acervo é lido com o TMDB fora da requisição, e
       "S02E05" sem o nome da série não é um registro. */
    const showTitle = text(body.showTitle, 300);
    if (!showTitle) return res.status(400).json({ error: 'Série inválida.' });
    const showPoster = text(body.showPoster, 500);
    const episodeTitle = text(body.episodeTitle, MAX_EPISODE_TITLE);

    let scores = null;
    let quick = null;
    let final = null;

    if (body.scores && typeof body.scores === 'object') {
      /* Só as chaves que este gênero pergunta, e só números na régua. Uma chave
         inventada não entra na linha, e um valor fora de 0–10 não é nota. */
      const allowed = new Set(episodeCritsFor(genre).map(c => c.key));
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
      final = episodeFinalOf(genre, clean);
    } else if (body.quick !== undefined && body.quick !== null) {
      const n = Number(body.quick);
      if (!Number.isFinite(n) || n < 0 || n > 10) {
        return res.status(400).json({ error: 'A nota tem de estar entre 0 e 10.' });
      }
      quick = n;
      final = n;
    }

    const existing = await getTake.get(
      req.club.id, req.session.reviewer_id, showId, season, episode
    );

    await upsertTake.run({
      /* O id só é sorteado quando a linha nasce: numa regravação o upsert casa
         pela chave natural e não toca nele, que é o que faz um endereço de
         ficha continuar valendo depois de a nota mudar. */
      id: existing?.id || 'e' + crypto.randomUUID(),
      clubId: req.club.id,
      reviewerId: req.session.reviewer_id,
      showId, showTitle, showPoster, showGenre: genre,
      season, episode, episodeTitle,
      scores, quick, final,
      comment: text(body.comment, 2000),
      ratedAt: final !== null ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
    });

    const saved = await getTake.get(
      req.club.id, req.session.reviewer_id, showId, season, episode
    );
    live.emit('shows', req.session.reviewer_id, req.club.id);
    res.status(existing ? 200 : 201).json({ take: takeDTO({ ...saved, reviewer_name: null, reviewer_dot: null }) });
  })
);

/* Desmarcar apaga a linha inteira, e é o certo: a linha É o "eu vi", então
   tirar o visto e tirar a nota são o mesmo gesto. Quem só quer trocar a nota
   grava outra por cima. */
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

module.exports = router;
