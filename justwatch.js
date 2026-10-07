const ENDPOINT = 'https://apis.justwatch.com/graphql';
const COUNTRY = 'BR';
const LANGUAGE = 'pt';

const TIMEOUT_MS = 5000;

const CANDIDATES = 12;

const QUERY = `
query CineclubeOffers($country: Country!, $language: Language!, $filter: TitleFilter!, $first: Int!) {
  popularTitles(country: $country, filter: $filter, first: $first) {
    edges {
      node {
        objectType
        content(country: $country, language: $language) {
          externalIds { tmdbId }
        }
        offers(country: $country, platform: WEB) {
          monetizationType
          standardWebURL
          package { clearName }
        }
      }
    }
  }
}`;

const INCLUDED = new Set(['FLATRATE', 'FREE', 'ADS']);

async function search(searchQuery) {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        operationName: 'CineclubeOffers',
        variables: {
          country: COUNTRY,
          language: LANGUAGE,
          first: CANDIDATES,
          filter: { searchQuery },
        },
        query: QUERY,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.data?.popularTitles?.edges ?? [];
  } catch {
    return [];
  }
}

async function deepLinks({ tmdbId, title, original, kind }) {
  const id = Number(tmdbId);
  if (!Number.isInteger(id) || !title) return new Map();

  const wanted = kind === 'show' ? 'SHOW' : 'MOVIE';
  const acha = edges =>
    edges.find(
      e => e?.node?.objectType === wanted && Number(e?.node?.content?.externalIds?.tmdbId) === id
    );

  let found = acha(await search(title));

  if (!found && original && original !== title) found = acha(await search(original));
  if (!found) return new Map();

  const out = new Map();
  for (const offer of found.node.offers ?? []) {
    const name = offer?.package?.clearName;
    const url = offer?.standardWebURL;
    if (!name || !url || !INCLUDED.has(offer.monetizationType)) continue;
    if (!out.has(name)) out.set(name, url);
  }
  return out;
}

function urlFor(links, providerName) {
  const exact = links.get(providerName);
  if (exact) return exact;
  for (const [name, url] of links) {
    if (name.startsWith(providerName + ' ')) return url;
  }
  return null;
}

module.exports = { deepLinks, urlFor };
