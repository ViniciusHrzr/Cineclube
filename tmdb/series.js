const { GENRE_PRIORITY } = require('../rules/criteria');
const { bestVideo } = require('./video');
const { tmdbGet, posterUrl, backdropUrl, crowdOf, watchIn } = require('./tmdbapi');

const STILL_BASE = 'https://image.tmdb.org/t/p/w300';
const stillUrl = path => (path ? STILL_BASE + path : null);

const TV_GENRE_MAP = {
  10759: 'Ação',
  16: 'Animação',
  35: 'Comédia',
  80: 'Suspense',
  99: 'Documentário',
  18: 'Drama',
  10762: 'Animação',
  9648: 'Suspense',
  10763: 'Documentário',
  10764: 'Documentário',
  10765: 'Ficção científica',
  10766: 'Romance',
  10767: 'Documentário',
  10768: 'Drama',
  37: 'Ação'
};

const GENRE_TO_TV = {};
for (const [id, genre] of Object.entries(TV_GENRE_MAP)) {
  (GENRE_TO_TV[genre] ||= []).push(id);
}
for (const genre of Object.keys(GENRE_TO_TV)) GENRE_TO_TV[genre] = GENRE_TO_TV[genre].join(',');

function genresFromTvIds(ids) {
  const carried = new Set();
  for (const id of ids || []) {
    const genre = TV_GENRE_MAP[id];
    if (genre) carried.add(genre);
  }
  const found = GENRE_PRIORITY.filter(genre => carried.has(genre));
  return found.length ? found : ['Drama'];
}

const originalOf = s => (s.original_name && s.original_name !== s.name ? s.original_name : null);

function englishOf(s, translations) {
  const en = (translations?.translations || []).find(t => t.iso_639_1 === 'en');
  const name = en?.data?.name;
  if (!name || name === s.name || name === s.original_name) return null;
  return name;
}

function normalizeListItem(s) {
  const genres = genresFromTvIds(s.genre_ids);
  return {
    id: s.id,
    title: s.name,
    original: originalOf(s),
    year: s.first_air_date ? Number(s.first_air_date.slice(0, 4)) : null,
    genre: genres[0],
    genres,
    poster: posterUrl(s.poster_path),
    backdrop: backdropUrl(s.backdrop_path),
    overview: s.overview || null,
    crowd: crowdOf(s)
  };
}

async function searchShows(query, page = 1) {
  const data = await tmdbGet('/search/tv', { query, page, include_adult: false });
  return {
    page: data.page,
    totalPages: data.total_pages,
    results: (data.results || []).map(normalizeListItem)
  };
}

async function popularShows(page = 1) {
  const data = await tmdbGet('/tv/popular', { page });
  return {
    page: data.page,
    totalPages: data.total_pages,
    results: (data.results || []).map(normalizeListItem)
  };
}

async function discoverShows(tvGenreIds, page = 1) {
  const data = await tmdbGet('/discover/tv', {
    with_genres: tvGenreIds,
    sort_by: 'popularity.desc',
    page
  });
  return {
    page: data.page,
    totalPages: data.total_pages,
    results: (data.results || []).map(normalizeListItem)
  };
}

const isRegular = s => s.season_number > 0;

const SIGNED_BY = {
  direcao: ['Director'],
  roteiro: ['Writer', 'Screenplay', 'Teleplay', 'Story']
};
const MAX_NAMES = 3;

function signedBy(crew, guests) {
  const out = {};
  for (const [key, jobs] of Object.entries(SIGNED_BY)) {
    const names = [];
    for (const job of jobs) {
      for (const person of crew || []) {
        if (person.job === job && person.name && !names.includes(person.name)) names.push(person.name);
      }
    }
    if (names.length) out[key] = names.slice(0, MAX_NAMES);
  }
  const players = (guests || []).slice(0, MAX_NAMES).map(c => c.name).filter(Boolean);
  if (players.length) out.atuacoes = players;
  return out;
}

async function showDetails(id) {
  const s = await tmdbGet(`/tv/${id}`, {
    append_to_response: 'credits,videos,watch/providers,translations,episode_groups'
  });
  const genres = genresFromTvIds((s.genres || []).map(g => g.id));
  const trailer = bestVideo(s.videos?.results);

  return {
    id: s.id,
    title: s.name,
    original: originalOf(s),
    english: englishOf(s, s.translations),
    year: s.first_air_date ? Number(s.first_air_date.slice(0, 4)) : null,
    endedYear: s.last_air_date ? Number(s.last_air_date.slice(0, 4)) : null,
    status: s.status || null,
    inProduction: !!s.in_production,
    genre: genres[0],
    genres,
    poster: posterUrl(s.poster_path),
    backdrop: backdropUrl(s.backdrop_path),
    overview: s.overview || null,
    crowd: crowdOf(s),
    creators: (s.created_by || []).slice(0, MAX_NAMES).map(c => c.name),
    runtime: (s.episode_run_time || [])[0] || null,
    seasons: (s.seasons || []).filter(isRegular).map(x => ({
      season: x.season_number,
      name: x.name,
      episodes: x.episode_count,
      year: x.air_date ? Number(x.air_date.slice(0, 4)) : null,
      poster: posterUrl(x.poster_path),
      overview: x.overview || null
    })),
    totalEpisodes: s.number_of_episodes || null,
    nextAir: s.next_episode_to_air
      ? {
          season: s.next_episode_to_air.season_number,
          episode: s.next_episode_to_air.episode_number,
          title: s.next_episode_to_air.name || null,
          airDate: s.next_episode_to_air.air_date || null,
        }
      : null,
    orders: (s.episode_groups?.results || []).map(g => ({
      id: g.id,
      name: g.name,
      episodes: g.episode_count,
      groups: g.group_count
    })),
    trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    watch: watchIn(s['watch/providers'])
  };
}

async function seasonDetails(showId, season) {
  const data = await tmdbGet(`/tv/${showId}/season/${season}`);
  return {
    season: data.season_number,
    name: data.name,
    overview: data.overview || null,
    poster: posterUrl(data.poster_path),
    episodes: (data.episodes || []).map(e => ({
      season: e.season_number,
      episode: e.episode_number,
      title: e.name,
      overview: e.overview || null,
      still: stillUrl(e.still_path),
      airDate: e.air_date || null,
      runtime: e.runtime || null,
      crowd: crowdOf(e),
      kind: e.episode_type || null
    }))
  };
}

async function episodeDetails(showId, season, episode) {
  const e = await tmdbGet(`/tv/${showId}/season/${season}/episode/${episode}`, {
    append_to_response: 'credits'
  });
  return {
    season: e.season_number,
    episode: e.episode_number,
    title: e.name,
    overview: e.overview || null,
    still: stillUrl(e.still_path),
    airDate: e.air_date || null,
    runtime: e.runtime || null,
    crowd: crowdOf(e),
    kind: e.episode_type || null,
    crew: signedBy(e.crew || e.credits?.crew, e.guest_stars || e.credits?.guest_stars)
  };
}

async function watchProvidersFor(id) {
  return watchIn(await tmdbGet(`/tv/${id}/watch/providers`));
}

async function recommendations(id, page = 1) {
  const data = await tmdbGet(`/tv/${id}/recommendations`, { page });
  return {
    page: data.page,
    totalPages: data.total_pages,
    results: (data.results || []).map(normalizeListItem)
  };
}

async function englishTitleFor(id) {
  const s = await tmdbGet(`/tv/${id}`, { append_to_response: 'translations' });
  return englishOf(s, s.translations);
}

async function videosFor(id) {
  for (const language of ['pt-BR', 'en-US']) {
    const data = await tmdbGet(`/tv/${id}/videos`, { language });
    const v = bestVideo(data.results);
    if (v) return v.key;
  }
  return null;
}

module.exports = {
  searchShows, popularShows, discoverShows,
  showDetails, seasonDetails, episodeDetails,
  watchProvidersFor, englishTitleFor, videosFor, recommendations,
  GENRE_TO_TV,
  genresFromTvIds, signedBy
};
