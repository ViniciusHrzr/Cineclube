const express = require('express');
const db = require('../lib/db');
const tmdb = require('../tmdb/tmdb');
const series = require('../tmdb/series');
const wrap = require('../lib/wrap');
const { trailerCache } = require('../tmdb/trailers');
const { GENRES, GENRE_TO_TMDB } = require('../rules/criteria');

const router = express.Router();

const PER_PAGE = 20;
const MAX_PINNED = 12;
const MAX_SEEDS = 4;

const fillMovieTrailers = trailerCache({ table: 'movies_cache', fetch: id => tmdb.videosFor(id) });
const fillShowTrailers = trailerCache({ table: 'shows_cache', fetch: id => series.videosFor(id) });

const rememberMovie = db.prepare(
  'UPDATE movies_cache SET backdrop = ?, overview = ? WHERE tmdb_id = ?'
);
const rememberShow = db.prepare(
  'UPDATE shows_cache SET backdrop = ?, overview = ? WHERE tmdb_id = ?'
);

const world = kind =>
  kind === 'show'
    ? {
        kind: 'show',
        genres: Object.keys(series.GENRE_TO_TV),
        popular: page => series.popularShows(page),
        discover: (genre, page) => series.discoverShows(series.GENRE_TO_TV[genre], page),
        details: id => series.showDetails(id),
        like: (id, page) => series.recommendations(id, page),
        fillTrailers: fillShowTrailers,
        remember: rememberShow,
        cache: db.prepare('SELECT * FROM shows_cache WHERE tmdb_id = ?'),
      }
    : {
        kind: 'movie',
        genres: GENRES,
        popular: page => tmdb.popularMovies(page),
        discover: (genre, page) => tmdb.discoverMovies(GENRE_TO_TMDB[genre], page),
        details: id => tmdb.movieDetails(id),
        like: (id, page) => tmdb.recommendations(id, page),
        fillTrailers: fillMovieTrailers,
        remember: rememberMovie,
        cache: db.prepare('SELECT * FROM movies_cache WHERE tmdb_id = ?'),
      };

const reelDTO = (o, kind) => ({
  id: o.id,
  kind,
  title: o.title,
  original: o.original ?? null,
  year: o.year ?? null,
  genre: o.genre,
  genres: o.genres || [o.genre],
  poster: o.poster ?? null,
  backdrop: o.backdrop ?? null,
  overview: o.overview ?? null,
  crowd: o.crowd ?? null,
  trailerKey: o.trailerKey,
});

const fromCache = c => ({
  id: c.tmdb_id,
  title: c.title,
  original: c.original_title ?? null,
  year: c.year,
  genre: c.genre,
  genres: c.genres ? c.genres.split(',') : [c.genre],
  poster: c.poster,
  backdrop: c.backdrop ?? null,
  overview: c.overview ?? null,
  crowd: c.tmdb_votes > 0 ? { score: c.tmdb_score, votes: c.tmdb_votes } : null,
});

router.get('/genres', (req, res) => {
  res.json({ genres: world(req.query.kind).genres });
});

async function likeOf(w, seeds, page, genre) {
  const lists = await Promise.all(
    seeds.map(id => w.like(id, page).then(r => r.results).catch(() => []))
  );
  const out = [];
  const seen = new Set(seeds);
  for (let i = 0; out.length < PER_PAGE * 2; i++) {
    if (lists.every(l => i >= l.length)) break;
    for (const list of lists) {
      const item = list[i];
      if (!item || seen.has(item.id)) continue;
      if (genre && !(item.genres || [item.genre]).includes(genre)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

router.get('/', wrap(async (req, res) => {
  const w = world(req.query.kind);
  const page = Number(req.query.page) || 1;
  const genre = req.query.genre;
  const known = genre && w.genres.includes(genre);
  const seeds = String(req.query.like || '')
    .split(',')
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0)
    .slice(0, MAX_SEEDS);

  try {
    const suggested = seeds.length ? await likeOf(w, seeds, page, known ? genre : null) : [];
    const data =
      suggested.length >= PER_PAGE
        ? { page, totalPages: null, results: suggested }
        : known
          ? await w.discover(genre, page)
          : await w.popular(page);
    const seen = new Set(suggested.map(r => r.id));
    const results = suggested
      .concat(suggested.length >= PER_PAGE ? [] : data.results.filter(r => !seen.has(r.id)))
      .slice(0, PER_PAGE);
    await w.fillTrailers(results);
    for (const r of results) {
      w.remember.run(r.backdrop ?? null, r.overview ?? null, r.id).catch(() => {});
    }
    res.json({
      page,
      totalPages: data.totalPages ?? page + 1,
      results: results.filter(r => r.trailerKey).map(r => reelDTO(r, w.kind)),
    });
  } catch (e) {
    console.error('[reels] página falhou:', e.message);
    res.status(502).json({ error: 'Não foi possível falar com o TMDB agora.' });
  }
}));

router.get('/pinned', wrap(async (req, res) => {
  const w = world(req.query.kind);
  const ids = String(req.query.ids || '')
    .split(',')
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0)
    .slice(0, MAX_PINNED);
  if (!ids.length) return res.json({ results: [] });

  const found = new Map();
  for (const id of ids) {
    try {
      const row = await w.cache.get(id);
      if (row?.backdrop) found.set(id, fromCache(row));
    } catch {
    }
  }

  await Promise.all(
    ids
      .filter(id => !found.has(id))
      .map(async id => {
        try {
          const full = await w.details(id);
          found.set(id, full);
          w.remember.run(full.backdrop ?? null, full.overview ?? null, id).catch(() => {});
        } catch {
        }
      })
  );

  const results = ids.map(id => found.get(id)).filter(Boolean);
  await w.fillTrailers(results);
  res.json({ results: results.filter(r => r.trailerKey).map(r => reelDTO(r, w.kind)) });
}));

module.exports = router;
