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
  photo: string | null;
  createdAt?: string | null;
  /** Só chega quando você é de lá. */
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
  /* O link do e-mail aponta para a TELA (`#confirmar/<token>`), e é ela que
     chama isto. Nunca uma rota direta: servidores de e-mail e antivírus abrem
     os links das mensagens antes de a pessoa ver, e um token que se gasta ao ser
     aberto é um token que o scanner queima no caminho. */
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
  /* `founded` é o teto de um clube por pessoa, dito pelo servidor: ver
     routes/clubs.js. */
  all: () => api<{ mine: Club[]; open: Club[]; founded: boolean }>('/api/clubs'),
  create: (body: { name: string; tagline?: string; visibility: 'public' | 'private'; photo?: string | null }) =>
    post<{ club: Club }>('/api/clubs', body),
  get: (slug: string) => api<{ club: Club }>(`/api/c/${encodeURIComponent(slug)}`),
  update: (
    slug: string,
    patch: Partial<
      Pick<Club, 'name' | 'tagline' | 'visibility' | 'showReviews' | 'showComments'>
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

/* Um clube é um clube: mesmo nome, mesma gente, mesmo ADM. O universo decide o
   que se olha DENTRO dele, e por isso mora no endereço e não na sessão — um
   link colado no Discord não pode significar coisas diferentes conforme o que o
   leitor escolheu antes de abri-lo. */
export type Universe = 'filmes' | 'series';

/* ══ o universo de séries ═════════════════════════════════════════════════
   Duas metades, e a divisão é a mesma do universo de filmes: o CATÁLOGO é do
   TMDB e não é de clube nenhum (`/api/series`), e o que o clube fez com ele —
   a fila e o que cada um viu — desce para `/api/c/<slug>/shows`. */

export type SeriesItem = {
  id: number;
  title: string;
  original: string | null;
  year: number | null;
  genre: string;
  genres: string[];
  poster: string | null;
  crowd: { score: number; votes: number } | null;
  /* Os três estados: ausente é "ninguém perguntou" (a série veio do cache),
     `null` é "perguntamos e não passa em lugar nenhum aqui", e a lista é a
     resposta. Vale mais aqui do que num filme — uma série ou está incluída numa
     assinatura que alguém já paga, ou o clube não maratona. */
  watch?: {
    link: string | null;
    streaming: Provider[];
  } | null;
};

export type SeriesSeason = {
  season: number;
  name: string;
  episodes: number;
  year: number | null;
  poster: string | null;
  overview: string | null;
};

export type ShowDetail = SeriesItem & {
  english: string | null;
  endedYear: number | null;
  /** Se ainda vem episódio. Acompanhar uma série no ar é outra relação. */
  status: string | null;
  inProduction: boolean;
  overview: string | null;
  creators: string[];
  runtime: number | null;
  /** Null quando o TMDB não respondeu e a resposta veio do cache: "não sei". */
  seasons: SeriesSeason[] | null;
  totalEpisodes: number | null;
  /** As outras ordens em que esta série existe. Ver `episode_groups` no TMDB. */
  orders: { id: string; name: string; episodes: number; groups: number }[];
  trailerUrl: string | null;
  /* `watch` vem de `SeriesItem`: o detalhe e a grade respondem a mesma pergunta
     com a mesma forma, e declará-la duas vezes era ela poder divergir. */
  stale?: boolean;
};

export type Episode = {
  season: number;
  episode: number;
  title: string;
  overview: string | null;
  still: string | null;
  airDate: string | null;
  runtime: number | null;
  crowd: { score: number; votes: number } | null;
  /** `finale`, `mid_season` ou `standard`, do TMDB. */
  kind: string | null;
};

/** Um episódio com quem o assina — e os nomes mudam a cada um. */
export type EpisodeDetail = Episode & { crew: Record<string, string[]> };

export type SeasonDetail = {
  season: number;
  name: string;
  overview: string | null;
  poster: string | null;
  episodes: Episode[];
};

export const seriesApi = {
  popular: (page = 1) =>
    api<{ page: number; totalPages: number; results: SeriesItem[] }>(
      `/api/series/popular?page=${page}`
    ),
  search: (q: string, page = 1) =>
    api<{ page: number; totalPages: number; results: SeriesItem[] }>(
      `/api/series/search?q=${encodeURIComponent(q)}&page=${page}`
    ),
  byGenre: (genre: string, page = 1) =>
    api<{ page: number; totalPages: number; results: SeriesItem[] }>(
      `/api/series/genre/${encodeURIComponent(genre)}?page=${page}`
    ),
  show: (id: number) => api<{ show: ShowDetail }>(`/api/series/${id}`),
  season: (id: number, season: number) =>
    api<{ season: SeasonDetail }>(`/api/series/${id}/season/${season}`),
  episode: (id: number, season: number, episode: number) =>
    api<{ episode: EpisodeDetail }>(`/api/series/${id}/episode/${season}/${episode}`),
  /* Os nove por gênero, servidos pelo servidor: a fórmula e a lista de critérios
     são dele, e o cliente só desenha. Mesma regra do universo de filmes. */
  criteria: () =>
    api<{ genres: string[]; criteria: Record<string, Criterion[]> }>('/api/series/criteria'),
};

/* ── um quadro do reel ────────────────────────────────────────────────────
   O mínimo para uma obra ocupar a tela inteira com o trailer tocando. Tudo o
   que a ficha mostra — elenco, duração, onde assistir — é buscado quando a
   ficha abre, e não aqui: um reel carrega vinte destes por rolagem.

   `trailerKey` nunca é nulo. O servidor tira da página quem não tem vídeo, pelo
   mesmo motivo que uma sala não projeta um filme que não chegou. */
export type ReelItem = {
  id: number;
  kind: 'movie' | 'show';
  title: string;
  original: string | null;
  year: number | null;
  genre: string;
  genres: string[];
  poster: string | null;
  /** O quadro deitado, que é o que fica atrás do vídeo. */
  backdrop: string | null;
  overview: string | null;
  crowd: { score: number; votes: number } | null;
  trailerKey: string;
};

export const reels = {
  /* Perguntados ao servidor e não lidos da taxonomia do clube: as duas listas
     têm nove nomes cada e não são a mesma lista — o TMDB não tem gênero de
     terror em série. Um chip que o servidor não sabe descobrir mostraria tudo e
     diria que filtrou. */
  genres: (kind: ReelItem['kind']) =>
    api<{ genres: string[] }>(`/api/reels/genres?kind=${kind}`),
  /* `like` são as obras mais bem avaliadas do clube, e o que volta são as
     vizinhas delas — a sugestão sai do gosto da sala e não do que está popular.
     Sem elas, ou quando não enchem a página, o servidor completa com a
     descoberta comum. */
  page: (kind: ReelItem['kind'], genre: string | null, page = 1, like: number[] = []) =>
    api<{ page: number; totalPages: number; results: ReelItem[] }>(
      `/api/reels?kind=${kind}&page=${page}` +
        (genre ? `&genre=${encodeURIComponent(genre)}` : '') +
        (like.length ? `&like=${like.join(',')}` : '')
    ),
  /* Na ordem em que os ids são mandados, que é a ordem em que o clube avaliou.
     Quem decide o que abre o reel é a tela, que sabe quando cada ficha foi
     escrita. */
  pinned: (kind: ReelItem['kind'], ids: number[]) =>
    api<{ results: ReelItem[] }>(`/api/reels/pinned?kind=${kind}&ids=${ids.join(',')}`),
};

/** Uma série na fila do clube, com o progresso DO CLUBE. */
export type QueuedShow = {
  id: number;
  title: string;
  original: string | null;
  english: string | null;
  year: number | null;
  genre: string;
  poster: string | null;
  status: string | null;
  totalEpisodes: number | null;
  addedAt: string;
  /* Quem acompanha — e são vários, porque acompanhar é de cada um e o cartaz é
     um só. Vazia quando a lista não sabe de quem é a escolha. Ver `WatchItem`. */
  wanters: string[];
  /** Episódios distintos que o clube já viu — não linhas. */
  seen: number;
  rated: number;
  average: number | null;
  /* ── e o que VOCÊ vê a seguir ────────────────────────────────────────────
     O resto desta linha é do clube; estes três são seus. `upNext` é o primeiro
     episódio já no ar que você não marcou, `upcoming` é o próximo a estrear
     quando você está em dia numa série que continua, e `caughtUp` diz que não
     falta nada já exibido.

     Os três nulos com `caughtUp` falso é "não sei": ninguém logado, ou o TMDB
     não respondeu. Ver upnext.js. */
  upNext?: EpisodeRef | null;
  upcoming?: EpisodeRef | null;
  caughtUp?: boolean;
  /* Onde esta série está passando. Os mesmos três estados de `SeriesItem`, e
     preenchido pela mesma via — ver providers.js. A lista que o clube acompanha
     é onde "hoje a gente vê qual?" é perguntado, e essa pergunta é sobre o que
     dá para ver hoje. */
  watch?: {
    link: string | null;
    streaming: Provider[];
  } | null;
};

/** Um episódio apontado de longe: a tripla, o nome e quando foi (ou vai) ao ar. */
export type EpisodeRef = {
  season: number;
  episode: number;
  title: string | null;
  airDate: string | null;
};

/* ── uma linha do universo de séries ──────────────────────────────────────
   Duas coisas com a mesma forma, e `kind` diz qual:

   · `episode` — a MARCA. Existir significa que a pessoa viu, e mais nada: as
     colunas de nota vêm sempre vazias.
   · `season` — a FICHA, com `episode` nulo. `quick` é a nota objetiva, `scores`
     é a criteriosa, e as duas se substituem: a última coisa dita é a que vale. */
export type ShowTake = {
  id: string;
  kind: 'episode' | 'season';
  showId: number;
  showTitle: string;
  showPoster: string | null;
  genre: string;
  season: number;
  /** Nulo na ficha de uma temporada: ela não fala de um episódio. */
  episode: number | null;
  episodeTitle: string | null;
  reviewerId: string;
  reviewerName: string | null;
  reviewerDot: string | null;
  scores: Record<string, number> | null;
  quick: number | null;
  final: number | null;
  comment: string | null;
  watchedAt: string;
  ratedAt: string | null;
  /* Os nove critérios abertos, como a ficha de um filme já manda os onze. Vazio
     na marca de um episódio e na ficha de nota rápida: as duas não têm critério
     por dentro. Ver `takeDTO` em routes/shows.js. */
  breakdown: BreakdownRow[];
};

/* ── a conversa em cima de uma ficha de episódio ──────────────────────────
   Os mesmos três tipos do lado de filmes, com `takeId` no lugar de `reviewId`.
   As peças que os desenham são as mesmas — ver components/social.tsx —, e é por
   isso que os nomes dos campos são os mesmos até onde podem ser. */
export type TakeComment = {
  id: string;
  takeId: string;
  reviewerId: string;
  reviewerName: string;
  reviewerDot: string;
  body: string;
  parentId?: string | null;
  createdAt: string;
};

export type TakeVote = { takeId: string; reviewerId: string; value: 1 | -1 };

/* ── o mural do universo de séries ────────────────────────────────────────
   Três tipos de linha, e o terceiro é o que este universo tem e o outro não:
   `seen` é marcar sem avaliar, e vem AGRUPADO por pessoa, série e dia. Uma
   maratona é um acontecimento, não treze. Ver routes/showsFeed.js. */
export type ShowFeedEvent = {
  id: string;
  kind: 'take' | 'seen' | 'comment';
  at: string;
  actor: { id: string; name: string; dot: string };
  showId: number;
  showTitle: string;
  showPoster: string | null;
  genre?: string;
  /* Em `take` e `comment`: de que a linha fala. `episode` nulo é uma ficha de
     temporada, que é o que se avalia agora. */
  season?: number;
  episode?: number | null;
  episodeTitle?: string | null;
  takeId?: string;
  final?: number;
  ends?: { high: { name: string; value: number }; low: { name: string; value: number } } | null;
  excerpt?: string | null;
  /** Só em comentário. */
  commentId?: string;
  parentId?: string | null;
  owner?: { id: string; name: string };
  /** Só em `seen`: quantos episódios a sessão juntou, e de onde até onde. */
  count?: number;
  from?: { season: number; episode: number };
  to?: { season: number; episode: number; title: string | null };
};

export const showsSocial = {
  all: () =>
    capi<{ comments: TakeComment[]; votes: TakeVote[]; commentLikes: CommentLike[] }>(
      '/shows-social'
    ),
  comment: (takeId: string, body: string, parentId?: string | null) =>
    cpost<TakeComment>(`/shows-social/takes/${takeId}/comments`, { body, parentId: parentId ?? null }),
  uncomment: (id: string) => cdel(`/shows-social/comments/${id}`),
  likeComment: (id: string, liked: boolean) =>
    cput<{ liked: boolean }>(`/shows-social/comments/${id}/like`, { liked }),
  vote: (takeId: string, value: 1 | -1 | 0) =>
    cput<{ vote: TakeVote | null }>(`/shows-social/takes/${takeId}/vote`, { value }),
  feed: () => capi<{ items: ShowFeedEvent[] }>('/shows-feed'),
};

/** O que viaja com a marca de um episódio. Nota nenhuma: ela é da temporada. */
export type MarkPatch = {
  showTitle: string;
  showPoster?: string | null;
  episodeTitle?: string | null;
  genre: string;
};

/** O que se grava numa temporada. Uma das duas notas, sempre. */
export type SeasonPatch = {
  showTitle: string;
  showPoster?: string | null;
  genre: string;
  quick?: number;
  scores?: Record<string, number>;
  comment?: string | null;
};

export const shows = {
  queue: () => capi<{ shows: QueuedShow[] }>('/shows'),
  add: (show: { id: number; title: string; year: number | null; genre: string; poster: string | null }) =>
    cpost<{ ok: true }>('/shows', { show }),
  remove: (showId: number) => cdel(`/shows/${showId}`),
  /** Tudo o que o clube gravou, para o acervo. */
  takes: () => capi<{ takes: ShowTake[] }>('/shows/takes'),
  takesFor: (showId: number) => capi<{ takes: ShowTake[] }>(`/shows/${showId}/takes`),
  /** Marcar um episódio: a linha existir é o "eu vi". */
  mark: (showId: number, season: number, episode: number, patch: MarkPatch) =>
    cput<{ take: ShowTake }>(`/shows/${showId}/${season}/${episode}`, patch),
  /** Desmarcar apaga a linha: a linha É o "eu vi". */
  unmark: (showId: number, season: number, episode: number) =>
    cdel(`/shows/${showId}/${season}/${episode}`),
  /** Avaliar a temporada, que é onde a nota mora. */
  rate: (showId: number, season: number, patch: SeasonPatch) =>
    cput<{ take: ShowTake }>(`/shows/${showId}/${season}`, patch),
  /** Tirar a própria nota. O que você viu continua visto. */
  unrate: (showId: number, season: number) => cdel(`/shows/${showId}/${season}`),
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

/* `oficio` são os oito sobre como o filme é feito, `genero` os dois que o filme
   escolhe, `pessoal` o único que pergunta sobre você.

   Vem do servidor em vez de deduzido da chave ou do peso: o peso era o que
   agrupava antes, e com os pesos iguais esse atalho não diz nada. */
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
  /* O mesmo id, com o nome que os dois universos compartilham: a conversa é
     desenhada pelas mesmas peças em cima de uma ficha de filme e de uma de
     episódio, e "take" é como o produto chama as duas. Ver components/social. */
  takeId: string;
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
  /** O mesmo id sob o nome comum aos dois universos. Ver `ReviewComment`. */
  takeId: string;
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
     um pedido de entrada não aponta para avaliação nenhuma.

     `airing` é o único que não fala de uma pessoa: o episódio que estreia hoje
     numa série que você acompanha. Vem sem `actor`, com a série no lugar. */
  kind: 'comment' | 'reply' | 'mention' | 'vote' | 'like' | 'join' | 'airing';
  /** ISO em UTC, sem fuso no texto — ver `whenOf`. */
  at: string;
  /* O retrato vem no aviso e não do elenco do clube: o sino junta as salas
     todas, e o elenco carregado na tela é o de uma só. Ausente em `airing`:
     não houve quem. */
  actor?: { id: string; name: string; dot: string; avatar?: string | null };
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
  /* Só em `airing`: a série de que o aviso fala, e o episódio que estreia. O
     cartaz entra no lugar do retrato, e é ele que faz a linha ser reconhecida
     antes de ser lida. */
  showId?: number;
  showTitle?: string;
  showPoster?: string | null;
  season?: number;
  episode?: number;
};

/* O que aconteceu no clube, em ordem de tempo. Derivado no servidor das mesmas
   tabelas de sempre, então uma linha nunca sobrevive ao acontecimento que ela
   anuncia.

   Um tipo só para os quatro acontecimentos, com os campos que só alguns têm
   marcados como opcionais: a união discriminada custaria quatro interfaces e um
   `switch` de tipo em cada leitura para descrever quatro formas que
   compartilham nove campos dos onze. */
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
   Uma lista só, de todas as salas de que a pessoa é. Antes havia um por clube:
   quem estava em três salas precisava entrar em cada uma para saber se alguém
   tinha respondido.

   Fora do escopo de clube (`api` e não `capi`), por isso mesmo. */
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
  /* Em que sala esta ficha foi gravada, e só quando NÃO foi nesta. O acervo de
     um clube é o acervo das pessoas dele — quem entra chega com o que já
     escreveu —, então uma ficha de fora precisa dizer de onde veio. Nulo é o
     caso comum: foi avaliado aqui, e não há o que etiquetar. */
  origin?: { name: string | null; slug: string | null } | null;
};

export type Movie = {
  id: number;
  title: string;
  /* O nome com que o filme circula lá fora, para quem vai atrás de uma cópia:
     "Entre Facas e Segredos" não acha nada, "Knives Out" acha. Null quando é a
     mesma string do título. Nem sempre inglês: é o `original_title` do TMDB,
     então um filme coreano volta em coreano. */
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
  /* Who signs each criterion, keyed by criterion key. A key is absent when
     nobody is credited for it, which happens honestly: an animation rarely
     credits a director of photography, and nobody at all signs
     `originalidade`. */
  crew?: Record<string, string[]>;
  /* TMDB's own average, on the same 0–10 as the club's, with the number of
     people behind it. Null when nobody has voted — TMDB reports that as an
     average of zero, which is not the same thing as a bad film. */
  crowd?: { score: number; votes: number } | null;
  trailerUrl?: string | null;
  /* Where the film can be watched in Brazil. Null when nothing carries it here,
     which for an old or obscure film is the common case — and absent entirely on
     a cached film, because a catalogue moves and a stale answer to "está na
     Netflix?" is worse than no answer. */
  watch?: {
    /** TMDB's page for this film's providers. The link out, as they ask. */
    link: string | null;
    /* Included in something already paid for: flatrate, free and ad-supported
       alike. Rental and purchase are not carried — see `watchIn` in tmdb.js. */
    streaming: Provider[];
  } | null;
  stale?: boolean;
};

export type Provider = {
  id: number;
  name: string;
  logo: string | null;
  /* O endereço do título DENTRO deste serviço, quando o JustWatch conhece um.
     Ausente numa linha gravada antes de isto existir, e nulo quando ele não
     respondeu — nos dois casos a tela cai na busca do serviço. Ver
     justwatch.js e lib/watch.ts. */
  url?: string | null;
};

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
  /* Quem quer ver — e são vários, porque "quero ver" é de cada um e o cartaz é
     um só. Só os ids: o nome, a cor e o retrato saem do clube que já está
     carregado. Vazia quando a fila não sabe de quem é a escolha: linha anterior
     à coluna, ou de alguém que saiu do clube depois. */
  wanters: string[];
};

/* ══════════════════════════════════════════════════════════════════════════
   De qual clube fala esta chamada.

   O servidor põe o clube na URL, e o porquê está em clubs.js. Do lado de cá
   isso vira uma pergunta chata: quinze componentes chamam a API, e passar o
   slug por props do App até o botão de curtir seria uma prop nova em cada um
   deles para dizer o que a barra de endereço já diz.

   Então mora num módulo, escrito por quem lê a rota — o App, antes de montar
   qualquer tela. O que o torna seguro é a ordem: nenhuma busca acontece antes
   de a rota ser resolvida, porque a tela que buscaria só existe depois de o
   clube existir.

   `capi` grita em vez de mandar uma URL torta: um 404 de
   `/api/c/undefined/reviews` seria um bug procurado no servidor.
   ══════════════════════════════════════════════════════════════════════════ */
let currentClub: string | null = null;

export function setClub(slug: string | null) {
  currentClub = slug;
}

export function clubPath(path: string) {
  if (!currentClub) throw new Error('Nenhum clube aberto — clubPath foi chamado cedo demais.');
  return `/api/c/${encodeURIComponent(currentClub)}${path}`;
}

/* Há sala aberta? Existe para quem PODE rodar fora de uma: o app resolve o
   clube antes de abrir a tela, e há um instante entre a sessão e a sala em que
   o cano ao vivo já está montado e o clube ainda não.

   Uma pergunta e não um `try` em volta de `clubPath`: o lançamento ali é para
   pegar uma chamada de clube feita cedo demais, que é um defeito. "Ainda não há
   sala" não é defeito nenhum, é o instante antes. */
export const hasClub = () => currentClub !== null;

/** `api`, dentro do clube aberto. Todo o resto do produto usa esta. */
export const capi = <T>(path: string, opts?: RequestInit) => api<T>(clubPath(path), opts);

export const cpost = <T>(path: string, body: unknown) => post<T>(clubPath(path), body);

export const cdel = (path: string) => del(clubPath(path));

/* PUT dentro do clube. Existe porque marcar um episódio é idempotente — o mesmo
   pedido duas vezes tem de deixar o mesmo estado —, e POST não promete isso. */
export const cput = <T>(path: string, body: unknown) =>
  api<T>(clubPath(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

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

/* A média do que a ficha responde, ponderada — hoje a média simples, porque
   todo peso é 1. O divisor é CONTADO: uma avaliação anterior a Aproveitamento
   tem dez marcas, e a décima primeira não é um zero, é uma pergunta que ninguém
   fez. Mesma conta do servidor, em criteria.js, que é quem decide. */
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

/* Written the way a listing writes it — 1h 52min, 2h for a round one, 48min for
   a short — because "112" is a number to convert and "1h 52min" is a length of
   evening. Null when the film has no runtime on record, so every caller can
   decide whether the line has a duration in it at all. */
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
/* As dez cores de carretel. Verdete e não latão, apesar de latão ser a cor de
   estado: identidade e estado não podem ser a mesma tinta — uma pessoa cuja
   etiqueta tem exatamente a cor do anel de foco parece selecionada o tempo
   todo. Pelo mesmo motivo o âmbar do índice 2 é o próximo a se mexer, se alguém
   achar que embaralha. */
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
