const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const auth = require('../auth');
const clubs = require('../clubs');
const wrap = require('../wrap');
const { answeredIn, critsFor, finalOf, GENRES } = require('../criteria');
const { fillEnglishTitle } = require('../english');
const { cleanMovie } = require('../movie');
const throttle = require('../throttle');
const live = require('../live');

const router = express.Router({ mergeParams: true });

/* ── o acervo é das PESSOAS da sala ───────────────────────────────────────
   A ficha é de quem a escreveu, e o acervo de uma sala é o das pessoas que
   estão nela; o `club_id` vira a etiqueta de onde foi gravada, que é o que o
   `origin` do DTO carrega.

   O que NÃO viaja é a conversa. Comentário, voto e curtida penduram na ficha e
   não têm sala própria (ver db.js), então a única forma de não vazarem de um
   clube fechado para outro é acontecerem onde a ficha foi gravada. As rotas de
   social cobram `rv.club_id = req.club.id`, e não mexer nessa linha é a
   decisão, não o esquecimento.

   Ler é de quem pode ler o clube — num clube público, inclusive quem está de
   fora. Escrever é sempre de membro. */
/* Duas condições e não uma. A junção com o elenco é o que faz a ficha VIAJAR:
   quem entra numa sala chega com o que já escreveu. O clube na ficha é o que
   faz ela NÃO IR EMBORA: quem sai de uma sala deixa lá o que gravou dentro dela
   — o acervo de um clube é a memória de um grupo, e uma memória que encolhe
   porque alguém foi embora não é memória.

   Toma o id da sala duas vezes, uma por condição. */
const DA_SALA = `(
  rv.club_id = ?
  OR rv.reviewer_id IN (SELECT reviewer_id FROM club_members WHERE club_id = ?)
)`;

/* The runtime is read through the cache when the take does not carry one: every
   film in the archive was opened before it was rated, so the cache almost always
   knows it.

   `clubs oc` é a sala de origem, por LEFT JOIN: uma sala apagada não pode fazer
   a ficha sumir do acervo de quem a escreveu. */
const CAMPOS = `
  rv.*, r.name AS reviewer_name, r.dot AS reviewer_dot,
  mc.runtime AS cached_runtime, mc.tmdb_score, mc.tmdb_votes,
  mc.original_title, mc.english_title,
  oc.name AS origin_name, oc.slug AS origin_slug
`;
const JUNCOES = `
  FROM reviews rv
  JOIN reviewers r ON r.id = rv.reviewer_id
  LEFT JOIN movies_cache mc ON mc.tmdb_id = rv.movie_id
  LEFT JOIN clubs oc ON oc.id = rv.club_id
`;
const listStmt = db.prepare(`
  SELECT ${CAMPOS} ${JUNCOES} WHERE ${DA_SALA} ORDER BY rv.date DESC
`);
/* `ON CONFLICT(reviewer_id, movie_id)` e não mais a trinca com o clube: uma
   ficha por pessoa por filme no produto inteiro. Regravar numa sala nova move a
   etiqueta para ela. */
const upsertStmt = db.prepare(`
  INSERT INTO reviews (id, club_id, reviewer_id, movie_id, movie_title, movie_year, movie_genre, movie_poster, movie_director, movie_runtime, scores, final, date, comment, recorded_at)
  VALUES (@id, @clubId, @reviewerId, @movieId, @movieTitle, @movieYear, @movieGenre, @moviePoster, @movieDirector, @movieRuntime, @scores, @final, @date, @comment, datetime('now'))
  ON CONFLICT(reviewer_id, movie_id) DO UPDATE SET
    -- Regravar é um acontecimento: o saguão e o sino mostram a ficha na hora em
    -- que ela mudou, em vez de escondê-la no dia em que foi criada.
    recorded_at = datetime('now'),
    club_id = excluded.club_id,
    movie_title = excluded.movie_title, movie_year = excluded.movie_year, movie_genre = excluded.movie_genre,
    movie_poster = excluded.movie_poster, movie_director = excluded.movie_director,
    movie_runtime = COALESCE(excluded.movie_runtime, reviews.movie_runtime),
    scores = excluded.scores, final = excluded.final, date = excluded.date, comment = excluded.comment
`);
const averagesStmt = db.prepare(`
  SELECT rv.movie_id, AVG(rv.final) AS avg, COUNT(*) AS count
  FROM reviews rv
  WHERE ${DA_SALA}
  GROUP BY rv.movie_id
`);
/* Sem clube na condição: a ficha é única por pessoa e filme, então esta trinca
   virou um par. */
const savedStmt = db.prepare(`
  SELECT ${CAMPOS} ${JUNCOES} WHERE rv.reviewer_id = ? AND rv.movie_id = ?
`);
/* Sem `club_id` também aqui, e não é um relaxamento: a linha seguinte cobra que
   a ficha seja de quem pediu, e a sua ficha é sua em qualquer sala. */
const ownerStmt = db.prepare('SELECT id, reviewer_id FROM reviews WHERE id = ?');
const deleteStmt = db.prepare('DELETE FROM reviews WHERE id = ?');
const deleteWatchlistStmt = db.prepare('DELETE FROM watchlist WHERE club_id = ? AND movie_id = ?');

function toReviewDTO(row, clubId) {
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
    /* Read from the film cache rather than stored with the take: it is a fact
       about the film that keeps changing and not a fact about the evening. A
       take is frozen; the number it disagrees with is not, and freezing a copy
       would turn the comparison into one with a number nobody can find. */
    crowd: row.tmdb_votes > 0 ? { score: row.tmdb_score, votes: row.tmdb_votes } : null,
    scores,
    final: row.final,
    date: row.date,
    comment: row.comment || '',
    /* De onde a ficha veio, e só quando veio de FORA desta sala: nulo é "foi
       avaliado aqui", o caso comum, e uma tarja em toda linha do acervo é uma
       tarja que ninguém lê. É também o que diz à tela que a conversa desta ficha
       não mora aqui. */
    origin:
      row.club_id && clubId && row.club_id !== clubId
        ? { name: row.origin_name ?? null, slug: row.origin_slug ?? null }
        : null,
    breakdown
  };
}

router.get('/', clubs.canRead('reviews'), wrap(async (req, res) => {
  const rows = await listStmt.all(req.club.id, req.club.id);
  res.json({ reviews: rows.map(r => toReviewDTO(r, req.club.id)) });
}));

router.get('/averages', clubs.canRead('reviews'), wrap(async (req, res) => {
  const out = {};
  for (const row of await averagesStmt.all(req.club.id, req.club.id)) {
    out[row.movie_id] = { avg: row.avg, count: row.count };
  }
  res.json({ averages: out });
}));

/* A take is signed by whoever is signed in. The body may still name a reviewer
   — the client sends it — but the session is the authority, so nobody can post
   a rating under someone else's name by editing a request. */
/* Uma ficha é onze notas lidas com calma, e regravar é comum — corrigir meio
   ponto depois da discussão é o comportamento normal aqui. Trinta por hora cobre
   uma noite de clube inteira com folga e ainda assim fecha a porta para quem
   quer encher a tabela de fichas. */
const throttleReview = throttle.limit({
  name: 'review',
  max: 30,
  windowMs: 60 * 60_000,
  message: espera => `Muitas avaliações gravadas seguidas. Tente de novo em ${espera}.`,
});

router.post('/', auth.requireSession, clubs.requireMember, throttleReview, wrap(async (req, res) => {
  const { scores, comment } = req.body || {};
  const reviewerId = req.session.reviewer_id;
  // Quem assina é a sessão, e ser membro já foi conferido pelo middleware.
  // checagem de "avaliador existe" que morava aqui era a versão sem clubes disso.
  /* O filme vem do corpo e por isso passa por movie.js: o id é escolhido por
     quem escreve, então a unicidade (uma ficha por pessoa por filme) não segura
     nada sozinha, e sem teto nos textos uma ficha só cabe um megabyte de lixo. */
  const limpo = cleanMovie(req.body?.movie);
  if (limpo.error) return res.status(400).json({ error: limpo.error });
  const movie = limpo.movie;

  if (!scores || typeof scores !== 'object') {
    return res.status(400).json({ error: 'Notas inválidas.' });
  }
  const genre = movie.genre;
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

  /* Havia aqui uma limpeza dos votos dos critérios cuja nota mudou. Com o voto
     sendo da ficha inteira isso deixou de valer: o que se aprova é o take da
     pessoa sobre o filme, e ele continua o mesmo depois de ela ajustar meio
     ponto em fotografia. Apagar a concordância do clube a cada retoque cobraria
     um preço alto por corrigir um número, e o efeito seria ninguém corrigir. */
  await upsertStmt.run({
    id, clubId: req.club.id, reviewerId, movieId: movie.id,
    movieTitle: movie.title, movieYear: movie.year, movieGenre: genre,
    moviePoster: movie.poster, movieDirector: movie.director,
    movieRuntime: movie.runtime,
    scores: JSON.stringify(cleanScores), final, date, comment: cleanComment || null
  });
  await deleteWatchlistStmt.run(req.club.id, movie.id);
  /* Um filme avaliado fica no acervo para sempre, então é aqui que ele aprende
     os nomes por que vai ser procurado. Antes de reler a linha, para a resposta
     já sair com eles. */
  await fillEnglishTitle(movie.id);

  /* Dois avisos porque gravar uma nota mexe em duas coleções: a ficha entra no
     acervo e o filme sai da fila. Um aviso só deixaria a fila de todo mundo com
     um filme já avaliado — a tela ao vivo divergindo da recarregada, que é o
     defeito exato que este mecanismo não pode ter. */
  live.emit('reviews', reviewerId, req.club.id);
  live.emit('watchlist', reviewerId, req.club.id);

  const saved = await savedStmt.get(reviewerId, movie.id);
  res.status(201).json(toReviewDTO(saved, req.club.id));
}));

/* A ficha é de quem a deu, e de mais ninguém — nem do admin. Apagar uma nota
   não é moderação, é desdizer uma opinião, e o que este registro é serve para
   que a de cada um fique como ela a deixou. Sem esta checagem qualquer membro
   logado apagaria a de outro. */
router.delete('/:id', auth.requireSession, clubs.requireMember, wrap(async (req, res) => {
  const row = await ownerStmt.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Avaliação não encontrada.' });
  if (row.reviewer_id !== req.session.reviewer_id) {
    return res.status(403).json({ error: 'Você só pode excluir as suas próprias avaliações.' });
  }
  await deleteStmt.run(row.id);
  /* A ficha leva a conversa dela junto, em cascata — então a conversa também
     mudou para quem está com a tela aberta. */
  live.emit('reviews', req.session.reviewer_id, req.club.id);
  live.emit('social', req.session.reviewer_id, req.club.id);
  res.status(204).end();
}));

module.exports = router;
