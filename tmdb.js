const { genreFromTmdbIds, genresFromTmdbIds } = require('./criteria');
const { bestVideo } = require('./video');
const { tmdbGet, posterUrl, backdropUrl, crowdOf, watchIn } = require('./tmdbapi');

/* Everything here is asked for in pt-BR, which is right for reading and useless
   for searching: the club looking for "Entre Facas e Segredos" is looking for
   "Knives Out".

   Null when it is the same string — "Interstellar" under "Interstellar" is a
   second line saying the first line again.

   This is TMDB's `original_title`, so Parasita comes back as 기생충, not as
   Parasite. It is the honest field and it is free on every endpoint. */
function originalOf(m) {
  return m.original_title && m.original_title !== m.title ? m.original_title : null;
}

/* Earns a column for exactly one case — the film that is neither
   English-language nor Brazilian. Parasita is `Parasita` here, `기생충`
   originally, and `Parasite` everywhere the club would go looking for a copy.

   Null when it repeats a name we already hold.

   Not on the list endpoints — TMDB only carries translations per film — which
   is why this is filled where a film becomes something the club keeps. */
function englishOf(m, translations) {
  const en = (translations?.translations || []).find(t => t.iso_639_1 === 'en');
  const title = en?.data?.title;
  if (!title || title === m.title || title === m.original_title) return null;
  return title;
}

/** The English name alone, for a film already cached without one. */
async function englishTitleFor(id) {
  const m = await tmdbGet(`/movie/${id}`, { append_to_response: 'translations' });
  return englishOf(m, m.translations);
}

/* `genre` is the one it opens on; `genres` is everything it could be rated as.
   A poster in a grid only needs the first; the rating screen needs all. */
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
    // Viaja em toda rota de lista e nunca era lida: é a linha que decide se
    // alguém para no reel.
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

/* ── quem assina cada critério ────────────────────────────────────────────
   Five of the eight base criteria have a name sitting in the `crew` array that
   was already being fetched and thrown away. On the rating card it turns an
   abstract slider into a judgement about somebody's work.

   A list of jobs per criterion, not one job name, for two reasons:

   · TMDB does not spell the writing credit one way — Inception says `Writer`,
     Fight Club says `Screenplay` — and both also carry `Novel`/`Book`, which is
     the author of the source and emphatically not the person who wrote the
     film. So it is an allowlist, never a department scan.
   · Some criteria are two crafts: `som` is trilha and desenho sonoro, done by
     different people under one slider.

   `originalidade` is absent because nobody signs it — the correct answer rather
   than a gap. */
const SIGNED_BY = {
  direcao: ['Director'],
  roteiro: ['Screenplay', 'Writer'],
  fotografia: ['Director of Photography'],
  montagem: ['Editor'],
  som: ['Original Music Composer', 'Sound Designer'],
  arte: ['Production Design']
};

/* Three is what fits on one line beside a criterion's name at the width the
   card is drawn at. Past that it is a credit roll. */
const MAX_NAMES = 3;

function signedBy(crew, cast) {
  const out = {};
  for (const [key, jobs] of Object.entries(SIGNED_BY)) {
    const names = [];
    /* In the order the jobs are declared, not the order TMDB listed the crew:
       for `som` that keeps the composer ahead of the sound designer, and for
       `roteiro` it prefers the explicit screenplay credit. */
    for (const job of jobs) {
      for (const person of crew) {
        if (person.job === job && person.name && !names.includes(person.name)) names.push(person.name);
      }
    }
    if (names.length) out[key] = names.slice(0, MAX_NAMES);
  }
  /* The cast answers two different criteria depending on the genre, and it is
     the same people either way — an animated film's cast IS its voice cast. */
  const players = cast.slice(0, MAX_NAMES).map(c => c.name);
  if (players.length) {
    out.atuacoes = players;
    out.vozes = players;
  }
  return out;
}

/* The detail endpoint carries this, but a catalogue page is twenty films, and
   twenty full details is twenty payloads of credits, videos and overviews read
   for one field. Alone, providers are a couple of kilobytes. */
async function watchProvidersFor(id) {
  return watchIn(await tmdbGet(`/movie/${id}/watch/providers`));
}

/* ── o trailer, sozinho ───────────────────────────────────────────────────
   O detalhe já carrega vídeos, e mesmo assim isto existe: um reel são vinte
   obras por página, e vinte detalhes são vinte payloads de elenco, sinopse e
   tradução lidos por um campo.

   Duas línguas e nesta ordem. O TMDB filtra vídeo por idioma, e em pt-BR a
   resposta de um filme antigo costuma ser vazia — o trailer legendado nunca foi
   subido. Cair no inglês é ter trailer em vez de não ter; o contrário seria
   servir o dublado a quem tem o original disponível.

   Qual dos vídeos é O trailer está em video.js: a resposta é a mesma para série
   e para filme. */
async function videosFor(id) {
  for (const language of ['pt-BR', 'en-US']) {
    const data = await tmdbGet(`/movie/${id}/videos`, { language });
    const v = bestVideo(data.results);
    if (v) return v.key;
  }
  return null;
}

/* O que o TMDB acha parecido com um filme. É a base da sugestão do reel: o
   clube dá as obras que gostou e a rede devolve vizinhas delas. `similar` é a
   outra porta e é pior — ela casa por gênero e palavra-chave, e devolve o
   catálogo inteiro de terror para quem gostou de UM terror. */
async function recommendations(id, page = 1) {
  const data = await tmdbGet(`/movie/${id}/recommendations`, { page });
  return {
    page: data.page,
    totalPages: data.total_pages,
    results: (data.results || []).map(normalizeListItem)
  };
}

async function movieDetails(id) {
  // `translations` rides along on a request already being made — the whole
  // reason the English name is free here and costs a request everywhere else.
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
    // Minutes, and only from the details endpoint — search, popular and
    // discover do not carry it at all.
    runtime: m.runtime || null,
    overview: m.overview || null,
    crowd: crowdOf(m),
    cast,
    // Built from credits already on the wire and already being parsed.
    crew: signedBy(m.credits?.crew || [], m.credits?.cast || []),
    trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    // Null when nothing streams, rents or sells it here — for an old or obscure
    // film that is the common case, and is itself the answer.
    watch: watchIn(m['watch/providers'])
  };
}

module.exports = {
  searchMovies, popularMovies, discoverMovies, movieDetails, watchProvidersFor,
  englishTitleFor, signedBy, englishOf, videosFor, recommendations
};
