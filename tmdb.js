const { genreFromTmdbIds, genresFromTmdbIds } = require('./criteria');
const { bestVideo } = require('./video');
const { tmdbGet, posterUrl, backdropUrl, crowdOf, watchIn } = require('./tmdbapi');

function originalOf(m) {
  return m.original_title && m.original_title !== m.title ? m.original_title : null;
}

function englishOf(m, translations) {
  const en = (translations?.translations || []).find(t => t.iso_639_1 === 'en');
  const title = en?.data?.title;
  if (!title || title === m.title || title === m.original_title) return null;
  return title;
}

async function englishTitleFor(id) {
  const m = await tmdbGet(`/movie/${id}`, { append_to_response: 'translations' });
  return englishOf(m, m.translations);
}

function normalizeListItem(m) {
  return {
    id: m.id,
    title: m.title,
    original: originalOf(m),
    year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
    genre: genreFromTmdbIds(m.genre_ids),
    genres: genresFromTmdbIds(m.genre_ids),
    poster: posterUrl(m.poster_path),
    backdrop: backdropUrl(m.backdrop_path),
    overview: m.overview || null,
    crowd: crowdOf(m)
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

const SIGNED_BY = {
  direcao: ['Director'],
  roteiro: ['Screenplay', 'Writer'],
  fotografia: ['Director of Photography'],
  montagem: ['Editor'],
  som: ['Original Music Composer', 'Sound Designer'],
  arte: ['Production Design']
};

const MAX_NAMES = 3;

function signedBy(crew, cast) {
  const out = {};
  for (const [key, jobs] of Object.entries(SIGNED_BY)) {
    const names = [];
    for (const job of jobs) {
      for (const person of crew) {
        if (person.job === job && person.name && !names.includes(person.name)) names.push(person.name);
      }
    }
    if (names.length) out[key] = names.slice(0, MAX_NAMES);
  }
  const players = cast.slice(0, MAX_NAMES).map(c => c.name);
  if (players.length) {
    out.atuacoes = players;
    out.vozes = players;
  }
  return out;
}

async function watchProvidersFor(id) {
  return watchIn(await tmdbGet(`/movie/${id}/watch/providers`));
}

async function videosFor(id) {
  for (const language of ['pt-BR', 'en-US']) {
    const data = await tmdbGet(`/movie/${id}/videos`, { language });
    const v = bestVideo(data.results);
    if (v) return v.key;
  }
  return null;
}

async function recommendations(id, page = 1) {
  const data = await tmdbGet(`/movie/${id}/recommendations`, { page });
  return {
    page: data.page,
    totalPages: data.total_pages,
    results: (data.results || []).map(normalizeListItem)
  };
}

async function movieDetails(id) {
  const m = await tmdbGet(`/movie/${id}`, {
    append_to_response: 'credits,videos,watch/providers,translations'
  });
  const director = (m.credits?.crew || []).find(c => c.job === 'Director');
  const cast = (m.credits?.cast || []).slice(0, 6).map(c => ({ name: c.name, character: c.character }));
  const trailer = bestVideo(m.videos?.results);
  return {
    id: m.id,
    title: m.title,
    original: originalOf(m),
    english: englishOf(m, m.translations),
    year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
    genre: genreFromTmdbIds((m.genres || []).map(g => g.id)),
    genres: genresFromTmdbIds((m.genres || []).map(g => g.id)),
    poster: posterUrl(m.poster_path),
    backdrop: backdropUrl(m.backdrop_path),
    director: director ? director.name : null,
    runtime: m.runtime || null,
    overview: m.overview || null,
    crowd: crowdOf(m),
    cast,
    crew: signedBy(m.credits?.crew || [], m.credits?.cast || []),
    trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    watch: watchIn(m['watch/providers'])
  };
}

module.exports = {
  searchMovies, popularMovies, discoverMovies, movieDetails, watchProvidersFor,
  englishTitleFor, signedBy, englishOf, videosFor, recommendations
};
