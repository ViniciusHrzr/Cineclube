const express = require('express');
const db = require('../db');
const tmdb = require('../tmdb');
const wrap = require('../wrap');
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
    // list of one, and the screen that offers a choice simply has nothing to
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

/* ══════════════════════════════════════════════════════════════════════════
   Onde cada filme da grade está passando.

   The list endpoints do not carry providers — only the per-film one does — so a
   page of twenty posters is twenty extra requests the first time it is seen.
   That is the whole problem this solves, and it solves it by only ever paying
   for it once per film per week.

   Three properties worth stating, because each one is a way this could have
   gone wrong:

   · It never fails the page. A film whose providers could not be fetched
     simply has none, which is a state the card already has to draw for the
     many films that genuinely stream nowhere.
   · It never blocks on the whole batch. The fetches run together with a
     ceiling on how many are in flight, and the route moves on regardless.
   · It never serves a stale answer as a fresh one. A catalogue moves, and
     "está na Netflix" being wrong is worse than being absent, so the row
     carries when it was asked and is refetched once that goes cold.
   ══════════════════════════════════════════════════════════════════════════ */

/* A week. Long enough that the club never pays for the same film twice in a
   sitting, short enough that a film leaving a service is wrong for days rather
   than forever. */
const PROVIDERS_TTL = "-7 days";
/* How many provider requests are in the air at once. TMDB tolerates far more,
   but this runs on one small instance and a catalogue page is not worth
   twenty simultaneous sockets. */
const PROVIDERS_LANES = 6;

/* Built per call because the number of ids varies, which is only possible
   because `db.prepare` here is a thin wrapper that holds a string — nothing is
   compiled until the statement is executed. The ids are still bound as
   parameters; the only thing interpolated is how many question marks there
   are. */
const freshProviders = count => db.prepare(`
  SELECT tmdb_id, providers FROM movies_cache
  WHERE tmdb_id IN (${Array.from({ length: count }, () => '?').join(',')})
    AND providers IS NOT NULL
    AND providers_at > datetime('now', '${PROVIDERS_TTL}')
`);
const saveProvidersStmt = db.prepare(
  "UPDATE movies_cache SET providers = ?, providers_at = datetime('now') WHERE tmdb_id = ?"
);

/** Runs `job` over `items`, at most `lanes` at a time. Rejections are the caller's. */
async function inLanes(items, lanes, job) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(lanes, queue.length) }, async () => {
    while (queue.length) await job(queue.shift());
  });
  await Promise.all(workers);
}

/** Attaches `watch` to every result, from the cache where it is fresh. */
async function fillProviders(results) {
  if (!results.length) return results;

  const known = new Map();
  try {
    const ids = results.map(m => m.id);
    // Spread, not the array itself: a single array argument would be read as
    // one positional parameter rather than as the list of them.
    for (const row of await freshProviders(ids.length).all(...ids)) {
      known.set(Number(row.tmdb_id), JSON.parse(row.providers));
    }
  } catch (e) {
    // A cache that cannot be read is a cache miss, not an error.
    console.warn('[catalog] providers em cache ilegíveis:', e.message);
  }

  const missing = results.filter(m => !known.has(m.id));
  await inLanes(missing, PROVIDERS_LANES, async m => {
    try {
      const watch = await tmdb.watchProvidersFor(m.id);
      known.set(m.id, watch);
      /* Null is cached too, and deliberately: "nothing streams this here" is an
         answer, and not writing it would make every film that streams nowhere
         cost a request on every single page view, forever. */
      await saveProvidersStmt.run(JSON.stringify(watch), m.id);
    } catch (e) {
      /* Left out of `known`, so this film shows nothing and is asked again next
         time. One unreachable film must not cost the other nineteen. */
    }
  });

  for (const m of results) m.watch = known.get(m.id) ?? null;
  return results;
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
