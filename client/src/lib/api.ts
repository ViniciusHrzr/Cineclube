/* The Express API is unchanged: this file is the only place that knows its
   shapes, so the screens stay about the interface. Every field here mirrors a
   DTO the server already returns. */

export type Reviewer = {
  id: string;
  name: string;
  dot: string;
  /* O apelido de menção, `@beren`. Calculado pelo servidor sobre os membros do
     clube, porque a unicidade é fato sobre a sala e não sobre a rede: dois
     Brunos em clubes diferentes nunca se cruzam. Ver handles.js.
     Null só em resposta antiga de um servidor que ainda não mandava. */
  handle?: string | null;
  /** Administrador da instalação — diferente de ser ADM desta sala (`role`). */
  isAdmin?: boolean;
  /** O papel dentro do clube que foi pedido. */
  role?: 'admin' | 'member' | null;
  /** A conta já cadastrou senha, ou só entra pelo Google. */
  hasPassword?: boolean;
  /** Desde quando está neste clube. */
  joinedAt?: string | null;
  /* A única coisa que uma pessoa afirma sobre si mesma neste produto. Todo o
     resto que o perfil mostra é derivado do que ela avaliou — ver lib/taste.ts.
     Null é o estado normal, não a falta de algo. */
  bio?: string | null;
  /** Quando entrou no clube. O perfil lê o mês e o ano; o dia não interessa. */
  createdAt?: string | null;
  /** URL of the portrait, versioned so it can be cached forever. Null: none. */
  avatar?: string | null;
  review_count?: number;
};

export type SessionUser = {
  id: string;
  name: string;
  dot: string;
  isAdmin: boolean;
  email?: string | null;
  /* O endereço já foi provado. Uma conta do Google nasce assim; uma criada por
     senha prova uma vez, pelo link que chega na caixa de entrada. É o que
     destrava fundar um clube e recuperar a senha — ver routes/auth.js. */
  emailVerified?: boolean;
  avatar?: string | null;
  bio?: string | null;
};

/* ── um clube ─────────────────────────────────────────────────────────────
   O `slug` é o que anda na URL e o que a pessoa cola no Discord; o `id` é o que
   o cliente já tem na mão logo depois de criar um, antes de qualquer recarga.
   As duas rotas aceitam os dois. */
export type Club = {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  visibility: 'public' | 'private';
  /* A política de leitura de um clube FECHADO: o que um estranho enxerga. Num
     clube aberto ficam dormentes — lá tudo é legível de qualquer jeito — mas
     continuam gravadas, para fechar a sala devolver o que o ADM tinha escolhido. */
  showReviews?: boolean;
  showComments?: boolean;
  /* O terceiro interruptor, e ele responde outra pergunta: os dois de cima
     decidem se um estranho LÊ esta sala, este decide se o que ela avaliou entra
     nas contas da rede no saguão — parede, pódio, atividade, cartaz. */
  showCharts?: boolean;
  photo: string | null;
  createdAt?: string | null;
  /** Só quando você é de lá: 'admin' ou 'member'. */
  role?: 'admin' | 'member' | null;
  isMember?: boolean;
  /* Você fundou este clube. É a única pessoa que pode encerrá-lo, e a única que
     não pode deixar de administrá-lo. */
  isCreator?: boolean;
  members?: number;
  /** Você já pediu para entrar e está esperando resposta. */
  requested?: boolean;
  /** Quantas pessoas estão esperando na porta. Só chega para quem pode abrir. */
  pending?: number;
};

export type ClubMember = {
  id: string;
  name: string;
  dot: string;
  role: 'admin' | 'member';
  avatar: string | null;
  joinedAt?: string;
};

export type JoinRequest = {
  id: string;
  name: string;
  dot: string;
  avatar: string | null;
  createdAt: string;
};

export const auth = {
  me: () =>
    api<{
      reviewer: SessionUser | null;
      /* A conta entrou pelo Google e ainda não cadastrou senha. É estado da
         conta e não passo de assistente: quem pular hoje volta a ver o convite,
         porque o motivo de ela existir — não depender de uma porta só — não
         expira. */
      needsPassword?: boolean;
      /** Se esta instalação tem a porta do Google configurada. */
      google?: boolean;
      /* Se esta instalação sabe mandar e-mail. Sem isso a tela não oferece
         "reenviar confirmação" nem "esqueci minha senha" — um botão que não tem
         como funcionar é pior que a ausência dele. */
      mail?: boolean;
    }>('/api/auth/me'),
  /** Não é fetch: é uma navegação de verdade, porque quem responde é o Google. */
  googleUrl: '/api/auth/google',
  login: (email: string, password: string) =>
    post<{ reviewer: SessionUser }>('/api/auth/login', { email, password }),
  /* Criar conta sem passar pelo Google. Entra logado: pedir para a pessoa
     digitar a senha que ela acabou de escolher é o formulário duvidando dela. */
  register: (name: string, email: string, password: string) =>
    post<{ reviewer: SessionUser }>('/api/auth/register', { name, email, password }),
  logout: () => post<null>('/api/auth/logout', {}),
  setPassword: (password: string, current?: string) =>
    post<{ ok: true }>('/api/auth/password', { password, current: current ?? null }),
  /* As contas de antes do Google que ninguém reivindicou. A lista se esvazia
     sozinha conforme as pessoas voltam, e no dia em que estiver vazia esta tela
     deixa de aparecer para sempre. */
  claimable: () =>
    api<{ accounts: { id: string; name: string; dot: string; avatar: string | null }[] }>(
      '/api/auth/claimable'
    ),
  claim: (reviewerId: string, pin: string) =>
    post<{ reviewer: SessionUser }>('/api/auth/claim', { reviewerId, pin }),
  /* "Não é nenhuma dessas." Gravado no servidor, e não aqui: a resposta tem de
     valer no celular da pessoa também. */
  dismissClaim: () => post<{ ok: true }>('/api/auth/claim/dismiss', {}),

  /* ── os links que chegam por e-mail ─────────────────────────────────────
     Confirmar um endereço e voltar para dentro sem a senha são a mesma coisa
     com dois fins: um segredo de vida curta que só chega a quem lê aquela caixa
     de entrada.

     O link do e-mail aponta para a TELA (`#confirmar/<token>`), e é ela que
     chama isto. Nunca para uma rota direta — servidores de e-mail e antivírus
     abrem os links das mensagens antes de a pessoa ver, e um token que se gasta
     ao ser aberto é um token que o scanner queima no caminho. */
  sendVerification: () => post<{ ok: true; sent?: boolean; already?: boolean }>('/api/auth/verify/send', {}),
  verifyEmail: (token: string) => post<{ ok: true; name: string }>('/api/auth/verify', { token }),
  /* Responde igual exista a conta ou não: uma resposta diferente transformaria
     isto numa lista de quem tem conta aqui. */
  requestReset: (email: string) => post<{ ok: true }>('/api/auth/reset/request', { email }),
  resetPassword: (token: string, password: string) =>
    post<{ reviewer: SessionUser }>('/api/auth/reset', { token, password }),
};

/* ── as salas ─────────────────────────────────────────────────────────────
   Fora do escopo de clube, porque é a lista deles: exigir estar dentro de um
   para descobrir quais existem seria uma porta trancada por dentro. */
export const clubs = {
  all: () => api<{ mine: Club[]; open: Club[] }>('/api/clubs'),
  create: (body: { name: string; tagline?: string; visibility: 'public' | 'private'; photo?: string | null }) =>
    post<{ club: Club }>('/api/clubs', body),
  get: (slug: string) => api<{ club: Club }>(`/api/c/${encodeURIComponent(slug)}`),
  update: (
    slug: string,
    patch: Partial<
      Pick<Club, 'name' | 'tagline' | 'visibility' | 'showReviews' | 'showComments' | 'showCharts'>
    > & {
      photo?: string | null;
    }
  ) =>
    api<{ club: Club }>(`/api/c/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  /* Encerrar. Leva junto as fichas de todo mundo, a conversa, os votos, a fila e
     a lista de quem estava dentro — tudo em cascata. Só quem fundou alcança. */
  remove: (slug: string) => del(`/api/c/${encodeURIComponent(slug)}`),
  members: (slug: string) => api<{ members: ClubMember[] }>(`/api/c/${encodeURIComponent(slug)}/members`),
  leave: (slug: string, reviewerId: string) =>
    del(`/api/c/${encodeURIComponent(slug)}/members/${reviewerId}`),
  setRole: (slug: string, reviewerId: string, role: 'admin' | 'member') =>
    api<{ ok: true }>(`/api/c/${encodeURIComponent(slug)}/members/${reviewerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    }),
  /* Uma ação, dois desfechos: num clube aberto você entra (`joined`), num
     fechado vira um pedido (`requested`). Quem diz qual foi é o servidor — a
     visibilidade pode ter mudado entre a lista e o clique. */
  join: (slug: string) =>
    post<{ joined?: true; requested?: true }>(`/api/c/${encodeURIComponent(slug)}/join`, {}),
  unjoin: (slug: string) => del(`/api/c/${encodeURIComponent(slug)}/join`),
  requests: (slug: string) => api<{ requests: JoinRequest[] }>(`/api/c/${encodeURIComponent(slug)}/requests`),
  answer: (slug: string, reviewerId: string, approve: boolean) =>
    post<{ ok: true; approved: boolean }>(
      `/api/c/${encodeURIComponent(slug)}/requests/${reviewerId}`,
      { approve }
    ),
};

/* ── o saguão ─────────────────────────────────────────────────────────────
   O que a rede está fazendo, acima da linha do clube. Tudo aqui é o que cada
   sala emprestou de propósito: um clube fechado que não ligou nada não aparece
   em campo nenhum destes. Ver lobby.js, que é onde a parede é desenhada.

   Uma chamada só para seis coisas, porque são seis agregações na porta de
   entrada — e uma porta que faz seis viagens é uma porta que pensa antes de
   abrir. */
export type LobbyMovie = {
  id: number;
  title: string;
  year: number | null;
  poster: string | null;
  average: number;
  takes: number;
};

export type LobbyPodiumMovie = LobbyMovie & { genre: string; clubs: number };

export type LobbyClub = {
  id: string;
  name: string;
  slug: string;
  visibility: 'public' | 'private';
  photo: string | null;
  tagline: string | null;
  /** Fichas gravadas na janela dos últimos `windowDays` dias. */
  recent: number;
  members: number;
};

/** Uma sala com sessão rolando neste segundo. Sai da memória, não do banco. */
export type LobbyLive = {
  club: {
    id: string;
    name: string;
    slug: string;
    visibility: 'public' | 'private';
    photo: string | null;
  };
  movie: { id: number; title: string; year: number | null; poster: string | null };
  watching: number;
  status: 'playing' | 'paused';
};

/** A ficha da semana: a única coisa do saguão com um texto assinado dentro. */
export type LobbyFeature = {
  id: string;
  club: { name: string; slug: string; visibility: 'public' | 'private' };
  actor: { id: string; name: string; dot: string; avatar: string | null };
  movieId: number;
  movieTitle: string;
  movieYear: number | null;
  moviePoster: string | null;
  genre: string;
  final: number;
  at: string;
  ends: { high: { name: string; value: number }; low: { name: string; value: number } } | null;
  excerpt: string | null;
  replies: number;
  agrees: number;
  disagrees: number;
};

export type LobbySnapshot = {
  counts: { reviews: number; movies: number; clubs: number };
  wall: LobbyMovie[];
  podium: LobbyPodiumMovie[];
  active: LobbyClub[];
  live: LobbyLive[];
  feature: LobbyFeature | null;
  /** Quantas fichas um filme precisa ter para entrar no pódio. A tela imprime. */
  floor: number;
  /** Sobre quantos dias a atividade das salas é medida. */
  windowDays: number;
};

export const lobby = {
  get: () => api<LobbySnapshot>('/api/lobby'),
};

/* Your own name, your own portrait and your own bio. The route takes no id — it
   edits whoever the session says you are, which is why there is no way to ask
   it to edit somebody else. */
export const profile = {
  update: (patch: { name?: string; avatar?: string | null; bio?: string | null }) =>
    api<{ reviewer: SessionUser }>('/api/reviewers/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
};

/* ── os três grupos de uma ficha ──────────────────────────────────────────
   `oficio` são os oito sobre como o filme é feito, `genero` são os dois que o
   filme escolhe, `pessoal` é o único que pergunta sobre você.

   Vem do servidor em vez de ser deduzido da chave ou do peso. O peso era o que
   agrupava antes — ×1 era ofício, ×2 era gênero — e no dia em que os pesos
   ficaram iguais esse atalho passou a não dizer nada. */
export type CriterionGroup = 'oficio' | 'genero' | 'pessoal';

export type Criterion = { key: string; name: string; hint: string; w: number; group: CriterionGroup };

export type BreakdownRow = {
  key: string;
  name: string;
  w: number;
  group?: CriterionGroup;
  value: number;
};

/* ── o primeiro indício de rede social ────────────────────────────────────
   O clube discute por voz e a discussão morre com a chamada. Estas duas coisas
   sobrevivem a ela, e as duas se penduram numa avaliação específica, porque a
   ficha de alguém é a coisa concreta que se discute. */

export type ReviewComment = {
  id: string;
  reviewId: string;
  reviewerId: string;
  reviewerName: string;
  reviewerDot: string;
  body: string;
  /* Null num comentário; o id do pai numa resposta. A profundidade é um — o
     servidor recusa pendurar uma resposta em outra resposta. */
  parentId?: string | null;
  /** ISO, com hora: uma conversa é lida na ordem em que aconteceu. */
  createdAt: string;
};

/* Um voto de uma pessoa na ficha de outra. +1 ou −1; não votar é não existir.

   Era por critério, com uma `key` aqui dentro. Onze polegares por ficha por
   pessoa não é uma opinião, é um formulário — ver a nota em db.js. */
export type ReviewVote = {
  reviewId: string;
  reviewerId: string;
  value: 1 | -1;
};

/* Uma curtida em um comentário. Sem valor: ela existe ou não existe. Em
   critério o par +1/−1 faz sentido porque se concorda ou se discorda de um
   número; no que alguém escreveu, o contrário de curtir não é a mesma
   informação com o sinal trocado. */
export type CommentLike = { commentId: string; reviewerId: string };

/* ── quem reagiu ao que é seu ─────────────────────────────────────────────
   Derivado no servidor das três tabelas de reação, nunca gravado como evento —
   ver routes/notifications.js. A frase vem pronta de lá porque a redação do
   produto é conteúdo autoral e não um switch nesta tela. */
export type Notice = {
  id: string;
  /* `join` é o único que não fala de uma ficha: é alguém batendo na porta do
     clube, e só o ADM o recebe. Por isso `movieId` e `reviewId` são opcionais —
     um pedido de entrada não aponta para avaliação nenhuma. */
  kind: 'comment' | 'reply' | 'mention' | 'vote' | 'like' | 'join';
  /** ISO em UTC, sem fuso no texto — ver `whenOf`. */
  at: string;
  /* O retrato vem no aviso e não do elenco do clube: o sino é lido no saguão,
     onde não há elenco nenhum para consultar. */
  actor: { id: string; name: string; dot: string; avatar?: string | null };
  /* De qual sala veio. Presente no sino da rede, ausente no de uma sala só —
     lá a resposta é a sala em que se está. É também o que faz o clique levar
     ao lugar certo de qualquer tela. */
  club?: { name: string; slug: string };
  movieId?: number;
  reviewId?: string;
  /* O texto exato de que o aviso fala, quando há um. É o que faz o link levar
     ao comentário em vez de à ficha inteira — sem ele a pessoa chega na
     avaliação certa e procura qual das respostas era. */
  commentId?: string | null;
  /** A frase inteira: "comentou sua avaliação de Parasita". */
  text: string;
  /** Um pedaço do que foi escrito, em comentário e curtida. */
  excerpt?: string;
  /** +1 ou −1, só em voto — é o que decide a direção do polegar no painel. */
  value?: number;
};

/* ── o feed ───────────────────────────────────────────────────────────────
   O que aconteceu no clube, em ordem de tempo. Derivado no servidor das mesmas
   tabelas de sempre — ver routes/feed.js —, então uma linha nunca sobrevive ao
   acontecimento que ela anuncia.

   Um tipo só para os quatro acontecimentos, com os campos que só alguns deles
   têm marcados como opcionais. A alternativa é uma união discriminada, que aqui
   custaria quatro interfaces e um `switch` de tipo em cada leitura para
   descrever quatro formas que compartilham nove campos dos onze. */
export type FeedEvent = {
  id: string;
  kind: 'review' | 'comment' | 'vote' | 'queued';
  at: string;
  actor: { id: string; name: string; dot: string };
  movieId: number;
  movieTitle: string;
  moviePoster: string | null;
  /** Ausente só na fila: um filme entra nela sem ninguém ter avaliado nada. */
  reviewId?: string;
  /* Só em comentário: o texto de que a linha fala, para o clique cair nele e não
     na ficha inteira — e o pai, quando o texto é uma resposta a outro. */
  commentId?: string | null;
  parentId?: string | null;
  /** De quem é a ficha em que se comentou ou votou. */
  owner?: { id: string; name: string };
  /** Só em avaliação. */
  final?: number;
  genre?: string;
  /* Onde a pessoa se entusiasmou e onde se decepcionou. Null quando a ficha não
     tem distância entre os extremos — ver `endsOf` no servidor. */
  ends?: { high: { name: string; value: number }; low: { name: string; value: number } } | null;
  /** Só em voto. */
  value?: number;
  criterion?: string;
  /** O que foi escrito: o comentário da ficha, ou o comentário em si. */
  excerpt?: string | null;
};

/* O sino é de uma sala: a pessoa em três clubes tem três sinos, e cada um conta
   o que aconteceu na sua. Ver routes/notifications.js. */
/* ── o sino, e ele é da REDE ──────────────────────────────────────────────
   Uma lista só, de todas as salas de que a pessoa é. Antes havia um sino por
   clube e ele só existia dentro dele: quem estava em três salas precisava entrar
   em cada uma para saber se alguém tinha respondido alguma coisa, e o saguão —
   a primeira tela depois de entrar, onde "o que aconteceu enquanto eu não
   estava?" é a única pergunta — não tinha nenhum.

   Fora do escopo de clube (`api` e não `capi`), por isso mesmo. A rota por sala
   continua existindo no servidor; nenhuma tela usa. */
export const notifications = {
  all: () =>
    api<{
      items: Notice[];
      unread: number;
      /* O que a CONTA está esperando, que não é um acontecimento e por isso não
         entra na lista ordenada por tempo nem some ao limpar. */
      account: { verifyEmail: boolean };
      /** Em quantas salas a pessoa está: abaixo de duas, dizer de qual sala veio
          cada linha é repetir a mesma palavra em todas elas. */
      clubs: number;
    }>('/api/notices'),
  seen: () => post<{ ok: true }>('/api/notices/seen', {}),
  /* Esvazia a sua lista movendo uma data por sala. Não apaga comentário, voto
     nem curtida: um aviso é a projeção de uma linha que é de outra pessoa. */
  clear: () => post<{ ok: true }>('/api/notices/clear', {}),
};

export const social = {
  all: () =>
    capi<{ comments: ReviewComment[]; votes: ReviewVote[]; commentLikes: CommentLike[] }>('/social'),
  comment: (reviewId: string, body: string, parentId?: string | null) =>
    cpost<ReviewComment>(`/social/reviews/${reviewId}/comments`, { body, parentId: parentId ?? null }),
  uncomment: (id: string) => cdel(`/social/comments/${id}`),
  likeComment: (id: string, liked: boolean) =>
    capi<{ liked: boolean }>(`/social/comments/${id}/like`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liked }),
    }),
  /** 0 tira o voto. Devolve o voto gravado, ou null quando foi retirado. */
  vote: (reviewId: string, value: 1 | -1 | 0) =>
    capi<{ vote: ReviewVote | null }>(`/social/reviews/${reviewId}/vote`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    }),
};

export type Review = {
  id: string;
  reviewerId: string;
  reviewerName: string;
  reviewerDot: string;
  movieId: number;
  movieTitle: string;
  movieYear: number | null;
  movieGenre: string;
  /* Os outros nomes do filme, para a busca do acervo. Lidos do cache do filme
     e não gravados com a avaliação — ver `crowd` abaixo, que vem de lá pelo
     mesmo motivo. */
  movieOriginal?: string | null;
  movieEnglish?: string | null;
  moviePoster: string | null;
  movieDirector: string | null;
  /** How long the film runs, in minutes. Null when TMDB never reported one. */
  movieRuntime: number | null;
  scores: Record<string, number>;
  final: number;
  date: string;
  comment: string;
  breakdown: BreakdownRow[];
  /* What TMDB's own voters gave the film, on the same 0–10 as `final`. Read
     from the film cache rather than stored with the take: it is a fact about
     the film and it keeps moving, while the take is frozen. Null on a film the
     cache has never seen. */
  crowd?: { score: number; votes: number } | null;
};

export type Movie = {
  id: number;
  title: string;
  /* O nome com que o filme circula lá fora, para quem vai atrás de uma cópia:
     "Entre Facas e Segredos" não acha nada, "Knives Out" acha. Null when it is
     the same string as `title`, which is most films — the line is only drawn
     when it has something to add. Not always English: it is TMDB's original
     title, so a Korean film comes back in Korean. */
  original?: string | null;
  /* O nome em inglês, quando ele não é nenhum dos dois acima — Parasita é
     `Parasita`, `기생충` e `Parasite`, e só o terceiro acha uma cópia. Existe
     para as buscas locais e não é desenhado em lugar nenhum. Só chega em filme
     que o clube guardou: ficha aberta, fila ou avaliado. */
  english?: string | null;
  year: number | null;
  /** The genre it opens on: the first of `genres`. */
  genre: string;
  /** Every genre in the club's taxonomy this film carries, most specific first. */
  genres?: string[];
  poster: string | null;
  director?: string | null;
  /** Minutes. Only the details endpoint carries it; a search result has none. */
  runtime?: number | null;
  overview?: string | null;
  cast?: { name: string }[];
  /* Who signs each criterion, keyed by criterion key — `fotografia`, `som`,
     `montagem`. Built by the server from credits it was already parsing. A key
     is absent when nobody is credited for it, which happens honestly: an
     animation rarely credits a director of photography, and nobody at all
     signs `originalidade`. */
  crew?: Record<string, string[]>;
  /* TMDB's own average, on the same 0–10 as the club's, with the number of
     people behind it. Null when nobody has voted — TMDB reports that as an
     average of zero, which is not the same thing as a bad film. */
  crowd?: { score: number; votes: number } | null;
  trailerUrl?: string | null;
  /* Where the film can be watched in Brazil, from TMDB's JustWatch data. Null
     when nothing carries it here, which for an old or obscure film is the
     common case — and absent entirely on a cached film, because the cache does
     not store it: a catalogue moves and a stale answer to "está na Netflix?"
     is worse than no answer. */
  watch?: {
    /** TMDB's page for this film's providers. The link out, as they ask. */
    link: string | null;
    /* Included in something already paid for: flatrate, free and ad-supported
       alike. Rental and purchase are not carried — see `watchIn` in tmdb.js. */
    streaming: Provider[];
  } | null;
  stale?: boolean;
};

export type Provider = { id: number; name: string; logo: string | null };

export type WatchItem = {
  id: number;
  title: string;
  /** See `Movie['original']`. Read through the film cache, not stored here. */
  original?: string | null;
  /** See `Movie['english']`. Also read through the cache. */
  english?: string | null;
  year: number | null;
  genre: string;
  poster: string | null;
  addedAt?: string;
  /* Quem pôs o filme na fila. Só o id: o nome, a cor e o retrato saem do clube
     que já está carregado. Nulo numa linha anterior à coluna, ou de alguém que
     saiu do clube depois. */
  addedBy?: string | null;
};

/* ══════════════════════════════════════════════════════════════════════════
   De qual clube fala esta chamada.

   O servidor põe o clube na URL (`/api/c/<slug>/...`) e o porquê está em
   clubs.js: link colado no Discord tem de significar a mesma coisa para quem
   clicar, e `EventSource` não sabe mandar cabeçalho.

   Do lado de cá isso vira uma pergunta chata: quinze componentes chamam a API, e
   passar o slug por props do App até o botão de curtir seria uma prop nova em
   cada um deles para dizer uma coisa que a barra de endereço já diz.

   Então mora aqui, num módulo, e é escrito por quem lê a rota — o App, antes de
   montar qualquer tela. Estado mutável de módulo é feio e é o mesmo desenho que
   `live.ts` já usa pelo mesmo motivo. O que o torna seguro é a ordem: nenhuma
   busca acontece antes de a rota ser resolvida, porque a tela que buscaria só
   existe depois de o clube existir.

   `capi` grita em vez de mandar uma URL torta quando esquecem de escrever: um
   404 de `/api/c/undefined/reviews` seria um bug procurado no servidor.
   ══════════════════════════════════════════════════════════════════════════ */
let currentClub: string | null = null;

export function setClub(slug: string | null) {
  currentClub = slug;
}

export function clubPath(path: string) {
  if (!currentClub) throw new Error('Nenhum clube aberto — clubPath foi chamado cedo demais.');
  return `/api/c/${encodeURIComponent(currentClub)}${path}`;
}

/** `api`, dentro do clube aberto. Todo o resto do produto usa esta. */
export const capi = <T>(path: string, opts?: RequestInit) => api<T>(clubPath(path), opts);

export const cpost = <T>(path: string, body: unknown) => post<T>(clubPath(path), body);

export const cdel = (path: string) => del(clubPath(path));

export async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* the server did not send a JSON body; the status text stands */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return null as T;
  return res.json() as Promise<T>;
}

export const post = <T>(path: string, body: unknown) =>
  api<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const del = (path: string) => api<null>(path, { method: 'DELETE' });

/* ── product truth, mirrored for immediate feedback ──────────────────────
   The server owns the formula (app/criteria.js). The client recomputes it only
   so the score answers the hand without a round trip; it never decides it. */

/* A média do que a ficha responde, ponderada — o que hoje é a média simples,
   porque todo peso é 1. O divisor é contado e não constante: uma avaliação
   gravada antes de Aproveitamento existir tem dez marcas e não onze, e a
   décima primeira não é um zero, é uma pergunta que ninguém fez. Mesma conta
   do servidor, em criteria.js, que é quem decide. */
export function finalOf(criteria: Criterion[], scores: Record<string, number>) {
  const weight = totalWeight(criteria, scores);
  return weight ? weightedSum(criteria, scores) / weight : 0;
}

export function weightedSum(criteria: Criterion[], scores: Record<string, number>) {
  return criteria.reduce(
    (sum, c) => (typeof scores[c.key] === 'number' ? sum + scores[c.key] * c.w : sum),
    0
  );
}

/** O divisor: a soma dos pesos das perguntas que esta ficha respondeu. */
export function totalWeight(criteria: Criterion[], scores: Record<string, number>) {
  return criteria.reduce((sum, c) => (typeof scores[c.key] === 'number' ? sum + c.w : sum), 0);
}

export function fmt(n: number) {
  return Number(n).toFixed(1).replace('.', ',');
}

/* ── how long it runs ─────────────────────────────────────────────────────
   Written the way a listing writes it — 1h 52min, 2h for a round one, 48min
   for a short — rather than the raw minute count TMDB reports, because "112"
   is a number to convert and "1h 52min" is a length of evening. Null when the
   film has no runtime on record, so every caller can decide with `? :` whether
   the line has a duration in it at all. */
export function runtimeOf(minutes: number | null | undefined) {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h ${m}min` : `${h}h`;
}

export function verdictFor(final: number) {
  if (final >= 9) return 'Obra excepcional do gênero.';
  if (final >= 8) return 'Muito acima da média.';
  if (final >= 6.5) return 'Bom filme, com ressalvas.';
  if (final >= 5) return 'Irregular — funciona pela metade.';
  return 'Não se sustenta.';
}

export function initialsOf(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '?') + (p[1]?.[0] ?? '')).toUpperCase();
}

/* Reviewer identity: the colour comes from the persisted `dot` the server
   assigns once per person, never from roster position, so removing a member
   cannot recolour everyone else's history. */
const LEGACY_DOTS = ['#b5abfc', '#cfd3e5', '#a7a1db', '#b2b6ca', '#d2cefd', '#9397ab'];
/* As dez cores de carretel. A segunda era o ciano do sistema e virou verdete
   quando o ciano saiu do produto inteiro — o slot é o mesmo, então quem já
   usava continua sendo a segunda pessoa do clube, só que noutro tom.

   Verdete e não latão, apesar de latão ser a cor de estado agora: identidade e
   estado não podem ser a mesma tinta. Uma pessoa cuja etiqueta tem exatamente a
   cor do anel de foco é uma pessoa que parece selecionada o tempo todo. Pelo
   mesmo motivo o âmbar do índice 2 ficou vizinho do latão e é o próximo a se
   mexer, se alguém achar que embaralha. */
const REEL = [
  '#e0362c', '#4fa98c', '#e8b44a', '#7bc47f', '#c77dd6',
  '#f08a5d', '#5b8dd9', '#d95f8a', '#8fce7c', '#c9bfae',
];
function hashOf(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
export function reelColor(dot: string | null | undefined, id: string) {
  const i = LEGACY_DOTS.indexOf(String(dot ?? '').toLowerCase());
  return i >= 0 ? REEL[i] : REEL[hashOf(id) % REEL.length];
}
