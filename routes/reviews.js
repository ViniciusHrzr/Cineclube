const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const auth = require('../auth');
const wrap = require('../wrap');
const { answeredIn, critsFor, finalOf, GENRES } = require('../criteria');
const { fillEnglishTitle } = require('../english');
const live = require('../live');

const router = express.Router();

/* The runtime is read through the cache when the take does not carry one: every
   film in the archive was opened before it was rated, so the cache almost always
   knows it, and takes recorded before reviews had the column get the number
   without a backfill. */
const listStmt = db.prepare(`
  SELECT rv.*, r.name AS reviewer_name, r.dot AS reviewer_dot,
         mc.runtime AS cached_runtime, mc.tmdb_score, mc.tmdb_votes,
         mc.original_title, mc.english_title
  FROM reviews rv
  JOIN reviewers r ON r.id = rv.reviewer_id
  LEFT JOIN movies_cache mc ON mc.tmdb_id = rv.movie_id
  ORDER BY rv.date DESC
`);
const reviewerExistsStmt = db.prepare('SELECT id FROM reviewers WHERE id = ?');
const upsertStmt = db.prepare(`
  INSERT INTO reviews (id, reviewer_id, movie_id, movie_title, movie_year, movie_genre, movie_poster, movie_director, movie_runtime, scores, final, date, comment, recorded_at)
  VALUES (@id, @reviewerId, @movieId, @movieTitle, @movieYear, @movieGenre, @moviePoster, @movieDirector, @movieRuntime, @scores, @final, @date, @comment, datetime('now'))
  ON CONFLICT(reviewer_id, movie_id) DO UPDATE SET
    -- Regravar é um acontecimento: o mural mostra a ficha de novo, na hora em
    -- que ela mudou, em vez de escondê-la no dia em que foi criada.
    recorded_at = datetime('now'),
    movie_title = excluded.movie_title, movie_year = excluded.movie_year, movie_genre = excluded.movie_genre,
    movie_poster = excluded.movie_poster, movie_director = excluded.movie_director,
    movie_runtime = COALESCE(excluded.movie_runtime, reviews.movie_runtime),
    scores = excluded.scores, final = excluded.final, date = excluded.date, comment = excluded.comment
`);
const averagesStmt = db.prepare(`
  SELECT movie_id, AVG(final) AS avg, COUNT(*) AS count
  FROM reviews
  GROUP BY movie_id
`);
const savedStmt = db.prepare(`
  SELECT rv.*, r.name AS reviewer_name, r.dot AS reviewer_dot,
         mc.runtime AS cached_runtime, mc.tmdb_score, mc.tmdb_votes,
         mc.original_title, mc.english_title
  FROM reviews rv
  JOIN reviewers r ON r.id = rv.reviewer_id
  LEFT JOIN movies_cache mc ON mc.tmdb_id = rv.movie_id
  WHERE rv.reviewer_id = ? AND rv.movie_id = ?
`);
const ownerStmt = db.prepare('SELECT id, reviewer_id FROM reviews WHERE id = ?');
const deleteStmt = db.prepare('DELETE FROM reviews WHERE id = ?');
const deleteWatchlistStmt = db.prepare('DELETE FROM watchlist WHERE movie_id = ?');

function toReviewDTO(row) {
  const genre = GENRES.includes(row.movie_genre) ? row.movie_genre : 'Drama';
  const scores = JSON.parse(row.scores);
  /* Only what this take answers. A take from before Aproveitamento existed has
     ten marks, and printing an eleventh at 0,0 would put an opinion in somebody's
     mouth — see answeredIn in criteria.js. */
  const breakdown = answeredIn(genre, scores).map(c => ({
    key: c.key, name: c.name, w: c.w, group: c.group, value: scores[c.key]
  }));
  return {
    id: row.id,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    reviewerDot: row.reviewer_dot,
    movieId: row.movie_id,
    movieTitle: row.movie_title,
    /* Os outros nomes do filme, para a busca do acervo achar por qualquer um
       deles. Lidos do cache pelo mesmo motivo que a nota do TMDB logo abaixo: é
       fato sobre o filme, não sobre a noite, e a avaliação está congelada. */
    movieOriginal: row.original_title ?? null,
    movieEnglish: row.english_title ?? null,
    movieYear: row.movie_year,
    movieGenre: genre,
    moviePoster: row.movie_poster,
    movieDirector: row.movie_director,
    movieRuntime: row.movie_runtime ?? row.cached_runtime ?? null,
    /* Read from the film cache rather than stored with the take, because it is
       a fact about the film that keeps changing and not a fact about the
       evening. A take is frozen; the number it disagrees with is not, and
       freezing a copy of it would slowly turn the comparison into a comparison
       with a number nobody can find any more. Null on a film the cache has
       never seen, which after the migration means a film rated before the
       column existed and not opened since. */
    crowd: row.tmdb_votes > 0 ? { score: row.tmdb_score, votes: row.tmdb_votes } : null,
    scores,
    final: row.final,
    date: row.date,
    comment: row.comment || '',
    breakdown
  };
}

router.get('/', wrap(async (req, res) => {
  const rows = await listStmt.all();
  res.json({ reviews: rows.map(toReviewDTO) });
}));

router.get('/averages', wrap(async (req, res) => {
  const out = {};
  for (const row of await averagesStmt.all()) out[row.movie_id] = { avg: row.avg, count: row.count };
  res.json({ averages: out });
}));

/* A take is signed by whoever is signed in. The body may still name a reviewer
   — the client sends it — but the session is the authority, so nobody can post
   a rating under someone else's name by editing a request. */
router.post('/', auth.requireSession, wrap(async (req, res) => {
  const { movie, scores, comment } = req.body || {};
  const reviewerId = req.session.reviewer_id;
  const exists = await reviewerExistsStmt.get(reviewerId);
  if (!exists) {
    return res.status(400).json({ error: 'Avaliador inválido.' });
  }
  if (!movie || !movie.id || !movie.title) {
    return res.status(400).json({ error: 'Filme inválido.' });
  }
  if (!scores || typeof scores !== 'object') {
    return res.status(400).json({ error: 'Notas inválidas.' });
  }
  const genre = GENRES.includes(movie.genre) ? movie.genre : 'Drama';
  const cs = critsFor(genre);
  const cleanScores = {};
  for (const c of cs) {
    const v = Number(scores[c.key]);
    cleanScores[c.key] = Number.isFinite(v) ? Math.min(10, Math.max(0, v)) : 0;
  }
  const final = finalOf(genre, cleanScores);
  const id = 'r' + crypto.randomUUID();
  const date = new Date().toISOString().slice(0, 10);
  const cleanComment = typeof comment === 'string' ? comment.trim().slice(0, 2000) : null;

  /* ── e o voto de quem já tinha concordado ──────────────────────────────
     Aqui havia uma limpeza: os votos dos critérios cuja nota mudou eram
     apagados, porque concordar com um 9 que virou 6 é concordar com uma coisa
     que não existe mais.

     Com o voto sendo da ficha inteira, isso deixou de valer. O que se aprova
     agora é o take da pessoa sobre o filme — "boa avaliação", "achei alto
     demais" — e um take continua sendo o mesmo take depois de a pessoa ajustar
     meio ponto em fotografia. Apagar a concordância do clube a cada retoque
     seria cobrar um preço alto por corrigir um número, e o efeito prático seria
     ninguém mais corrigir.

     Uma regravação que vira o take do avesso existe, e para ela a resposta
     honesta é a conversa que já mora embaixo da ficha, não um DELETE
     silencioso. */
  await upsertStmt.run({
    id, reviewerId, movieId: movie.id,
    movieTitle: movie.title, movieYear: movie.year ?? null, movieGenre: genre,
    moviePoster: movie.poster ?? null, movieDirector: movie.director ?? null,
    movieRuntime: Number.isFinite(Number(movie.runtime)) && Number(movie.runtime) > 0
      ? Math.round(Number(movie.runtime))
      : null,
    scores: JSON.stringify(cleanScores), final, date, comment: cleanComment || null
  });
  await deleteWatchlistStmt.run(movie.id);
  /* O acervo é a outra tela que filtra o banco, e um filme avaliado fica nele
     para sempre — então é aqui que ele precisa aprender os nomes por que vai
     ser procurado. Antes de reler a linha, para a resposta já sair com eles. */
  await fillEnglishTitle(movie.id);

  /* Dois avisos porque gravar uma nota mexe em duas coleções: a ficha entra no
     acervo e o filme sai da fila (`deleteWatchlistStmt`, acima). Um aviso só
     deixaria a fila de todo mundo com um filme que já foi visto e avaliado — e
     seria a tela ao vivo divergindo da tela recarregada, que é o defeito exato
     que este mecanismo não pode ter. */
  live.emit('reviews', reviewerId);
  live.emit('watchlist', reviewerId);

  const saved = await savedStmt.get(reviewerId, movie.id);
  res.status(201).json(toReviewDTO(saved));
}));

/* A take belongs to whoever gave it, and to nobody else — not to the admin
   either. Removing a rating is not moderation, it is unsaying an opinion, and
   the one thing this club's record is for is that each person's opinion stands
   as they left it. Writing is already closed the same way: the session signs
   the take, so there is no request anyone can send that edits somebody else's.
   Without this check any signed-in member could quietly erase another's
   rating. */
router.delete('/:id', auth.requireSession, wrap(async (req, res) => {
  const row = await ownerStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Avaliação não encontrada.' });
  if (row.reviewer_id !== req.session.reviewer_id) {
    return res.status(403).json({ error: 'Você só pode excluir as suas próprias avaliações.' });
  }
  await deleteStmt.run(row.id);
  /* A ficha leva a conversa dela junto, em cascata — então a conversa também
     mudou para quem está com a tela aberta. */
  live.emit('reviews', req.session.reviewer_id);
  live.emit('social', req.session.reviewer_id);
  res.status(204).end();
}));

module.exports = router;
