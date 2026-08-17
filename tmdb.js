const { genreFromTmdbIds, genresFromTmdbIds } = require('./criteria');

const API_BASE = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p/w342';

const TOKEN = process.env.TMDB_TOKEN;

if (!TOKEN) {
  console.warn('[tmdb] TMDB_TOKEN não configurado — as chamadas ao TMDB vão falhar.');
}

async function tmdbGet(pathname, params) {
  const url = new URL(API_BASE + pathname);
  url.searchParams.set('language', 'pt-BR');
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`TMDB ${res.status} ${res.statusText}: ${body}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function posterUrl(path) {
  return path ? IMG_BASE + path : null;
}

/* `genre` is the one it opens on; `genres` is everything it could be rated as.
   Both travel, because a poster in a grid only needs the first and the rating
   screen needs all of them. */
function normalizeListItem(m) {
  return {
    id: m.id,
    title: m.title,
    year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
    genre: genreFromTmdbIds(m.genre_ids),
    genres: genresFromTmdbIds(m.genre_ids),
    poster: posterUrl(m.poster_path)
  };
}

async function searchMovies(query, page = 1) {
  const data = await tmdbGet('/search/movie', { query, page, include_adult: false });
  return {
    page: data.page,
    totalPages: data.total_pages,
    results: (data.results || []).map(normalizeListItem)
  };
}

async function popularMovies(page = 1) {
  const data = await tmdbGet('/movie/popular', { page });
  return {
    page: data.page,
    totalPages: data.total_pages,
    results: (data.results || []).map(normalizeListItem)
  };
}

async function discoverMovies(tmdbGenreIds, page = 1) {
  const data = await tmdbGet('/discover/movie', {
    with_genres: tmdbGenreIds,
    sort_by: 'popularity.desc',
    page
  });
  return {
    page: data.page,
    totalPages: data.total_pages,
    results: (data.results || []).map(normalizeListItem)
  };
}

async function movieDetails(id) {
  const m = await tmdbGet(`/movie/${id}`, { append_to_response: 'credits,videos' });
  const director = (m.credits?.crew || []).find(c => c.job === 'Director');
  const cast = (m.credits?.cast || []).slice(0, 6).map(c => ({ name: c.name, character: c.character }));
  const trailer = (m.videos?.results || [])
    .filter(v => v.site === 'YouTube' && v.type === 'Trailer')
    .sort((a, b) => (b.official === a.official ? 0 : b.official ? 1 : -1))[0];
  return {
    id: m.id,
    title: m.title,
    year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
    genre: genreFromTmdbIds((m.genres || []).map(g => g.id)),
    genres: genresFromTmdbIds((m.genres || []).map(g => g.id)),
    poster: posterUrl(m.poster_path),
    director: director ? director.name : null,
    overview: m.overview || null,
    cast,
    trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null
  };
}

module.exports = { searchMovies, popularMovies, discoverMovies, movieDetails };
