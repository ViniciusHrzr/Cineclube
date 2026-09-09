const { GENRE_PRIORITY } = require('./criteria');
const { bestVideo } = require('./video');

/* Irmão de tmdb.js e deliberadamente separado dele: o TMDB trata filme e série
   como dois mundos — outros caminhos, outra tabela de gêneros, outros nomes de
   campo para as mesmas coisas (`name` e não `title`). Um arquivo só, com um
   `if` em cada função, seria os dois mundos disputando as mesmas linhas. */

const API_BASE = 'https://api.themoviedb.org/3';
const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';
/* O quadro de um episódio é 16:9 e mora numa fileira, não numa grade de
   cartazes: w300 é a largura em que ele é desenhado, e w780 seriam seis vezes
   os bytes para o mesmo espaço. */
const STILL_BASE = 'https://image.tmdb.org/t/p/w300';
/* O quadro deitado da série, atrás do trailer no reel — ver o gêmeo em
   tmdb.js. */
const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w780';
const LOGO_BASE = 'https://image.tmdb.org/t/p/w92';
const REGION = 'BR';

const TOKEN = process.env.TMDB_TOKEN;

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

const posterUrl = path => (path ? POSTER_BASE + path : null);
const stillUrl = path => (path ? STILL_BASE + path : null);
const backdropUrl = path => (path ? BACKDROP_BASE + path : null);

/* O TMDB mantém duas taxonomias que não se sobrepõem: `878` é ficção científica
   em filme e não existe em série, que usa `10765` para ficção científica E
   fantasia juntas. Usar o mapa de filmes aqui mandaria toda série para Drama.

   O destino é a mesma taxonomia interna de nove: o clube não deveria aprender
   dois vocabulários para a mesma pergunta. */
const TV_GENRE_MAP = {
  10759: 'Ação', // Action & Adventure
  16: 'Animação',
  35: 'Comédia',
  80: 'Suspense', // Crime — o que a série de crime pede é dosagem e tensão
  99: 'Documentário',
  18: 'Drama',
  10762: 'Animação', // Kids
  9648: 'Suspense', // Mystery
  10763: 'Documentário', // News
  10764: 'Documentário', // Reality
  10765: 'Ficção científica', // Sci-Fi & Fantasy
  10766: 'Romance', // Soap
  10767: 'Documentário', // Talk
  10768: 'Drama', // War & Politics
  37: 'Ação' // Western
};

/* Não dá para reusar o GENRE_TO_TMDB de criteria.js: aquele carrega ids de
   FILME, e mandá-los para /discover/tv devolve lixo. Construído do mapa acima
   para os dois nunca discordarem. */
const GENRE_TO_TV = {};
for (const [id, genre] of Object.entries(TV_GENRE_MAP)) {
  (GENRE_TO_TV[genre] ||= []).push(id);
}
for (const genre of Object.keys(GENRE_TO_TV)) GENRE_TO_TV[genre] = GENRE_TO_TV[genre].join(',');

/* A ordem em que o TMDB devolve os ids é aproximadamente a de cadastro, e
   tratá-la como ranking faz Drama — que é também o balde do desconhecido —
   ganhar quase sempre. */
function genresFromTvIds(ids) {
  const carried = new Set();
  for (const id of ids || []) {
    const genre = TV_GENRE_MAP[id];
    if (genre) carried.add(genre);
  }
  const found = GENRE_PRIORITY.filter(genre => carried.has(genre));
  return found.length ? found : ['Drama'];
}

const crowdOf = s => (s.vote_count > 0 ? { score: s.vote_average, votes: s.vote_count } : null);

/* O nome com que a série circula lá fora. Null quando é o mesmo string: repetir
   "Severance" embaixo de "Severance" é uma segunda linha que diz a primeira. */
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

const RESELLER = /\s(?:Amazon|Apple TV|Roku|Player|Channel)s?\s*Channel$/i;
const WITH_ADS = /\s(?:with Ads|Ad[- ]Supported|Basic with Ads)$/i;
const MAX_PROVIDERS = 6;

/* A mesma poda de tmdb.js, explicada lá. Repetida e não importada porque é a
   única coisa que os dois arquivos compartilham, e um módulo terceiro para
   trinta linhas puras seria mais encanamento do que a duplicação custa. */
function tidyProviders(list) {
  const kept = [];
  const clean = (list || [])
    .filter(p => !RESELLER.test(p.provider_name))
    .map(p => ({ ...p, provider_name: p.provider_name.replace(WITH_ADS, '').trim() }))
    .sort((a, b) => a.display_priority - b.display_priority);
  for (const p of clean) {
    const variant = kept.some(k => p.provider_name.startsWith(k.provider_name + ' '));
    if (variant || kept.some(k => k.provider_name === p.provider_name)) continue;
    kept.push(p);
    if (kept.length === MAX_PROVIDERS) break;
  }
  return kept.map(p => ({
    id: p.provider_id,
    name: p.provider_name,
    logo: p.logo_path ? LOGO_BASE + p.logo_path : null
  }));
}

function watchIn(providers) {
  const here = providers?.results?.[REGION];
  if (!here) return null;
  const streaming = tidyProviders([...(here.flatrate || []), ...(here.free || []), ...(here.ads || [])]);
  if (!streaming.length) return null;
  return { link: here.link || null, streaming };
}

/* O TMDB numera especiais, piloto não exibido e bastidores como temporada 0.
   Filtrada da lista e ainda alcançável por endereço direto: quem for atrás de
   um especial acha, quem acompanha a série não tropeça nele. */
const isRegular = s => s.season_number > 0;

/* Um filme tem um diretor; uma série tem um por episódio, e é comum que o
   melhor da temporada seja de alguém que dirigiu aquele e mais nenhum.

   Só direção e roteiro: por episódio o TMDB carrega o que mudou naquele.
   Fotografia e montagem são a equipe da temporada, e atribuí-las ao episódio
   inventaria uma assinatura. */
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
  /* Os convidados do episódio, e não o elenco fixo: quem está em todos os
     episódios não diz nada sobre este. Um episódio sem convidado não recebe a
     chave, que é a resposta certa e não uma lacuna. */
  const players = (guests || []).slice(0, MAX_NAMES).map(c => c.name).filter(Boolean);
  if (players.length) out.atuacoes = players;
  return out;
}

async function showDetails(id) {
  const s = await tmdbGet(`/tv/${id}`, {
    append_to_response: 'credits,videos,watch/providers,translations,episode_groups'
  });
  const genres = genresFromTvIds((s.genres || []).map(g => g.id));
  const trailer = (s.videos?.results || [])
    .filter(v => v.site === 'YouTube' && v.type === 'Trailer')
    .sort((a, b) => (b.official === a.official ? 0 : b.official ? 1 : -1))[0];

  return {
    id: s.id,
    title: s.name,
    original: originalOf(s),
    english: englishOf(s, s.translations),
    year: s.first_air_date ? Number(s.first_air_date.slice(0, 4)) : null,
    endedYear: s.last_air_date ? Number(s.last_air_date.slice(0, 4)) : null,
    /* Se ainda vem episódio: é a primeira coisa que se pergunta antes de
       começar a acompanhar uma série. */
    status: s.status || null,
    inProduction: !!s.in_production,
    genre: genres[0],
    genres,
    poster: posterUrl(s.poster_path),
    backdrop: backdropUrl(s.backdrop_path),
    overview: s.overview || null,
    crowd: crowdOf(s),
    creators: (s.created_by || []).slice(0, MAX_NAMES).map(c => c.name),
    /* A duração típica, que o TMDB dá como uma lista porque uma série muda de
       formato: os 22 minutos da primeira temporada e os 45 da última. */
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
    /* ── as outras ordens em que esta série existe ──────────────────────
       Para algumas séries (anime exibido fora de ordem, relançamentos com
       temporadas recortadas) (temporada, número) não é a única leitura, e o
       clube precisa escolher uma vez qual está seguindo — ou duas pessoas
       avaliam "o quinto" e são episódios diferentes.

       Só o cabeçalho de cada grupo: buscar o conteúdo custaria uma requisição
       por grupo para uma escolha que quase nenhum clube vai fazer. */
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

/* Os episódios de uma temporada, em uma requisição. É o que a tela de
   acompanhar desenha, e o que o clube marca como visto. */
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
      /* `finale`, `mid_season` e `standard` vêm do TMDB. Serve para a tela
         marcar o fim de um arco sem o clube ter de saber de cor. */
      kind: e.episode_type || null
    }))
  };
}

/* Um episódio sozinho, com quem o assina. É o que a ficha criteriosa abre —
   e o motivo de ela existir por episódio: os nomes mudam a cada um. */
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

/** O gêmeo de `recommendations` em tmdb.js, do lado das séries. */
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

/** O trailer sozinho, sem o detalhe inteiro. As regras estão em `videosFor` de
    tmdb.js — duas línguas, e teaser só na falta de trailer. */
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
  // Exportados para os testes: são as três peças puras deste arquivo.
  genresFromTvIds, signedBy, watchIn
};
