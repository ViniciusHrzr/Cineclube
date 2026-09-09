/* ══════════════════════════════════════════════════════════════════════════
   O LINK QUE ABRE O TÍTULO DENTRO DO SERVIÇO.

   O TMDB responde ONDE um filme passa e não COMO chegar nele: `/watch/providers`
   traz logo, nome e um link só — o da página do próprio TMDB. O endereço do
   filme dentro da Netflix não está ali.

   Ele existe, e é do JustWatch. A página do TMDB o mostra porque ELES são
   parceiros: cada botão de lá é um `click.justwatch.com/...&r=<link fundo>`, e
   o crachá vai dentro do próprio payload — `partnerId: 6`,
   `clickoutType: jw-content-partner-export-api`. A rota documentada que serve
   isso é a de parceiro (`/contentpartner/v2/...`) e responde 401 sem token.

   O que responde sem token é o GraphQL que o site deles usa, e é o que este
   módulo pergunta. Duas consequências que o resto do código precisa aguentar:
   é uma porta não documentada, então pode mudar de forma ou fechar sem aviso;
   e por isso NADA aqui pode ser obrigatório. Toda falha devolve um mapa vazio,
   e quem chama continua com os provedores do TMDB — o clube perde o atalho, não
   a informação. Ver providers.js.

   O crédito ao JustWatch já é obrigação de quem usa estes dados e já está
   desenhado na tela desde antes disto (ver `Credit` em components/film.tsx).
   ══════════════════════════════════════════════════════════════════════════ */

const ENDPOINT = 'https://apis.justwatch.com/graphql';
const COUNTRY = 'BR';
const LANGUAGE = 'pt';

/* Um catálogo não pode esperar por isto. Cinco segundos é generoso para uma
   consulta que costuma responder em menos de um, e é o teto que impede uma
   noite de JustWatch lento de virar uma noite de Cineclube lento. */
const TIMEOUT_MS = 5000;

/* Quantos resultados a busca traz antes de se procurar o id certo no meio. O
   casamento é por id do TMDB e não por posição, então isto não é precisão: é
   quantas chances o título certo tem de estar na lista. Eram três, e três é
   pouco para um nome que muitas obras dividem — "Duna" traz o de 2021, o de
   1984, a minissérie e dois documentários antes do que se procurava. */
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

/* As mesmas três formas de "já está pago" que `watchIn` carrega: incluído numa
   assinatura, de graça, ou de graça com anúncio. Aluguel e compra ficam de
   fora aqui pelo mesmo motivo de lá — a tela não os mostra. */
const INCLUDED = new Set(['FLATRATE', 'FREE', 'ADS']);

/* ══════════════════════════════════════════════════════════════════════════
   Os links fundos de um título, por nome de serviço.

   `tmdbId` é o que decide qual resultado é o certo: a busca é por nome e um
   nome acha sequências, remakes e documentários sobre o filme. O id é a única
   coisa que não erra, e sem ele casando o título é abandonado — um link para a
   obra errada é pior do que link nenhum.
   ══════════════════════════════════════════════════════════════════════════ */
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
    /* Sem rede, fora do ar, ou demorou: ver o cabeçalho. Lista vazia é uma
       resposta e não um erro. */
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

  /* Segunda tentativa pelo nome original, e só quando a primeira não achou. O
     título em português é o que o clube lê e nem sempre é o que o JustWatch
     indexou — um filme coreano entra lá pelo nome internacional, e uma série
     antiga costuma estar sob o nome com que estreou. Uma requisição a mais só
     acontece no caso em que a alternativa era não ter link. */
  if (!found && original && original !== title) found = acha(await search(original));
  if (!found) return new Map();

  /* O primeiro de cada serviço vence. Um mesmo pacote aparece várias vezes na
     resposta, uma por qualidade — 4K, HD e SD são o mesmo link. */
  const out = new Map();
  for (const offer of found.node.offers ?? []) {
    const name = offer?.package?.clearName;
    const url = offer?.standardWebURL;
    if (!name || !url || !INCLUDED.has(offer.monetizationType)) continue;
    if (!out.has(name)) out.set(name, url);
  }
  return out;
}

/* O nome que este produto mostra já passou por `tidyProviders`: "Netflix
   Standard with Ads" virou "Netflix" e os revendedores sumiram. Do lado do
   JustWatch os nomes vêm crus, então o casamento tenta o exato primeiro e cai
   no prefixo depois — é o que liga "HBO Max" a "HBO Max Amazon Channel" quando
   só o segundo tem oferta.

   Nunca o contrário: um prefixo do lado de lá casaria "Amazon Prime Video" com
   "Amazon Video", que é a loja de aluguel e outro produto. */
function urlFor(links, providerName) {
  const exact = links.get(providerName);
  if (exact) return exact;
  for (const [name, url] of links) {
    if (name.startsWith(providerName + ' ')) return url;
  }
  return null;
}

module.exports = { deepLinks, urlFor };
