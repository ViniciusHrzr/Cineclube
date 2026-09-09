const express = require('express');
const db = require('../db');
const tmdb = require('../tmdb');
const wrap = require('../wrap');
const { providerCache } = require('../providers');
const { GENRES, GENRE_TO_TMDB, critsFor } = require('../criteria');

const router = express.Router();

/* The runtime only ever arrives from the details endpoint, so a search or a
   popular page writing over a cached row must not blank out the number a
   previous detail fetch put there — hence COALESCE rather than excluded. */
const upsertCache = db.prepare(`
  INSERT INTO movies_cache (tmdb_id, title, original_title, english_title, year, genre, genres, poster, director, runtime, tmdb_score, tmdb_votes, cached_at)
  VALUES (@id, @title, @original, @english, @year, @genre, @genres, @poster, @director, @runtime, @score, @votes, datetime('now'))
  ON CONFLICT(tmdb_id) DO UPDATE SET
    title = excluded.title, year = excluded.year, genre = excluded.genre,
    genres = excluded.genres,
    -- Written flat rather than COALESCEd: every endpoint carries this one, so a
    -- null here is TMDB saying the two titles are now the same string, not a
    -- cheaper endpoint failing to mention it.
    original_title = excluded.original_title,
    -- COALESCEd for the opposite reason: only the details endpoint carries it,
    -- so a search page writing over this row knows nothing about the English
    -- name and must not blank out what a detail fetch already found.
    english_title = COALESCE(excluded.english_title, movies_cache.english_title),
    poster = excluded.poster, director = excluded.director,
    runtime = COALESCE(excluded.runtime, movies_cache.runtime),
    tmdb_score = COALESCE(excluded.tmdb_score, movies_cache.tmdb_score),
    tmdb_votes = COALESCE(excluded.tmdb_votes, movies_cache.tmdb_votes),
    cached_at = excluded.cached_at
`);

/** A cached row back into the shape the client speaks. */
function fromCache(c) {
  return {
    id: c.tmdb_id,
    title: c.title,
    original: c.original_title ?? null,
    english: c.english_title ?? null,
    year: c.year,
    genre: c.genre,
    // Rows written before the column existed still know one genre; one is a
    // list of one, and the screen that offers a choice has nothing to choose
    // between.
    // choose between.
    genres: c.genres ? c.genres.split(',') : [c.genre],
    poster: c.poster,
    director: c.director ?? null,
    runtime: c.runtime ?? null,
    crowd: c.tmdb_votes > 0 ? { score: c.tmdb_score, votes: c.tmdb_votes } : null,
  };
}
const getCache = db.prepare('SELECT * FROM movies_cache WHERE tmdb_id = ?');
const recentCache = db.prepare('SELECT * FROM movies_cache ORDER BY cached_at DESC LIMIT 20');

// The cache is a convenience, not the answer: if writing it fails the visitor
// still gets what TMDB sent, so the error stops here.
async function cacheMovie(m) {
  try {
    await upsertCache.run({
      id: m.id, title: m.title, original: m.original ?? null, english: m.english ?? null,
      year: m.year ?? null, genre: m.genre,
      genres: (m.genres || [m.genre]).join(','),
      poster: m.poster ?? null, director: m.director ?? null,
      runtime: m.runtime ?? null,
      score: m.crowd?.score ?? null, votes: m.crowd?.votes ?? null
    });
  } catch (e) {
    console.warn('[catalog] falha ao cachear filme', m.id, e.message);
  }
}

const cacheAll = results => Promise.all(results.map(cacheMovie));

/** Onde cada filme da grade está passando. As regras estão em providers.js. */
const fillProviders = providerCache({
  table: 'movies_cache',
  kind: 'movie',
  fetch: id => tmdb.watchProvidersFor(id),
});

router.get('/genres', (req, res) => {
  res.json({ genres: GENRES });
});

router.get('/criteria', (req, res) => {
  const genre = req.query.genre;
  res.json({ genre: genre && GENRES.includes(genre) ? genre : 'Drama', criteria: critsFor(genre) });
});

router.get('/criteria-all', (req, res) => {
  const criteria = {};
  for (const g of GENRES) criteria[g] = critsFor(g);
  res.json({ genres: GENRES, criteria });
});

router.get('/search', wrap(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ page: 1, totalPages: 0, results: [] });
  try {
    const data = await tmdb.searchMovies(q, Number(req.query.page) || 1);
    // Cached first: `fillProviders` writes onto rows that have to exist.
    await cacheAll(data.results);
    await fillProviders(data.results);
    res.json(data);
  } catch (e) {
    console.error('[catalog] search falhou:', e.message);
    res.status(502).json({ error: 'Não foi possível buscar no TMDB agora.' });
  }
}));

router.get('/popular', wrap(async (req, res) => {
  try {
    const data = await tmdb.popularMovies(Number(req.query.page) || 1);
    await cacheAll(data.results);
    await fillProviders(data.results);
    res.json(data);
  } catch (e) {
    console.error('[catalog] popular falhou:', e.message);
    const cached = await recentCache.all();
    if (cached.length) {
      return res.json({
        page: 1, totalPages: 1, stale: true,
        results: cached.map(fromCache)
      });
    }
    res.status(502).json({ error: 'Não foi possível falar com o TMDB agora.' });
  }
}));

router.get('/discover', wrap(async (req, res) => {
  const genre = req.query.genre;
  const tmdbIds = GENRE_TO_TMDB[genre];
  if (!tmdbIds) return res.status(400).json({ error: 'Gênero desconhecido.' });
  try {
    const data = await tmdb.discoverMovies(tmdbIds, Number(req.query.page) || 1);
    await cacheAll(data.results);
    await fillProviders(data.results);
    res.json(data);
  } catch (e) {
    console.error('[catalog] discover falhou:', e.message);
    res.status(502).json({ error: 'Não foi possível falar com o TMDB agora.' });
  }
}));

router.get('/movie/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  try {
    const movie = await tmdb.movieDetails(id);
    await cacheMovie(movie);
    /* O detalhe já traz `watch` de graça, e mesmo assim ele passa por aqui: é
       este caminho que pendura o link fundo de cada serviço e que guarda a
       resposta pelos sete dias. Uma ficha aberta duas vezes na mesma noite não
       pode custar duas voltas ao JustWatch. */
    await fillProviders([movie]);
    res.json(movie);
  } catch (e) {
    console.error('[catalog] detalhe falhou:', e.message);
    const cached = await getCache.get(id);
    if (cached) {
      return res.json({ ...fromCache(cached), stale: true });
    }
    res.status(502).json({ error: 'Não foi possível obter os detalhes do filme agora.' });
  }
}));

module.exports = router;
