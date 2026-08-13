const express = require('express');
const db = require('../db');
const tmdb = require('../tmdb');
const { GENRES, GENRE_TO_TMDB, critsFor } = require('../criteria');

const router = express.Router();

const upsertCache = db.prepare(`
  INSERT INTO movies_cache (tmdb_id, title, year, genre, poster, director, cached_at)
  VALUES (@id, @title, @year, @genre, @poster, @director, datetime('now'))
  ON CONFLICT(tmdb_id) DO UPDATE SET
    title = excluded.title, year = excluded.year, genre = excluded.genre,
    poster = excluded.poster, director = excluded.director, cached_at = excluded.cached_at
`);
const getCache = db.prepare('SELECT * FROM movies_cache WHERE tmdb_id = ?');

function cacheMovie(m) {
  try { upsertCache.run({ id: m.id, title: m.title, year: m.year ?? null, genre: m.genre, poster: m.poster ?? null, director: m.director ?? null }); }
  catch (e) { console.warn('[catalog] falha ao cachear filme', m.id, e.message); }
}

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

router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ page: 1, totalPages: 0, results: [] });
  try {
    const data = await tmdb.searchMovies(q, Number(req.query.page) || 1);
    data.results.forEach(cacheMovie);
    res.json(data);
  } catch (e) {
    console.error('[catalog] search falhou:', e.message);
    res.status(502).json({ error: 'Não foi possível buscar no TMDB agora.' });
  }
});

router.get('/popular', async (req, res) => {
  try {
    const data = await tmdb.popularMovies(Number(req.query.page) || 1);
    data.results.forEach(cacheMovie);
    res.json(data);
  } catch (e) {
    console.error('[catalog] popular falhou:', e.message);
    const cached = db.prepare('SELECT * FROM movies_cache ORDER BY cached_at DESC LIMIT 20').all();
    if (cached.length) {
      return res.json({
        page: 1, totalPages: 1, stale: true,
        results: cached.map(c => ({ id: c.tmdb_id, title: c.title, year: c.year, genre: c.genre, poster: c.poster }))
      });
    }
    res.status(502).json({ error: 'Não foi possível falar com o TMDB agora.' });
  }
});

router.get('/discover', async (req, res) => {
  const genre = req.query.genre;
  const tmdbIds = GENRE_TO_TMDB[genre];
  if (!tmdbIds) return res.status(400).json({ error: 'Gênero desconhecido.' });
  try {
    const data = await tmdb.discoverMovies(tmdbIds, Number(req.query.page) || 1);
    data.results.forEach(cacheMovie);
    res.json(data);
  } catch (e) {
    console.error('[catalog] discover falhou:', e.message);
    res.status(502).json({ error: 'Não foi possível falar com o TMDB agora.' });
  }
});

router.get('/movie/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const movie = await tmdb.movieDetails(id);
    cacheMovie(movie);
    res.json(movie);
  } catch (e) {
    console.error('[catalog] detalhe falhou:', e.message);
    const cached = getCache.get(id);
    if (cached) {
      return res.json({
        id: cached.tmdb_id, title: cached.title, year: cached.year,
        genre: cached.genre, poster: cached.poster, director: cached.director, stale: true
      });
    }
    res.status(502).json({ error: 'Não foi possível obter os detalhes do filme agora.' });
  }
});

module.exports = router;
