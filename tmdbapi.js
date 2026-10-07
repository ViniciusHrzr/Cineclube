const API_BASE = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p/w342';
const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w780';
const LOGO_BASE = 'https://image.tmdb.org/t/p/w92';

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

const crowdOf = m => (m.vote_count > 0 ? { score: m.vote_average, votes: m.vote_count } : null);

const RESELLER = /\s(?:Amazon|Apple TV|Roku|Player|Channel)s?\s*Channel$/i;
const WITH_ADS = /\s(?:with Ads|Ad[- ]Supported|Basic with Ads)$/i;
const MAX_PROVIDERS = 6;

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
  return {
    link: here.link || null,
    streaming
  };
}

module.exports = { tmdbGet, posterUrl, backdropUrl, crowdOf, watchIn };
