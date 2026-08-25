const { genreFromTmdbIds, genresFromTmdbIds } = require('./criteria');

const API_BASE = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p/w342';
/* Provider logos are small square marks, not posters. w92 is the size TMDB
   serves them at; asking for w342 would be four times the bytes for the same
   24 pixels on screen. */
const LOGO_BASE = 'https://image.tmdb.org/t/p/w92';

/* ── where the club can watch this ────────────────────────────────────────
   TMDB answers "onde a gente assiste isso?" with data it licenses from
   JustWatch, per country, split by how you get it: `flatrate` is included in a
   subscription somebody already pays for, `rent` and `buy` are not. That split
   is the whole point — "está na Netflix" and "dá para alugar por aí" are
   different answers to the question.

   Only Brazil is read. The club is in one country and the payload carries a
   hundred and twelve of them; the rest is a list nobody here will ever scroll.

   Using this data obliges us to credit JustWatch as the source. The credit is
   drawn on the card in the client, next to the logos it explains. */
const REGION = 'BR';

/* ── one service, one logo ────────────────────────────────────────────────
   JustWatch is a catalogue of ways to pay, and the club is asking a much
   smaller question. Fight Club comes back listing Netflix and Netflix Standard;
   Inception lists HBO Max, HBO Max Amazon Channel and Universal+ Amazon
   Channel. Those are the same picture behind the same subscription, and
   printing every one of them turns a one-line answer into a wall of marks that
   has to be read to find out it says nothing new.

   Three things are collapsed, and each is a different kind of duplicate:
   storefronts that resell somebody else's service, the ad tier of a service,
   and the plan tiers — anything whose name is another name with more words
   stapled to the end. The first entry wins, and the ordering below is what
   decides which one that is. */
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
    /* A tier or a variant: "Netflix Standard" against "Netflix", "Paramount
       Plus Premium" against "Paramount Plus". Matched on a word boundary so
       that two genuinely different services never collide — "Amazon Video" is
       not a longer "Amazon Prime Video", and neither one swallows the other. */
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
  /* `free` and `ads` are streaming somebody does not pay extra for, which is
     the same answer as `flatrate` from where the club is standing.

     `rent` and `buy` are deliberately not read. Almost every film ever made is
     for sale on Apple TV, Amazon and Google Play, so the rental row was the
     same three logos under every poster — a constant, and a constant carries no
     information. It also answered a question nobody in this club asked: the
     point is finding something four people can watch tonight without anybody
     buying anything. */
  const streaming = tidyProviders([...(here.flatrate || []), ...(here.free || []), ...(here.ads || [])]);
  if (!streaming.length) return null;
  return {
    // TMDB asks that this be the link out, and it is also the honest one: it
    // lands on a page with the actual storefronts rather than guessing a deep
    // link into a service the visitor may not have.
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

/* ── a nota da multidão ───────────────────────────────────────────────────
   TMDB's own average, on the same 0–10 the club uses, so the two numbers can
   sit side by side without being converted into each other.

   The count travels with it because the average means nothing alone. An 9,0
   from eleven people and a 9,0 from four hundred thousand are different claims,
   and the club deserves to see which one it is disagreeing with.

   Zero votes reads as null rather than 0,0. TMDB gives an unrated film an
   average of zero, and printing that beside the club's number would say the
   world hated a film the world has not seen.

   Carried by the list endpoints as well as the detail one, which is what lets
   it reach the archive: a film is cached the first time anybody searches for
   it, long before anybody opens it. */
function crowdOf(m) {
  return m.vote_count > 0 ? { score: m.vote_average, votes: m.vote_count } : null;
}

/* ── o nome com que o filme circula ───────────────────────────────────────
   Everything on this page is asked for in pt-BR, which is right for reading and
   useless for searching: "Entre Facas e Segredos" finds nothing anywhere, and
   the club looking for a copy of it is looking for "Knives Out".

   Null when it is the same string, because a film whose Portuguese title was
   never changed has nothing to add — printing "Interstellar" under
   "Interstellar" is a second line that says the first line again.

   This is TMDB's `original_title`, so for a film shot in English it is the
   English name, and for one shot elsewhere it is that language's: Parasita
   comes back as 기생충, not as Parasite. That is the honest field and it is
   free on every endpoint — the English name of a Korean film would be a second
   request per film, which a page of twenty posters cannot pay. */
function originalOf(m) {
  return m.original_title && m.original_title !== m.title ? m.original_title : null;
}

/* `genre` is the one it opens on; `genres` is everything it could be rated as.
   Both travel, because a poster in a grid only needs the first and the rating
   screen needs all of them. */
function normalizeListItem(m) {
  return {
    id: m.id,
    title: m.title,
    original: originalOf(m),
    year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
    genre: genreFromTmdbIds(m.genre_ids),
    genres: genresFromTmdbIds(m.genre_ids),
    poster: posterUrl(m.poster_path),
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
   The credits already arrive. A film's `crew` is 736 people for Inception, 225
   for Oppenheimer, and until now exactly one of them survived being parsed —
   the director — while the rest was read and thrown away. Five of the eight
   base criteria have a name sitting in that discarded array.

   Putting it on the rating card turns an abstract slider into a judgement about
   somebody's work: you are not scoring "Fotografia", you are scoring what Hoyte
   van Hoytema did. It is also the club learning who these people are, which is
   most of what watching films together is for.

   Two things make this a list of jobs per criterion rather than one job name:

   · TMDB does not spell the writing credit one way. Oppenheimer and Inception
     say `Writer`; Fight Club says `Screenplay`. And both carry `Novel` or
     `Book` as well, which is the author of the source and emphatically not the
     person who wrote the film — so the list is an allowlist, never a
     department scan.
   · Some criteria genuinely are two crafts. `som` is trilha and desenho
     sonoro, and the composer and the sound designer are different people doing
     different work under one slider. Naming only one of them would be a
     quieter mistake than naming neither.

   Keyed by criterion so the client can look up whatever card it is drawing
   without knowing any of this. Keys the genre does not ask about are simply
   never read; `originalidade` is absent because nobody signs it, and that is
   the correct answer rather than a gap. */
const SIGNED_BY = {
  direcao: ['Director'],
  roteiro: ['Screenplay', 'Writer'],
  fotografia: ['Director of Photography'],
  montagem: ['Editor'],
  som: ['Original Music Composer', 'Sound Designer'],
  arte: ['Production Design']
};

/* Enough to say who is responsible, not enough to become a credit roll. Three
   is what fits on one line beside a criterion's name at the width the card is
   drawn at. */
const MAX_NAMES = 3;

function signedBy(crew, cast) {
  const out = {};
  for (const [key, jobs] of Object.entries(SIGNED_BY)) {
    const names = [];
    /* Walked in the order the jobs are declared, not the order TMDB listed the
       crew: for `som` that keeps the composer ahead of the sound designer, and
       for `roteiro` it prefers the explicit screenplay credit where a film
       carries both spellings. */
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

/* ── providers on their own ───────────────────────────────────────────────
   The detail endpoint carries this, but a catalogue page is twenty films and
   twenty full details is twenty payloads of credits, videos and overviews to
   read one field out of. TMDB serves the providers alone, and alone they are a
   couple of kilobytes.

   Used by the grid, which fills what the cache is missing. The projection sheet
   still reads it off the detail it was already fetching. */
async function watchProvidersFor(id) {
  return watchIn(await tmdbGet(`/movie/${id}/watch/providers`));
}

async function movieDetails(id) {
  const m = await tmdbGet(`/movie/${id}`, { append_to_response: 'credits,videos,watch/providers' });
  const director = (m.credits?.crew || []).find(c => c.job === 'Director');
  const cast = (m.credits?.cast || []).slice(0, 6).map(c => ({ name: c.name, character: c.character }));
  const trailer = (m.videos?.results || [])
    .filter(v => v.site === 'YouTube' && v.type === 'Trailer')
    .sort((a, b) => (b.official === a.official ? 0 : b.official ? 1 : -1))[0];
  return {
    id: m.id,
    title: m.title,
    original: originalOf(m),
    year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
    genre: genreFromTmdbIds((m.genres || []).map(g => g.id)),
    genres: genresFromTmdbIds((m.genres || []).map(g => g.id)),
    poster: posterUrl(m.poster_path),
    director: director ? director.name : null,
    // Minutes, and only from the details endpoint — the list endpoints TMDB
    // serves for search, popular and discover do not carry it at all.
    runtime: m.runtime || null,
    overview: m.overview || null,
    crowd: crowdOf(m),
    cast,
    // Who signs each criterion, keyed by criterion. Built from credits that
    // were already on the wire and already being parsed.
    crew: signedBy(m.credits?.crew || [], m.credits?.cast || []),
    trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    // Null when nothing streams, rents or sells it here — which for an old or
    // obscure film is the common case, and is itself the answer.
    watch: watchIn(m['watch/providers'])
  };
}

// `watchIn` is exported for its test and not for its callers: it is the one
// piece of real logic in this file, it is pure, and the rules it applies are
// exactly the kind that rot silently as JustWatch renames things.
module.exports = {
  searchMovies, popularMovies, discoverMovies, movieDetails, watchProvidersFor,
  watchIn, signedBy
};
