const express = require('express');
const db = require('../db');
const series = require('../series');
const { cacheShow, cacheEpisodes } = require('../showcache');
const wrap = require('../wrap');
const { providerCache } = require('../providers');
const { GENRES, seasonCritsFor } = require('../criteria');
const { cleanEpisodeRef } = require('../show');

const router = express.Router();

const getShowCache = db.prepare('SELECT * FROM shows_cache WHERE tmdb_id = ?');

const cacheAll = results => Promise.all(results.map(cacheShow));

const fillProviders = providerCache({
  table: 'shows_cache',
  kind: 'show',
  fetch: id => series.watchProvidersFor(id),
});

router.get('/criteria', (req, res) => {
  const criteria = {};
  for (const genre of GENRES) criteria[genre] = seasonCritsFor(genre);
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

router.get('/:id(\\d+)', wrap(async (req, res) => {
  const id = Number(req.params.id);
  try {
    const show = await series.showDetails(id);
    await cacheShow(show);
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

router.get('/:showId(\\d+)/episode/:season(\\d+)/:episode(\\d+)', wrap(async (req, res) => {
  const limpo = cleanEpisodeRef(req.params);
  if (limpo.error) return res.status(400).json({ error: limpo.error });
  const { showId, season, episode } = limpo.ref;
  const found = await series.episodeDetails(showId, season, episode);
  await cacheEpisodes(showId, [found]);
  res.json({ episode: found });
}));

module.exports = router;
