const { genreFromTmdbIds, genresFromTmdbIds } = require('./criteria');
const { bestVideo } = require('./video');

const API_BASE = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p/w342';
/* O quadro deitado do filme, atrás do trailer no reel. Largo porque ele cobre a
   tela inteira desfocado; o pôster 2:3 no lugar dele deixa tarja dos dois
   lados de um vídeo 16:9. */
const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w780';
/* Provider logos are small square marks, not posters: w342 would be four times
   the bytes for the same 24 pixels on screen. */
const LOGO_BASE = 'https://image.tmdb.org/t/p/w92';

/* TMDB answers "onde a gente assiste isso?" with JustWatch data, per country,
   split by how you get it: `flatrate` is included in a subscription somebody
   already pays for, `rent` and `buy` are not. That split is the point.

   Only Brazil is read; the payload carries a hundred and twelve countries.

   Using this data obliges us to credit JustWatch as the source — the credit is
   drawn on the card in the client. */
const REGION = 'BR';

/* JustWatch is a catalogue of ways to pay, and the club is asking a smaller
   question: Inception lists HBO Max, HBO Max Amazon Channel and Universal+
   Amazon Channel — the same picture behind the same subscription.

   Three kinds of duplicate are collapsed: storefronts reselling somebody else's
   service, the ad tier of a service, and plan tiers (a name that is another
   name with more words stapled on). The first entry wins, and the ordering
   below decides which one that is. */
const RESELLER = /\s(?:Amazon|Apple TV|Roku|Player|Channel)s?\s*Channel$/i;
const WITH_ADS = /\s(?:with Ads|Ad[- ]Supported|Basic with Ads)$/i;
/** As many as answer the question. Past this it is a directory, not an answer. */
const MAX_PROVIDERS = 6;

function tidyProviders(list) {
  const kept = [];
  const clean = (list || [])
    .filter(p => !RESELLER.test(p.provider_name))
    .map(p => ({ ...p, provider_name: p.provider_name.replace(WITH_ADS, '').trim() }))
    /* JustWatch's own ordering. It puts the service most people would actually
       use first, which is a judgement we have no better version of — and it is
       also what makes "the first one wins" the right tiebreak below. */
    .sort((a, b) => a.display_priority - b.display_priority);

  for (const p of clean) {
    /* A tier or a variant: "Netflix Standard" against "Netflix". Matched on a
       word boundary so two genuinely different services never collide —
       "Amazon Video" is not a longer "Amazon Prime Video". */
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
  /* `free` and `ads` are the same answer as `flatrate` from where the club is
     standing.

     `rent` and `buy` are deliberately not read: almost every film is for sale
     on Apple TV, Amazon and Google Play, so that row was the same three logos
     under every poster — a constant carries no information. */
  const streaming = tidyProviders([...(here.flatrate || []), ...(here.free || []), ...(here.ads || [])]);
  if (!streaming.length) return null;
  return {
    // TMDB asks that this be the link out, and it is the honest one: a page
    // with the actual storefronts rather than a deep link into a service the
    // visitor may not have.
    link: here.link || null,
    streaming
  };
}

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

function backdropUrl(path) {
  return path ? BACKDROP_BASE + path : null;
}

/* TMDB's own average, on the same 0–10 the club uses, so the two numbers sit
   side by side without conversion.

   The count travels with it because the average means nothing alone: a 9,0 from
   eleven people and a 9,0 from four hundred thousand are different claims.

   Zero votes reads as null, never 0,0 — TMDB gives an unrated film an average
   of zero, and printing that would say the world hated a film it has not seen. */
function crowdOf(m) {
  return m.vote_count > 0 ? { score: m.vote_average, votes: m.vote_count } : null;
}

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

async function movieDetails(id) {
  // `translations` rides along on a request already being made — the whole
  // reason the English name is free here and costs a request everywhere else.
  // request everywhere else.
  const m = await tmdbGet(`/movie/${id}`, {
    append_to_response: 'credits,videos,watch/providers,translations'
  });
  const director = (m.credits?.crew || []).find(c => c.job === 'Director');
  const cast = (m.credits?.cast || []).slice(0, 6).map(c => ({ name: c.name, character: c.character }));
  const trailer = (m.videos?.results || [])
    .filter(v => v.site === 'YouTube' && v.type === 'Trailer')
    .sort((a, b) => (b.official === a.official ? 0 : b.official ? 1 : -1))[0];
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

// `watchIn` is exported for its test, not for callers: it is the one piece of
// real logic here, it is pure, and its rules rot silently as JustWatch renames
// things.
module.exports = {
  searchMovies, popularMovies, discoverMovies, movieDetails, watchProvidersFor,
  englishTitleFor, watchIn, signedBy, englishOf, videosFor
};
