const express = require('express');
const db = require('../db');
const series = require('../series');
const wrap = require('../wrap');
const { providerCache } = require('../providers');
const { GENRES, episodeCritsFor } = require('../criteria');
const { cleanEpisodeRef } = require('../show');

const router = express.Router();

/* Irmão de routes/catalog.js. Não é escopado por clube porque o TMDB não é de
   clube nenhum. O que é do clube — a fila e o que cada um viu — mora em
   routes/shows.js, debaixo de /api/c/<slug>. */

const upsertShow = db.prepare(`
  INSERT INTO shows_cache
    (tmdb_id, title, original_title, english_title, year, genre, genres, poster,
     backdrop, overview, status, seasons, episodes, runtime, tmdb_score, tmdb_votes, cached_at)
  VALUES
    (@id, @title, @original, @english, @year, @genre, @genres, @poster,
     @backdrop, @overview, @status, @seasons, @episodes, @runtime, @score, @votes, datetime('now'))
  ON CONFLICT(tmdb_id) DO UPDATE SET
    title = excluded.title, year = excluded.year, genre = excluded.genre,
    genres = excluded.genres, poster = excluded.poster,
    backdrop = COALESCE(excluded.backdrop, shows_cache.backdrop),
    overview = COALESCE(excluded.overview, shows_cache.overview),
    original_title = excluded.original_title,
    -- COALESCE nos campos que só o detalhe carrega: uma página de busca
    -- escrevendo por cima desta linha não sabe nada sobre eles, e não pode
    -- apagar o que uma abertura de série já descobriu.
    english_title = COALESCE(excluded.english_title, shows_cache.english_title),
    status = COALESCE(excluded.status, shows_cache.status),
    seasons = COALESCE(excluded.seasons, shows_cache.seasons),
    episodes = COALESCE(excluded.episodes, shows_cache.episodes),
    runtime = COALESCE(excluded.runtime, shows_cache.runtime),
    tmdb_score = COALESCE(excluded.tmdb_score, shows_cache.tmdb_score),
    tmdb_votes = COALESCE(excluded.tmdb_votes, shows_cache.tmdb_votes),
    cached_at = excluded.cached_at
`);

const upsertEpisode = db.prepare(`
  INSERT INTO episodes_cache
    (show_id, season, episode, title, overview, still, air_date, runtime, kind, cached_at)
  VALUES (@showId, @season, @episode, @title, @overview, @still, @airDate, @runtime, @kind, datetime('now'))
  ON CONFLICT(show_id, season, episode) DO UPDATE SET
    title = excluded.title, overview = excluded.overview, still = excluded.still,
    air_date = excluded.air_date, runtime = excluded.runtime, kind = excluded.kind,
    cached_at = excluded.cached_at
`);

const getShowCache = db.prepare('SELECT * FROM shows_cache WHERE tmdb_id = ?');

/* O cache é conveniência e não a resposta: se gravar falhar, quem pediu ainda
   recebe o que o TMDB mandou. O erro para aqui. */
async function cacheShow(s) {
  try {
    await upsertShow.run({
      id: s.id, title: s.title, original: s.original ?? null, english: s.english ?? null,
      year: s.year ?? null, genre: s.genre, genres: (s.genres || [s.genre]).join(','),
      poster: s.poster ?? null, backdrop: s.backdrop ?? null,
      overview: s.overview ?? null, status: s.status ?? null,
      seasons: s.seasons ? s.seasons.length : null,
      episodes: s.totalEpisodes ?? null, runtime: s.runtime ?? null,
      score: s.crowd?.score ?? null, votes: s.crowd?.votes ?? null,
    });
  } catch (e) {
    console.warn('[series] falha ao cachear série', s.id, e.message);
  }
}

async function cacheEpisodes(showId, episodes) {
  try {
    if (!episodes.length) return;
    await db.batch(episodes.map(e => ({
      sql: `INSERT INTO episodes_cache
              (show_id, season, episode, title, overview, still, air_date, runtime, kind, cached_at)
            VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))
            ON CONFLICT(show_id, season, episode) DO UPDATE SET
              title = excluded.title, overview = excluded.overview,
              still = excluded.still, air_date = excluded.air_date,
              runtime = excluded.runtime, kind = excluded.kind,
              cached_at = excluded.cached_at`,
      args: [showId, e.season, e.episode, e.title, e.overview ?? null, e.still ?? null,
             e.airDate ?? null, e.runtime ?? null, e.kind ?? null],
    })));
  } catch (e) {
    console.warn('[series] falha ao cachear episódios de', showId, e.message);
  }
}

const cacheAll = results => Promise.all(results.map(cacheShow));

/* Onde cada série da grade está passando. O mecanismo é o de providers.js, e a
   pergunta vale MAIS aqui do que num filme: quase todo filme pode ser alugado
   em algum lugar, e por isso a linha de aluguel foi cortada; uma série ou está
   incluída numa assinatura que alguém já paga, ou o clube não vai maratoná-la. */
const fillProviders = providerCache({
  table: 'shows_cache',
  kind: 'show',
  fetch: id => series.watchProvidersFor(id),
});

/* Servido por gênero porque o gênero da SÉRIE decide o vocabulário — vozes numa
   animação, estrutura num documentário — sem nunca acrescentar pergunta. Ver
   criteria.js. */
router.get('/criteria', (req, res) => {
  const criteria = {};
  for (const genre of GENRES) criteria[genre] = episodeCritsFor(genre);
  res.json({ genres: GENRES, criteria });
});

router.get('/popular', wrap(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const data = await series.popularShows(page);
  await cacheAll(data.results);
  await fillProviders(data.results);
  res.json(data);
}));

router.get('/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ page: 1, totalPages: 0, results: [] });
  const data = await series.searchShows(q, Number(req.query.page) || 1);
  await cacheAll(data.results);
  await fillProviders(data.results);
  res.json(data);
}));

router.get('/genre/:genre', wrap(async (req, res) => {
  const ids = series.GENRE_TO_TV[req.params.genre];
  if (!ids) return res.status(404).json({ error: 'Gênero desconhecido.' });
  const data = await series.discoverShows(ids, Number(req.query.page) || 1);
  await cacheAll(data.results);
  await fillProviders(data.results);
  res.json(data);
}));

/* Cai no cache quando o TMDB não responde: uma série no acervo do clube tem de
   continuar legível com a rede fora. */
router.get('/:id(\\d+)', wrap(async (req, res) => {
  const id = Number(req.params.id);
  try {
    const show = await series.showDetails(id);
    await cacheShow(show);
    // Pelo mesmo caminho da grade, e pela mesma razão — ver routes/catalog.js.
    await fillProviders([show]);
    res.json({ show });
  } catch (e) {
    const cached = await getShowCache.get(id);
    if (!cached) throw e;
    res.json({
      show: {
        id: cached.tmdb_id,
        title: cached.title,
        original: cached.original_title ?? null,
        english: cached.english_title ?? null,
        year: cached.year,
        genre: cached.genre,
        genres: cached.genres ? cached.genres.split(',') : [cached.genre],
        poster: cached.poster,
        status: cached.status ?? null,
        runtime: cached.runtime ?? null,
        totalEpisodes: cached.episodes ?? null,
        crowd: cached.tmdb_votes > 0 ? { score: cached.tmdb_score, votes: cached.tmdb_votes } : null,
        /* Sem a lista de temporadas: ela não está em cache, e inventá-la vazia
           faria a tela dizer que a série não tem nenhuma. `null` é a diferença
           entre "não sei agora" e "não tem". */
        seasons: null,
        stale: true,
      },
    });
  }
}));

router.get('/:id(\\d+)/season/:season(\\d+)', wrap(async (req, res) => {
  const showId = Number(req.params.id);
  const season = await series.seasonDetails(showId, Number(req.params.season));
  await cacheEpisodes(showId, season.episodes);
  res.json({ season });
}));

/* Os nomes de direção e roteiro mudam a cada episódio, e é isso que faz a
   avaliação por episódio ser sobre alguém e não sobre um número. */
router.get('/:showId(\\d+)/episode/:season(\\d+)/:episode(\\d+)', wrap(async (req, res) => {
  const limpo = cleanEpisodeRef(req.params);
  if (limpo.error) return res.status(400).json({ error: limpo.error });
  const { showId, season, episode } = limpo.ref;
  const found = await series.episodeDetails(showId, season, episode);
  await cacheEpisodes(showId, [found]);
  res.json({ episode: found });
}));

module.exports = router;
