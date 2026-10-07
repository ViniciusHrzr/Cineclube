/* ══════════════════════════════════════════════════════════════════════════
   O QUE FILME E SÉRIE FAZEM IGUAL.

   tmdb.js e series.js são deliberadamente separados — outros caminhos, outra
   tabela de gêneros, outros nomes de campo para as mesmas coisas. O que não é
   diferente é a chamada em si, o tamanho de cada imagem e a leitura de
   provedores: escritas duas vezes, elas divergem na primeira vez que alguém
   mexe em uma delas. Mesmo motivo de video.js.
   ══════════════════════════════════════════════════════════════════════════ */

const API_BASE = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p/w342';
/* O quadro deitado da obra, atrás do trailer no reel. Largo porque ele cobre a
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

const posterUrl = path => (path ? IMG_BASE + path : null);
const backdropUrl = path => (path ? BACKDROP_BASE + path : null);

/* TMDB's own average, on the same 0–10 the club uses, so the two numbers sit
   side by side without conversion.

   The count travels with it because the average means nothing alone: a 9,0 from
   eleven people and a 9,0 from four hundred thousand are different claims.

   Zero votes reads as null, never 0,0 — TMDB gives an unrated film an average
   of zero, and printing that would say the world hated a film it has not seen. */
const crowdOf = m => (m.vote_count > 0 ? { score: m.vote_average, votes: m.vote_count } : null);

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

module.exports = { tmdbGet, posterUrl, backdropUrl, crowdOf, watchIn };
