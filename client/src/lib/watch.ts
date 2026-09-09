/* ══════════════════════════════════════════════════════════════════════════
   A PORTA DE CADA STREAMING.

   O TMDB diz ONDE um título passa e não COMO chegar nele: a resposta traz um
   link só, para a página do próprio TMDB, e nenhum por provedor. Nem ele nem o
   JustWatch entregam o endereço do filme dentro da Netflix — esse id não está
   em lugar nenhum do que se recebe.

   Então o endereço é montado aqui, e é a busca DAQUELE serviço com o título
   dentro. Um clique e a pessoa está no streaming, com o filme na frente dela.
   Não é a página do título; é o mais perto dela que se chega sem inventar um id
   que ninguém deu.

   Uma tabela curta e conservadora, de propósito: um serviço fora dela cai na
   página do TMDB, que sempre funciona e traz o botão daquele serviço. Um
   endereço chutado que responde 404 é pior do que um caminho a mais — a pessoa
   clicou justamente porque estava com pressa de assistir.

   Por isso cada linha daqui foi PEDIDA antes de entrar: as que estão aqui
   respondem e caem na busca. Disney+ e Max ficaram de fora por isso — a home
   deles responde 200 e toda rota de busca que se tentou responde 404, então o
   endereço certo não é nenhum dos óbvios e inventá-lo seria mandar o clube para
   uma página de erro. Os dois caem no TMDB até alguém trazer o endereço bom.

   Casado pelo NOME e não pelo id do TMDB porque é o nome que este produto já
   limpa e desambigua (ver `tidyProviders` em tmdb.js): "HBO Max Amazon Channel"
   e "Netflix Standard with Ads" já chegaram aqui como "HBO Max" e "Netflix".
   ══════════════════════════════════════════════════════════════════════════ */

type Door = { match: RegExp; url: (query: string) => string };

const DOORS: Door[] = [
  { match: /^netflix/i, url: q => `https://www.netflix.com/search?q=${q}` },
  {
    /* "Amazon Prime Video" e "Prime Video" são o mesmo lugar; "Amazon Video" é
       a loja de aluguel, que este produto não carrega — ver `watchIn`. */
    match: /prime video/i,
    url: q => `https://www.primevideo.com/search?phrase=${q}`,
  },
  { match: /^globoplay/i, url: q => `https://globoplay.globo.com/busca/?q=${q}` },
  { match: /^apple tv/i, url: q => `https://tv.apple.com/br/search?term=${q}` },
  { match: /^paramount/i, url: q => `https://www.paramountplus.com/br/search/?q=${q}` },
  /* O único que não deu para conferir de fora: o site inteiro recusa quem não é
     navegador, home junto. O formato é o de sempre e não é um palpite sobre uma
     rota que talvez não exista. */
  { match: /^crunchyroll/i, url: q => `https://www.crunchyroll.com/search?q=${q}` },
];

/* O endereço para onde uma marca leva. `fallback` é o link do TMDB, que é a
   resposta certa para todo serviço que a tabela não conhece — e a razão de esta
   função nunca devolver nulo quando ele existe. */
export function watchDoor(provider: string, title: string, fallback: string | null) {
  const door = DOORS.find(d => d.match.test(provider));
  if (!door) return fallback;
  return door.url(encodeURIComponent(title));
}

/** Se o clique cai dentro do serviço ou na página do TMDB. Muda o que se diz. */
export function goesToService(provider: string) {
  return DOORS.some(d => d.match.test(provider));
}
