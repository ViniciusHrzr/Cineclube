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
     the same answer as `flatrate` from where the club is standing. */
  const streaming = tidyProviders([...(here.flatrate || []), ...(here.free || []), ...(here.ads || [])]);
  const paid = tidyProviders([...(here.rent || []), ...(here.buy || [])]);
  if (!streaming.length && !paid.length) return null;
  return {
    // TMDB asks that this be the link out, and it is also the honest one: it
    // lands on a page with the actual storefronts rather than guessing a deep
    // link into a service the visitor may not have.
    link: here.link || null,
    streaming,
    paid
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
  const m = await tmdbGet(`/movie/${id}`, { append_to_response: 'credits,videos,watch/providers' });
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
    // Minutes, and only from the details endpoint — the list endpoints TMDB
    // serves for search, popular and discover do not carry it at all.
    runtime: m.runtime || null,
    overview: m.overview || null,
    cast,
    trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    // Null when nothing streams, rents or sells it here — which for an old or
    // obscure film is the common case, and is itself the answer.
    watch: watchIn(m['watch/providers'])
  };
}

// `watchIn` is exported for its test and not for its callers: it is the one
// piece of real logic in this file, it is pure, and the rules it applies are
// exactly the kind that rot silently as JustWatch renames things.
module.exports = { searchMovies, popularMovies, discoverMovies, movieDetails, watchIn };
