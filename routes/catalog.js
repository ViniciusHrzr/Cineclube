const express = require('express');
const db = require('../lib/db');
const tmdb = require('../tmdb/tmdb');
const wrap = require('../lib/wrap');
const { providerCache } = require('../tmdb/providers');
const { GENRES, GENRE_TO_TMDB, critsFor } = require('../rules/criteria');

const router = express.Router();

const upsertCache = db.prepare(`  INSERT INTO movies_cache (tmdb_id, title, original_title, english_title, year, genre, genres, poster, backdrop, overview, director, runtime, tmdb_score, tmdb_votes, cached_at)
  VALUES (@id, @title, @original, @english, @year, @genre, @genres, @poster, @backdrop, @overview, @director, @runtime, @score, @votes, datetime('now'))
  ON CONFLICT(tmdb_id) DO UPDATE SET
    title = excluded.title, year = excluded.year, genre = excluded.genre,
    genres = excluded.genres,

    original_title = excluded.original_title,

    english_title = COALESCE(excluded.english_title, movies_cache.english_title),
    poster = excluded.poster, director = excluded.director,

    backdrop = COALESCE(excluded.backdrop, movies_cache.backdrop),
    overview = COALESCE(excluded.overview, movies_cache.overview),
    runtime = COALESCE(excluded.runtime, movies_cache.runtime),
    tmdb_score = COALESCE(excluded.tmdb_score, movies_cache.tmdb_score),
    tmdb_votes = COALESCE(excluded.tmdb_votes, movies_cache.tmdb_votes),
    cached_at = excluded.cached_at
`);

function fromCache(c) {
  return {
    id: c.tmdb_id,
    title: c.title,
    original: c.original_title ?? null,
    english: c.english_title ?? null,
    year: c.year,
    genre: c.genre,
    genres: c.genres ? c.genres.split(',') : [c.genre],
    poster: c.poster,
    backdrop: c.backdrop ?? null,
    overview: c.overview ?? null,
    director: c.director ?? null,
    runtime: c.runtime ?? null,
    crowd: c.tmdb_votes > 0 ? { score: c.tmdb_score, votes: c.tmdb_votes } : null,
  };
}
const getCache = db.prepare('SELECT * FROM movies_cache WHERE tmdb_id = ?');
const recentCache = db.prepare('SELECT * FROM movies_cache ORDER BY cached_at DESC LIMIT 20');

async function cacheMovie(m) {
  try {
    await upsertCache.run({
      id: m.id, title: m.title, original: m.original ?? null, english: m.english ?? null,
      year: m.year ?? null, genre: m.genre,
      backdrop: m.backdrop ?? null, overview: m.overview ?? null,
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
