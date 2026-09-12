import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { HolographicWall } from '@/components/ui/holographic-wall-shadcnui';
import { ProjectionSheet } from '@/components/film';
import { Notices } from '@/components/notices';
import { ClubSwitch } from '@/components/clubs';
import { Fault } from '@/components/bits';
import {
  api,
  auth,
  capi,
  cdel,
  clubs as clubsApi,
  cpost,
  initialsOf,
  reelColor,
  setClub,
  social,
  type Club as ClubRow,
  type CommentLike,
  type Criterion,
  type ReviewVote,
  type Movie,
  type Reviewer,
  type Review,
  type ReviewComment,
  type SessionUser,
  type WatchItem,
} from '@/lib/api';
import {
  seriesApi,
  shows as showsApi,
  showsSocial,
  type ShowTake,
  type QueuedShow,
  type TakeComment,
  type TakeVote,
} from '@/lib/api';
import { WorldProvider, type World } from '@/lib/world';
import { appIsReady } from '@/lib/session';
import {
  SeasonSheet,
  SeriesArchiveScreen,
  SeriesCatalogScreen,
  SeriesFeedScreen,
  SeriesQueueScreen,
  ShowScreen,
} from '@/screens/Series';
import { resetLive, useLive, type LiveKind } from '@/lib/live';
import { DARK, readPulse, samePulse, type ScreeningMovie, type ScreeningPulse } from '@/lib/screening';
import { UserPlus } from 'lucide-react';
import { Key, Lens, Reel } from '@/components/bits';
import { SettingsSheet } from '@/components/settings';
import { SetPassword, SignIn } from '@/screens/SignIn';
import { ConfirmEmail, ResetPassword } from '@/screens/EmailLink';

import { cn, plural } from '@/lib/utils';
import { MovieReels, SeriesReels } from '@/screens/Reels';
import { FeedScreen } from '@/screens/Feed';
import { RateScreen } from '@/screens/Rate';
import { CatalogScreen, WatchlistScreen } from '@/screens/Catalog';
import { ReviewsScreen } from '@/screens/Reviews';
import { ProfileScreen } from '@/screens/Profile';
import { ScreeningScreen } from '@/screens/Screening';

export const TABS = [
  /* Primeiro na fila e porta de entrada: um mural que não é a tela de chegada é
     um mural que ninguém lê. Para trocar a porta, mover esta entrada para baixo
     de `catalog` e mudar o `?? 'feed'` adiante. */
  { id: 'feed', label: 'Feed' },
  /* Rota, não aba: avaliar não se escolhe, escolhe-se um filme. `hidden` e não
     exclusão porque `rateMovie` escreve `#rate`, e um endereço que a tabela não
     reconhece derruba o Voltar e joga o recarregar no feed. */
  { id: 'rate', label: 'Avaliar', hidden: true },
  { id: 'catalog', label: 'Catálogo' },
  /* O reel de trailers. Rota e não aba: a porta dele é a chave no alto do
     catálogo, porque procurar um filme e pedir que sugiram um são o mesmo gesto
     começando de lugares diferentes. */
  { id: 'sugestoes', label: 'Sugestões', hidden: true },
  { id: 'watchlist', label: 'Quero ver' },
  /* Entre a fila e os avaliados, que é a ordem de uma noite: escolhe, assiste,
     avalia. */
  { id: 'screening', label: 'Sessão' },
  { id: 'reviews', label: 'Avaliados' },
  /* Chega-se por um rosto, nunca por aba — uma aba "Perfil" só levaria ao seu, e
     o que faz disto uma rede social é ele existir para todo mundo.
     `#perfil/<id>` diz de quem é; sem id, é o seu. */
  { id: 'perfil', label: 'Perfil', hidden: true },
  /* Endereço antigo, roteável e nada mais: alguém pode ter `#people` guardado.
     Cai no próprio perfil, que é para onde ele sempre apontou. */
  { id: 'people', label: 'Avaliadores', hidden: true },
] as const;

/* Uma tabela própria, e não `hidden` espalhado na de cima: as duas listas
   respondem a mesma pergunta sobre mundos diferentes, e misturá-las obrigaria
   toda leitura de rota a saber de qual das duas aquela entrada é. */
export const SERIES_TABS = [
  /* O feed primeiro, como no universo de filmes: um mural que não é a tela de
     chegada é um mural que ninguém lê. */
  { id: 'feed', label: 'Feed' },
  /* E o catálogo logo atrás: neste universo o gesto que se repete é achar a
     próxima série e marcar o que se viu. */
  { id: 'catalog', label: 'Catálogo' },
  /* O reel, atrás da mesma chave do catálogo de filmes. */
  { id: 'sugestoes', label: 'Sugestões', hidden: true },
  /* "Minhas séries" e não "Quero ver": no universo de filmes a fila é o que
     ainda não se viu, e aqui ela é o que o clube ACOMPANHA — uma série na lista
     costuma estar meio assistida, não esperando. */
  { id: 'watchlist', label: 'Minhas séries' },
  /* A MESMA sala do outro universo, e por isso no mesmo lugar da fileira: um
     clube é uma gente só, e assistir junto não muda por o que toca ter uma
     temporada. O que muda é o que se escolhe para abrir. */
  { id: 'screening', label: 'Sessão' },
  { id: 'reviews', label: 'Avaliados' },
  /* Uma série, com as temporadas e os episódios. Rota e não aba, pela mesma
     razão que avaliar não é aba no universo de filmes: não se escolhe "uma
     série", escolhe-se AQUELA série. */
  { id: 'show', label: 'Série', hidden: true },
  { id: 'perfil', label: 'Perfil', hidden: true },
] as const;

export type TabId = (typeof TABS)[number]['id'] | (typeof SERIES_TABS)[number]['id'];

/** Qual tabela de seções vale nesta lente. */
const tabsFor = (universe: Universe) => (universe === 'series' ? SERIES_TABS : TABS);

type Club = {
  me: SessionUser;
  club: ClubRow;
  /** Se você administra ESTA sala — diferente de `me.isAdmin`, que é a instalação. */
  isClubAdmin: boolean;
  refreshClub: () => Promise<void>;
  /** Sair da sala. As suas fichas aqui continuam onde estão. */
  leaveClub: () => Promise<void>;
  /** Esta sala acabou de deixar de existir: cai no primeiro clube que sobrou. */
  goHome: () => void;
  /* Abre a folha de ajustes — conta, senha e, para o ADM, a sala e os pedidos.
     No contexto porque três lugares a abrem: a engrenagem do perfil, o
     distintivo de pedidos na marquise e um aviso do sino. */
  openClubSettings: () => void;
  signOut: () => void;
  refreshReviewers: () => Promise<void>;
  refreshMe: () => Promise<void>;
  avatarOf: (reviewerId: string) => string | null;
  reviewers: Reviewer[];
  reviews: Review[];
  watchlist: WatchItem[];
  criteria: Record<string, Criterion[]>;
  genres: string[];
  /* Carregada inteira no boot, não por avaliação: a tela de avaliados desenha o
     acervo todo, e buscar por ficha seriam quarenta requisições e um "carregando"
     dentro de cada gaveta. Num clube pequeno isto são centenas de linhas. */
  comments: ReviewComment[];
  votes: ReviewVote[];
  commentLikes: CommentLike[];
  /* Escreve, e devolve o comentário gravado — a lista já se atualizou.
     `parentId` faz dele uma resposta; a profundidade para em um. */
  comment: (reviewId: string, body: string, parentId?: string | null) => Promise<void>;
  uncomment: (id: string) => Promise<void>;
  likeComment: (id: string, liked: boolean) => Promise<void>;
  /** +1, −1, ou 0 para tirar. Repetir o voto que já está posto tira ele. */
  voteOn: (reviewId: string, value: 1 | -1 | 0) => Promise<void>;
  reload: (patch: Partial<Pick<Club, 'reviewers' | 'reviews' | 'watchlist'>>) => void;
  criteriaFor: (genre: string) => Criterion[];
  averages: Record<number, { avg: number; count: number }>;
  inWatchlist: (id: number) => boolean;
  toggleWatch: (m: Movie | WatchItem) => Promise<void>;
  goTab: (t: TabId) => void;
  /** Chamado por todo rosto do app. Sem id, abre o seu. */
  goPerson: (reviewerId?: string | null) => void;
  /** De quem é o perfil aberto, ou null enquanto for o seu. */
  personId: string | null;
  /** Abre o acervo numa ficha e escreve o endereço dela. O que o sino chama. */
  goReview: (reviewId: string, commentId?: string | null) => void;
  focusReview: string | null;
  /** Chamado pela tela quando ela já abriu e rolou até o alvo. */
  clearFocusReview: () => void;
  focusComment: string | null;
  clearFocusComment: () => void;
  /* O mesmo alvo sem a viagem: `goReview` é "vá até lá", isto é "é este", para
     quem já abre a conversa onde está (o feed abre a ficha na própria linha). */
  aimComment: (commentId: string) => void;
  openSheet: (id: number) => void;
  rateMovie: (id: number) => void;
  fault: (msg: string) => void;
};

const ClubContext = createContext<Club | null>(null);
export function useClub() {
  const c = useContext(ClubContext);
  if (!c) throw new Error('useClub precisa estar dentro do App');
  return c;
}

/* ── `#c/<slug>/reviews/<id>` ─────────────────────────────────────────────
   A chave é o id da avaliação e não o par filme+avaliador: é o id que o aviso
   do sino carrega e o que sobrevive a uma regravação, então um link colado no
   Discord continua valendo depois de a pessoa ajustar a nota.

   O clube vem na frente e não guardado na sessão, porque o endereço é feito
   para ser colado. O outro motivo é mecânico e está em clubs.js: `EventSource`
   não manda cabeçalho.

   Sem `c/` na frente não há clube, e o app resolve o primeiro da pessoa — ver
   `EnterFirstClub`. Seção desconhecida cai no catálogo; id que não existe mais
   abre a aba e não foca nada. */
/* O universo vem antes de tudo: `#series/c/<slug>/feed` contra `#c/<slug>/feed`.
   Mora no endereço pela mesma razão que o clube mora.

   Filmes é a AUSÊNCIA de prefixo, e isso não é preguiça: é o que faz todo
   endereço que já existe continuar valendo. Uma ficha compartilhada mês passado
   abre no mesmo lugar depois de o universo de séries existir. */
type Universe = 'filmes' | 'series';

type Route = {
  universe: Universe;
  club: string | null;
  tab: TabId | null;
  review: string | null;
  comment: string | null;
  person: string | null;
  /** Qual série a rota pede, no universo de séries. */
  show: number | null;
  /* A folha de ajustes aberta pelo endereço. Não é aba: é folha por cima da
     sala. Tem endereço para poder ser MANDADA — um aviso do sino sobre um
     pedido de entrada leva direto a ela. */
  sheet: boolean;
};

const BLANK: Omit<Route, 'universe'> = {
  club: null,
  tab: null,
  review: null,
  comment: null,
  person: null,
  show: null,
  sheet: false,
};

function routeFromHash(): Route {
  const raw = (location.hash || '').replace(/^#/, '');
  // O que vier depois de `?` é recado da volta do Google, não caminho.
  const clean = raw.split('?')[0];
  const all = clean.split('/').filter(Boolean);

  /* O prefixo é consumido antes de qualquer outra leitura, então tudo daqui
     para baixo continua sendo exatamente o parser que já existia. */
  const universe: Universe = all[0] === 'series' ? 'series' : 'filmes';
  const parts = universe === 'series' ? all.slice(1) : all;

  if (parts[0] !== 'c' || !parts[1]) return { ...BLANK, universe };
  const club = decodeURIComponent(parts[1]);
  const [head, tail, deeper] = parts.slice(2);

  /* Contra a tabela DA LENTE: `screening` é seção no universo de filmes e não
     existe no de séries, e reconhecê-la ali abriria uma aba que não há. */
  const table = tabsFor(universe) as readonly { id: string }[];
  const tab = table.some(t => t.id === head) ? (head as TabId) : null;
  /* `show/<id>` é o endereço de uma série. Número e não texto: é um id do TMDB,
     e um id que não é número não aponta para nada. */
  const show = tab === 'show' && tail && /^\d+$/.test(tail) ? Number(tail) : null;
  const review = tab === 'reviews' && tail ? decodeURIComponent(tail) : null;
  /* Um quarto segmento endereça o comentário dentro da ficha: é o que faz o
     aviso levar ao texto em vez de à carta inteira. */
  const comment = review && deeper ? decodeURIComponent(deeper) : null;
  /* De quem é o perfil. `perfil` sem id, e o antigo `people`, são o seu. */
  const person = tab === 'perfil' && tail ? decodeURIComponent(tail) : null;
  /* `ajustes` não é aba, então `tab` fica nulo e a sala abre no mural com a
     folha por cima — o mesmo que abrir os ajustes de dentro. */
  const sheet = head === 'ajustes';
  return { universe, club, tab, review, comment, person, show, sheet };
}

/* `#confirmar/<token>` e `#senha/<token>`. Fora de `routeFromHash` de propósito:
   aquele resolve o que existe DENTRO de um clube, e estes dois são anteriores a
   haver clube, conta ou sessão. */
function emailRouteFromHash(): 'confirmar' | 'senha' | null {
  const head = (location.hash || '').replace(/^#/, '').split('?')[0].split('/').filter(Boolean)[0];
  return head === 'confirmar' || head === 'senha' ? head : null;
}

/** O prefixo do universo. Filmes não tem nenhum — ver a nota em `Route`. */
const lensOf = (universe: Universe) => (universe === 'series' ? 'series/' : '');

/** O endereço de uma seção dentro de um clube. Um lugar só que monta isto. */
const clubHash = (slug: string, rest = '', universe: Universe = 'filmes') =>
  `${lensOf(universe)}c/${encodeURIComponent(slug)}${rest ? '/' + rest : ''}`;

/* Três perguntas em ordem, cada uma só fazendo sentido depois da anterior: quem
   é você, você já guardou uma segunda chave, e em que sala você está. Separado
   do `ClubApp` por isso — lá embaixo dá para assumir que há clube, sessão e
   dados, sem desenhar nenhum estado de "ainda não". */
export default function App() {
  const [me, setMe] = useState<SessionUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [skippedPassword, setSkippedPassword] = useState(false);
  const [route, setRoute] = useState<Route>(() => routeFromHash());
  /* Lido junto da rota e pelo mesmo ouvinte: sair da tela de confirmação
     reescreve o endereço, e sem isto o app mostraria a tela que ele já não pede. */
  const [emailRoute, setEmailRoute] = useState(() => emailRouteFromHash());

  /* A sessão decide se o app renderiza, então é perguntada primeiro e sozinha:
     quem está deslogado chega na tela de entrada sem esperar por catálogo. */
  const checkAuth = useCallback(async () => {
    try {
      /* Numa casca de aplicativo, uma sessão de navegador já aberta do outro
         lado — a volta do Google — vira um par de chaves antes da primeira
         pergunta. No site isto não faz nada. Ver lib/session.ts. */
      await auth.adopt();
      const res = await auth.me();
      setMe(res.reviewer);
      setNeedsPassword(!!res.needsPassword);
    } catch {
      setMe(null);
    } finally {
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  /* A tela subiu. Num aplicativo isto é o que confirma o pacote recém-trocado:
     sem este aviso ele volta ao anterior sozinho. Aqui e não em main.tsx porque
     este efeito só roda se a árvore montou — que é justamente o que se está
     dizendo. Ver lib/session.ts. */
  useEffect(() => {
    appIsReady();
  }, []);

  useEffect(() => {
    const onHash = () => {
      setRoute(routeFromHash());
      setEmailRoute(emailRouteFromHash());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  /* Escrito ANTES de qualquer tela do clube montar, e é isso que torna seguro o
     slug morar num módulo em vez de descer por props até o botão de curtir (ver
     lib/api.ts). O cano ao vivo fecha junto: ele é de uma sala, e uma conexão
     que sobrevive à troca continua trazendo o que acontece na sala que saiu. */
  useEffect(() => {
    setClub(route.club);
    resetLive();
  }, [route.club]);

  const signOut = useCallback(async () => {
    try {
      await auth.logout();
    } catch {
      /* o cookie some de qualquer jeito; seguir adiante desloga o navegador */
    }
    setMe(null);
    setNeedsPassword(false);
    location.hash = '';
  }, []);

  if (!authChecked) {
    return (
      <>
        <HolographicWall asBackdrop />
        <div className="relative flex min-h-[calc(100dvh/var(--ui-zoom))] items-center justify-center">
          <span className="legend animate-flicker">Acendendo o projetor</span>
        </div>
      </>
    );
  }

  /* Antes da pergunta "quem é você", e é o ponto: quem clicou num link de
     redefinição está fora justamente porque não sabe responder, e quem confirma
     um endereço pode estar no celular com a conta aberta no computador. */
  if (emailRoute === 'confirmar') {
    return <ConfirmEmail onDone={() => { location.hash = ''; void checkAuth(); }} />;
  }
  if (emailRoute === 'senha') {
    return <ResetPassword onSignedIn={u => { location.hash = ''; setMe(u); void checkAuth(); }} />;
  }

  if (!me) return <SignIn onSignedIn={u => { setMe(u); void checkAuth(); }} />;

  /* Antes de qualquer sala porque é sobre a conta — e porque logo depois da
     primeira entrada é o único momento em que "guarde uma segunda chave" tem
     contexto. Pular é permitido: obrigatório na porta é pedágio. */
  if (needsPassword && !skippedPassword) {
    return (
      <SetPassword
        onDone={() => {
          setNeedsPassword(false);
          void checkAuth();
        }}
        onSkip={() => setSkippedPassword(true)}
      />
    );
  }

  /* Sem clube no endereço não há tela: o app abre DENTRO de uma sala. Ver
     `EnterFirstClub`. */
  if (!route.club) return <EnterFirstClub universe={route.universe} />;

  /* A lente de séries tem o próprio casco: as abas são outras, os dados são
     outros, e não há sala de projeção. Fazer `ClubApp` bimodal infectaria os
     quarenta ganchos dele com um `if`. */
  if (route.universe === 'series') {
    return (
      <SeriesClubApp
        key={`series/${route.club}`}
        slug={route.club}
        route={route}
        me={me}
        onHome={() => {
          location.hash = lensOf('series');
        }}
      />
    );
  }

  /* `key` no slug E na lente: trocar de clube desmonta o app inteiro em vez de
     reaproveitar as telas, e nenhum estado do clube anterior sobrevive porque o
     componente que o segurava deixou de existir. A lente entra pela mesma razão
     — reaproveitar as telas entre os dois universos mostraria uma fila
     carregada com a coisa errada até a busca voltar. */
  return (
    <ClubApp
      key={`${route.universe}/${route.club}`}
      slug={route.club}
      route={route}
      me={me}
      setMe={setMe}
      onSignOut={() => void signOut()}
      onLeaveClub={() => {
        /* Endereço vazio, que cai no primeiro clube que sobrou. Guardando a
           lente: quem estava olhando séries continua olhando séries. */
        location.hash = lensOf(route.universe);
      }}
    />
  );
}

/* ══ o endereço sem clube ══════════════════════════════════════════════════
   Havia um saguão aqui: uma tela da rede inteira, com as duas listas de salas e
   uma vitrine do que os clubes andavam fazendo. Ele foi apagado a pedido do
   usuário, e com ele a ideia de que existe um lugar do produto que não é uma
   sala. O app abre DENTRO de um clube; trocar de sala é o painel da marquise.

   Então este endereço não desenha nada: resolve para onde ir e vai. Para o
   PRIMEIRO clube da pessoa, que é o mais antigo dela (`mineStmt` ordena por
   `joined_at`) — e o mais antigo de todo mundo é o Cineclube, porque toda conta
   nasce dentro dele (ver `joinHomeClub` no servidor). Quem fundou uma sala
   própria depois continua abrindo o app na que já era a dele.

   O Cineclube é a reserva e não a resposta: uma conta pode ter saído dele, e
   mandar alguém de volta para uma sala que ela largou é o produto discutindo a
   decisão. Só quando não sobra nenhuma — e aí ele é público, então abre.

   `replaceState` e não `hash =`: o endereço vazio é uma passagem, e deixá-lo no
   histórico faria o Voltar cair aqui e ser mandado adiante de novo, que é um
   Voltar que não volta. */
const HOME = 'cineclube';

function EnterFirstClub({ universe }: { universe: Universe }) {
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      let destino = HOME;
      try {
        const { mine } = await clubsApi.all();
        destino = mine[0]?.slug ?? HOME;
      } catch (e) {
        /* A lista não veio; o Cineclube é público e abre de qualquer jeito. Se
           ele também falhar, quem diz é a tela do clube, que sabe dizer por quê. */
        if (vivo) setErro((e as Error).message);
      }
      if (!vivo) return;
      history.replaceState(null, '', '#' + clubHash(destino, 'feed', universe));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    })();
    return () => {
      vivo = false;
    };
  }, [universe]);

  return (
    <>
      <HolographicWall asBackdrop />
      <div className="relative flex min-h-[calc(100dvh/var(--ui-zoom))] items-center justify-center">
        <span className="legend animate-flicker">{erro ? 'Abrindo o Cineclube' : 'Acendendo o projetor'}</span>
      </div>
    </>
  );
}

/* ══ o clube, pela lente de séries ═════════════════════════════════════════
   Irmão de `ClubApp`: os dois compartilham a moldura, a marquise e o clube, e o
   que muda é tudo o que está dentro. Sem contexto próprio — são quatro telas e
   recebem por prop o que precisam; um segundo `ClubContext` seria uma segunda
   verdade sobre a mesma sala. */
function SeriesClubApp({
  slug,
  route,
  me,
  onHome,
}: {
  slug: string;
  route: Route;
  me: SessionUser;
  /* Sair desta sala sem escolher outra: o endereço vazio resolve o primeiro
     clube da pessoa. Ver `EnterFirstClub`. */
  onHome: () => void;
}) {
  const [club, setClubRow] = useState<ClubRow | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  /* Quem está na sala. Não é para desenhar a marquise — ela já tem `me` e o
     clube —, é para as duas listas que filtram por pessoa: a fila sabe o id de
     quem pôs cada série, e o acervo sabe o id de quem assinou cada ficha, e
     nenhum dos dois carrega o retrato junto. */
  const [roster, setRoster] = useState<Reviewer[]>([]);
  const [queue, setQueue] = useState<QueuedShow[] | null>(null);
  const [takes, setTakes] = useState<ShowTake[] | null>(null);
  const [criteria, setCriteria] = useState<Record<string, Criterion[]> | null>(null);
  /* A conversa do clube em cima das fichas de episódio: comentários, votos e
     curtidas, os três carregados inteiros no boot pelo mesmo motivo do outro
     universo — o acervo desenha dezenas de fichas, e buscar por ficha seria uma
     tela feita de "carregando" dentro de cada gaveta. */
  const [comments, setComments] = useState<TakeComment[]>([]);
  const [votes, setVotes] = useState<TakeVote[]>([]);
  const [commentLikes, setCommentLikes] = useState<CommentLike[]>([]);
  /** O comentário que o mural quer acender ao abrir uma ficha na própria linha. */
  const [focusComment, setFocusComment] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /* A porta é o mural, como no outro universo: "o que aconteceu por aqui" se
     pergunta toda vez que alguém entra, e "qual série a gente começa" não. */
  const [tab, setTab] = useState<TabId>(() => route.tab ?? 'feed');
  const [showId, setShowId] = useState<number | null>(() => route.show);
  /* A lâmpada da marquise, e a sala é a MESMA das duas lentes: um episódio
     rodando acende do lado de filmes e um filme acende deste. Ver o porquê de
     ela morar fora da tela da sessão em `ClubApp`. */
  const [pulse, setPulse] = useState<ScreeningPulse>(DARK);
  /* O episódio que a sessão mandou avaliar. Aqui e não na tela da sessão porque
     a folha é uma folha: ela abre por cima de onde você está, e quem acabou de
     ver não deve perder a sala para escrever o que achou. */
  const [avaliando, setAvaliando] = useState<ScreeningMovie | null>(null);

  const fault = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 6000);
  }, []);

  /* O clube vem antes de tudo porque decide se há o que carregar, exatamente
     como no universo de filmes. */
  const boot = useCallback(async () => {
    setBootError(null);
    try {
      const room = await clubsApi.get(slug);
      setClubRow(room.club);
      const [fila, gravadas, crits, gente, conversa] = await Promise.all([
        showsApi.queue(),
        showsApi.takes(),
        seriesApi.criteria(),
        capi<{ reviewers: Reviewer[] }>('/reviewers'),
        showsSocial.all(),
      ]);
      setQueue(fila.shows);
      setTakes(gravadas.takes);
      setCriteria(crits.criteria);
      setRoster(gente.reviewers);
      setComments(conversa.comments);
      setVotes(conversa.votes);
      setCommentLikes(conversa.commentLikes);
    } catch (e) {
      setBootError((e as Error).message);
    }
  }, [slug]);

  useEffect(() => {
    void boot();
  }, [boot]);

  /* Pergunta de fora e nunca assina o stream da sala — entrar nele é entrar na
     sala. O erro morre em silêncio: ninguém pediu esta pergunta, e uma lâmpada
     apagada é uma falha honesta. Ver a mesma coisa em `ClubApp`. */
  useEffect(() => {
    if (!club) return;
    const read = () => {
      void readPulse().then(
        next => setPulse(prev => (samePulse(prev, next) ? prev : next)),
        () => {
          /* engolido: ver acima */
        }
      );
    };
    read();
    const tick = () => {
      if (document.visibilityState === 'visible') read();
    };
    const id = window.setInterval(tick, 90_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [club]);

  /* Relê só o que a escrita mexeu. Marcar um episódio muda o acervo e o
     progresso da fila, e não o clube nem os critérios. */
  const refresh = useCallback(async () => {
    try {
      const [fila, gravadas] = await Promise.all([showsApi.queue(), showsApi.takes()]);
      setQueue(fila.shows);
      setTakes(gravadas.takes);
    } catch {
      /* Engolido: ninguém pediu esta releitura, ela é a consequência de uma
         escrita que já deu certo. */
    }
  }, []);

  /* As mesmas quatro escritas do universo de filmes, com a mesma estratégia:
     escrever e reler a coleção inteira. Costurar a resposta na lista à mão seria
     uma segunda cópia da regra de ordenação que o servidor já aplica. */
  const relerConversa = useCallback(async () => {
    const got = await showsSocial.all();
    setComments(got.comments);
    setVotes(got.votes);
    setCommentLikes(got.commentLikes);
  }, []);

  const comment = useCallback(
    async (takeId: string, body: string, parentId?: string | null) => {
      await showsSocial.comment(takeId, body, parentId ?? null);
      await relerConversa();
    },
    [relerConversa]
  );

  const uncomment = useCallback(
    async (id: string) => {
      await showsSocial.uncomment(id);
      await relerConversa();
    },
    [relerConversa]
  );

  const likeComment = useCallback(
    async (id: string, liked: boolean) => {
      await showsSocial.likeComment(id, liked);
      await relerConversa();
    },
    [relerConversa]
  );

  const voteOn = useCallback(
    async (takeId: string, value: 1 | -1 | 0) => {
      await showsSocial.vote(takeId, value);
      await relerConversa();
    },
    [relerConversa]
  );

  /* O perfil mora na lente de filmes — ele conta o que a pessoa avaliou, e hoje
     isso é o acervo de filmes. Mandar para lá é honesto, o endereço diz
     `filmes`, e é melhor do que um rosto que não abre nada. */
  const goPerson = useCallback(
    (reviewerId?: string | null) => {
      location.hash = clubHash(slug, reviewerId ? `perfil/${reviewerId}` : 'perfil', 'filmes');
    },
    [slug]
  );

  const avatarOf = useCallback(
    (reviewerId: string) => roster.find(r => r.id === reviewerId)?.avatar ?? null,
    [roster]
  );

  useEffect(() => {
    const onHash = () => {
      const r = routeFromHash();
      if (r.universe !== 'series' || r.club !== slug) return;
      if (r.tab) setTab(r.tab);
      setShowId(r.show);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [slug]);

  const goTab = useCallback(
    (t: TabId) => {
      setTab(t);
      setShowId(null);
      const next = clubHash(slug, t, 'series');
      if ((location.hash || '').replace(/^#/, '') !== next) location.hash = next;
    },
    [slug]
  );

  /* Uma série tem endereço, e é o que faz "manda o link daquela série" existir
     neste universo. */
  const goShow = useCallback(
    (id: number) => {
      setTab('show');
      setShowId(id);
      const next = clubHash(slug, `show/${id}`, 'series');
      if ((location.hash || '').replace(/^#/, '') !== next) location.hash = next;
      window.scrollTo({ top: 0, behavior: 'auto' });
    },
    [slug]
  );

  /* O marcador é SEU, não do clube: acompanhar é de cada um, e um marcador aceso
     porque outra pessoa acompanha seria o seu gesto tomado por ela. O cartaz na
     lista é um só; quem o segue pode ser mais de um. */
  const queued = useMemo(
    () => new Set((queue ?? []).filter(s => s.wanters.includes(me.id)).map(s => s.id)),
    [queue, me.id]
  );

  const enqueue = useCallback(
    async (s: { id: number; title: string; year: number | null; genre: string; poster: string | null }) => {
      try {
        await showsApi.add(s);
        await refresh();
      } catch (e) {
        fault('Não foi possível pôr na fila: ' + (e as Error).message);
      }
    },
    [refresh, fault]
  );

  const dequeue = useCallback(
    async (id: number) => {
      try {
        await showsApi.remove(id);
        await refresh();
      } catch (e) {
        fault((e as Error).message);
      }
    },
    [refresh, fault]
  );

  /* O pedaço da sala que as peças sociais leem, montado a partir do que estas
     telas já carregam. As duas entregas satisfazem o mesmo contrato, e é por
     isso que o voto, a conversa, o retrato e a menção são as MESMAS peças nos
     dois universos. Ver lib/world.tsx. */
  const world = useMemo<World>(
    () => ({
      me,
      reviewers: roster,
      comments,
      votes,
      commentLikes,
      comment,
      uncomment,
      likeComment,
      voteOn,
      avatarOf,
      goPerson,
      focusComment,
      clearFocusComment: () => setFocusComment(null),
      fault,
    }),
    [
      me,
      roster,
      comments,
      votes,
      commentLikes,
      comment,
      uncomment,
      likeComment,
      voteOn,
      avatarOf,
      goPerson,
      focusComment,
      fault,
    ]
  );

  if (bootError && !club) {
    return (
      <>
        <HolographicWall asBackdrop />
        <div className="relative mx-auto flex min-h-[calc(100dvh/var(--ui-zoom))] w-full max-w-[560px] flex-col justify-center px-5">
          <h1 className="font-display text-[34px] leading-none tracking-[0.04em] text-beam">
            Este clube não abre
          </h1>
          <div className="mt-5">
            <Fault detail={bootError}>O clube não existe, ou é privado e você não está nele.</Fault>
          </div>
          <div className="mt-5">
            <Key onClick={onHome}>Ir para outro clube</Key>
          </div>
        </div>
      </>
    );
  }

  if (!club) {
    return (
      <>
        <HolographicWall asBackdrop />
        <div className="relative flex min-h-[calc(100dvh/var(--ui-zoom))] items-center justify-center">
          <span className="legend animate-flicker">Acendendo o projetor</span>
        </div>
      </>
    );
  }

  /* As fichas desta série, quando há uma aberta. Filtradas aqui e não na tela
     porque o acervo inteiro já está em memória desde o boot. */
  const doShow = showId != null ? (takes ?? []).filter(t => t.showId === showId) : [];

  return (
    <WorldProvider value={world}>
      <HolographicWall asBackdrop />
      <div className="relative flex min-h-[calc(100dvh/var(--ui-zoom))] flex-col coarse:h-full coarse:min-h-0 coarse:overflow-hidden">
        <Marquee
          tabs={SERIES_TABS}
          tab={tab}
          onTab={goTab}
          /* Um endereço só para o perfil, e ele é o da lente de filmes. Não é
             mais "o perfil é de filmes": a página conta as duas lentes desde
             que ganhou o módulo de séries. É que ela é UMA, e duas portas para
             a mesma página seriam dois endereços para o mesmo link colado. */
          onOpenSelf={() => {
            location.hash = clubHash(slug, 'perfil', 'filmes');
          }}
          me={me}
          club={club}
          room={pulse}
          universe="series"
          /* O MESMO clube, pela outra lente. Sem seção no endereço: a aba em que
             se estava é de séries e pode não existir do outro lado, e cair numa
             aba que não há é pior que abrir no mural. */
          onUniverse={u => {
            location.hash = clubHash(slug, '', u);
          }}
          onEnterClub={slug => { location.hash = clubHash(slug, 'feed', 'series'); }}
          onOpenRequests={() => {
            location.hash = clubHash(slug, 'ajustes', 'filmes');
          }}
        />

        <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 pb-20 pt-7 coarse:overflow-y-auto coarse:overscroll-contain coarse:pb-8 sm:px-6 sm:pt-10">
          <div key={showId != null ? `show-${showId}` : tab} className="animate-frame-in">
            {showId != null ? (
              <ShowScreen
                showId={showId}
                takes={doShow}
                criteria={criteria}
                meId={me.id}
                inQueue={queued.has(showId)}
                onQueue={s => void enqueue(s)}
                onBack={() => goTab('catalog')}
                onSaved={() => void refresh()}
                fault={fault}
              />
            ) : tab === 'watchlist' ? (
              <SeriesQueueScreen
                shows={queue}
                roster={roster}
                me={me}
                onOpen={goShow}
                onRemove={id => void dequeue(id)}
              />
            ) : tab === 'reviews' ? (
              <SeriesArchiveScreen takes={takes} roster={roster} onOpen={goShow} />
            ) : tab === 'catalog' ? (
              <SeriesCatalogScreen
                queued={queued}
                onQueue={s => void enqueue(s)}
                onOpen={goShow}
                onTab={goTab}
                fault={fault}
              />
            ) : tab === 'screening' ? (
              /* A tela é a mesma do outro universo. O que ela recebe daqui é o
                 que muda entre as lentes: escolhe-se um episódio das séries do
                 clube, e quem acaba de ver vai para a série — a ficha é de um
                 episódio e mora lá dentro. */
              <ScreeningScreen
                shows={queue ?? []}
                onRate={m =>
                  m.kind === 'episode'
                    ? /* A MESMA folha da tela da série, aberta por cima da
                         sessão: sair da sala para escrever o que achou é perder
                         o que ainda está tocando para os outros. */
                      setAvaliando(m)
                    : /* Um filme, aberto do outro lado: a ficha dele é de lá, e
                         a chave que a abre está na sessão daquela lente. */
                      (location.hash = clubHash(slug, 'screening', 'filmes'))
                }
                /* A sala fechou o episódio anterior para todo mundo que estava
                   dentro; o acervo desta casca é quem desenha o progresso, e
                   ele acabou de ficar velho. */
                onSeen={() => void refresh()}
              />
            ) : tab === 'sugestoes' ? (
              <SeriesReels
                takes={takes}
                meId={me.id}
                queued={id => queued.has(id)}
                onQueue={s => void enqueue(s)}
                onOpen={goShow}
                onTab={goTab}
              />
            ) : (
              <SeriesFeedScreen
                takes={takes}
                onOpenShow={goShow}
                onAimComment={setFocusComment}
              />
            )}
          </div>
        </main>

        <SectionTabs
          variant="bar"
          tabs={SERIES_TABS}
          tab={tab}
          onTab={goTab}
          room={pulse}
          rec={recOf(pulse)}
        />
      </div>

      {/* A folha da sessão, e ela é a da TEMPORADA do episódio que está
          passando: a nota é dela. `key` no par série-temporada para a folha
          nascer limpa quando a sala muda de temporada.

          Sem o nome e sem a sinopse da temporada: a sala conhece o episódio, e
          buscar o resto do TMDB no meio de uma projeção é trabalho que a folha
          não precisa para receber uma nota. */}
      {avaliando?.season != null ? (
        <SeasonSheet
          key={`${avaliando.id}x${avaliando.season}`}
          showId={avaliando.id}
          showTitle={avaliando.title}
          showPoster={avaliando.poster}
          genre={avaliando.genre}
          season={avaliando.season}
          name={null}
          overview={null}
          takes={(takes ?? []).filter(
            t =>
              t.kind === 'season' &&
              t.showId === avaliando.id &&
              t.season === avaliando.season
          )}
          meId={me.id}
          criteria={criteria?.[avaliando.genre] ?? null}
          onClose={() => setAvaliando(null)}
          onSaved={() => void refresh()}
          fault={fault}
        />
      ) : null}

      {toast ? (
        <div className="fixed inset-x-0 bottom-4 z-50 mx-auto w-fit max-w-[92vw] px-4">
          <Fault>{toast}</Fault>
        </div>
      ) : null}
    </WorldProvider>
  );
}

/* ── o app dentro de uma sala ─────────────────────────────────────────────
   Recebe o clube já resolvido e pode assumir as três coisas que o componente
   acima garantiu: há sessão, há senha resolvida, e há uma sala. Toda chamada
   daqui para baixo passa por `capi`, que já sabe qual é (ver lib/api.ts). */
function ClubApp({
  slug,
  route,
  me,
  setMe,
  onSignOut,
  onLeaveClub,
}: {
  slug: string;
  route: Route;
  me: SessionUser;
  setMe: (u: SessionUser) => void;
  onSignOut: () => void;
  onLeaveClub: () => void;
}) {
  /* A lente com que este clube está sendo olhado. Sai da rota e vai de volta
     para ela em todo endereço que este componente escreve: navegar dentro de um
     clube não pode trocar de universo por omissão. */
  const lens = route.universe;

  /* O feed é onde a sala abre. "O que a gente vê agora" se pergunta uma vez por
     semana; "o que aconteceu por aqui", toda vez que alguém entra. Um link com
     seção dentro continua ganhando do padrão. */
  const [tab, setTab] = useState<TabId>(() => route.tab ?? 'feed');
  /** A ficha que o endereço pede, até a tela abri-la. Ver `goReview`. */
  const [focusReview, setFocusReview] = useState<string | null>(() => route.review);
  const [focusComment, setFocusComment] = useState<string | null>(() => route.comment);
  /* Null significa "o meu", não "nenhum": a tela resolve contra a sessão, que é
     a única que sabe quem é você. Guardar o seu id aqui seria gravar a resposta
     antes de a sessão existir. */
  const [personId, setPersonId] = useState<string | null>(() => route.person);
  const [club, setClubRow] = useState<ClubRow | null>(null);
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [watchlist, setWatchlist] = useState<WatchItem[]>([]);
  const [criteria, setCriteria] = useState<Record<string, Criterion[]>>({});
  const [genres, setGenres] = useState<string[]>([]);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [votes, setVotes] = useState<ReviewVote[]>([]);
  const [commentLikes, setCommentLikes] = useState<CommentLike[]>([]);
  const [booted, setBooted] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<number | null>(null);
  const [pendingRate, setPendingRate] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /* Se a sala está com um filme rodando. Mora aqui e não na tela da sessão
     porque a coisa toda é justamente para quem NÃO está nela. */
  const [pulse, setPulse] = useState<ScreeningPulse>(DARK);
  /* A folha de ajustes, aberta por quatro lugares: a engrenagem do perfil, o
     distintivo de pedidos na marquise, um aviso do sino, e `#c/<slug>/ajustes`.
     Nasce aberta quando o endereço pede. */
  const [sheetOpen, setSheetOpen] = useState(route.sheet);

  /* O endereço continua mandando: chegar em `ajustes` abre, voltar para uma
     seção fecha. Sem isto o Voltar deixaria a folha aberta sobre o mural. */
  useEffect(() => {
    if (route.sheet) setSheetOpen(true);
  }, [route.sheet]);

  const refreshClub = useCallback(async () => {
    const got = await clubsApi.get(slug);
    setClubRow(got.club);
    /* Renomear troca o slug. Se o nome mudou nesta aba, o hash aponta para um
       que não existe mais e a próxima navegação cai em 404. */
    if (got.club.slug !== slug) {
      location.hash = clubHash(got.club.slug, tab, lens);
    }
  }, [slug, tab, lens]);

  /* O clube vem antes de tudo porque decide se há o que carregar: slug que não
     existe, ou privado de que você não é, respondem 404 aqui — e a tela diz
     isso em vez de disparar cinco buscas que vão todas falhar. */
  const boot = useCallback(async () => {
    setBootError(null);
    try {
      const room = await clubsApi.get(slug);
      setClubRow(room.club);

      const [rv, rs, cr, wl, sc] = await Promise.all([
        capi<{ reviewers: Reviewer[] }>('/reviewers'),
        capi<{ reviews: Review[] }>('/reviews'),
        api<{ genres: string[]; criteria: Record<string, Criterion[]> }>('/api/catalog/criteria-all'),
        capi<{ watchlist: WatchItem[] }>('/watchlist'),
        social.all(),
      ]);
      setReviewers(rv.reviewers);
      setReviews(rs.reviews);
      setCriteria(cr.criteria);
      setGenres(cr.genres);
      setWatchlist(wl.watchlist);
      setComments(sc.comments);
      setVotes(sc.votes);
      setCommentLikes(sc.commentLikes);
      setBooted(true);
    } catch (e) {
      setBootError((e as Error).message);
    }
  }, [slug]);

  useEffect(() => {
    void boot();
  }, [boot]);

  /* Sair da sala, não da conta: as suas fichas continuam onde estão; o que você
     deixa é a lista de quem está dentro. */
  const leaveClub = useCallback(async () => {
    try {
      await clubsApi.leave(slug, me.id);
      onLeaveClub();
    } catch (e) {
      setToast((e as Error).message);
      window.setTimeout(() => setToast(null), 6000);
    }
  }, [slug, me.id, onLeaveClub]);

  const refreshReviewers = useCallback(async () => {
    const rv = await capi<{ reviewers: Reviewer[] }>('/reviewers');
    setReviewers(rv.reviewers);
  }, []);

  /* Nome e foto vivem em dois lugares: a lista de gente e a sessão que os
     desenha na marquise. Editar o seu tem de mexer nos dois. */
  const refreshMe = useCallback(async () => {
    const res = await auth.me();
    if (res.reviewer) setMe(res.reviewer);
  }, []);

  /* A ficha carrega o nome e a cor de quem assinou, mas não a foto — seria uma
     URL em cada uma para algo que muda por pessoa, não por ficha. */
  const avatarOf = useCallback(
    (reviewerId: string) => reviewers.find(r => r.id === reviewerId)?.avatar ?? null,
    [reviewers]
  );

  useEffect(() => {
    const onHash = () => {
      const { club: c, tab: t, review, comment: within, person } = routeFromHash();
      // Outro clube, ou endereço sem clube: quem remonta é o componente de cima.
      if (c !== slug) return;
      if (t) setTab(t);
      /* Só quando há id no endereço: voltar para `#reviews` limpo não deve
         apagar o foco que a tela acabou de consumir, nem acender um antigo. */
      if (review) setFocusReview(review);
      if (within) setFocusComment(within);
      /* O perfil é a exceção: aqui o id não é foco que se consome, é qual
         página está aberta. `#perfil` sem id é "o meu", então o null tem de
         chegar — senão o Voltar deixaria a pessoa anterior na tela. */
      if (t === 'perfil' || t === 'people') setPersonId(person);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [slug]);

  const goTab = useCallback(
    (t: TabId) => {
      setTab(t);
      const next = clubHash(slug, t, lens);
      if ((location.hash || '').replace(/^#/, '') !== next) location.hash = next;
    },
    [slug, lens]
  );

  /* O endereço é escrito sempre, inclusive já estando num perfil: ir de um
     perfil a outro tem de mexer no Voltar. `null` explícito e não ausência —
     chamar sem id pede o SEU perfil e tem de apagar quem estava aberto. A
     rolagem volta ao topo porque isto é troca de página. */
  const goPerson = useCallback(
    (reviewerId?: string | null) => {
      const id = reviewerId ?? null;
      setTab('perfil');
      setPersonId(id);
      const next = clubHash(slug, 'perfil' + (id ? `/${encodeURIComponent(id)}` : ''), lens);
      if ((location.hash || '').replace(/^#/, '') !== next) location.hash = next;
      window.scrollTo({ top: 0, behavior: 'auto' });
    },
    [slug, lens]
  );

  /* A aba, o endereço e o alvo, de uma vez. O endereço é escrito mesmo já
     estando na aba: é ele que a pessoa copia, e recarregar tem de voltar ao
     mesmo lugar. */
  const goReview = useCallback(
    (reviewId: string, commentId?: string | null) => {
      setTab('reviews');
      setFocusReview(reviewId);
      setFocusComment(commentId ?? null);
      const next = clubHash(
        slug,
        `reviews/${encodeURIComponent(reviewId)}` +
          (commentId ? `/${encodeURIComponent(commentId)}` : ''),
        lens
      );
      if ((location.hash || '').replace(/^#/, '') !== next) location.hash = next;
    },
    [slug, lens]
  );

  /* Consumido pela tela assim que ela abre a ficha e rola até lá. Sem isto o
     mesmo alvo reabriria a cada redesenho, e fechar a gaveta à mão seria
     desfeito no instante seguinte. */
  const clearFocusReview = useCallback(() => setFocusReview(null), []);
  /* Limpado pela conversa e não pela tela: só ela sabe quando já rolou até o
     texto. */
  const clearFocusComment = useCallback(() => setFocusComment(null), []);
  /* Sem tocar na aba nem no endereço: quem chama já está com a conversa abrindo
     debaixo do dedo. O endereço continua sendo escrito por `goReview`. */
  const aimComment = useCallback((commentId: string) => setFocusComment(commentId), []);

  const fault = useCallback(
    (msg: string) => {
      /* Sessão vencida no meio do uso cai na tela de entrada em vez de mostrar
         um erro sobre o qual não há o que fazer. A frase é a que o servidor
         responde em `requireSession`. */
      if (/Entre para continuar/i.test(msg)) {
        onSignOut();
        return;
      }
      setToast(msg);
      window.setTimeout(() => setToast(null), 6000);
    },
    [onSignOut]
  );

  /* A string, não o objeto: `refreshMe` troca o objeto, e um callback que
     depende dele inteiro se recria à toa. */
  const meId = me.id;

  const averages = useMemo(() => {
    const acc: Record<number, number[]> = {};
    reviews.forEach(r => {
      (acc[r.movieId] ||= []).push(r.final);
    });
    const out: Record<number, { avg: number; count: number }> = {};
    for (const id in acc) {
      const list = acc[Number(id)];
      out[Number(id)] = { avg: list.reduce((s, v) => s + v, 0) / list.length, count: list.length };
    }
    return out;
  }, [reviews]);

  /* O marcador é SEU, não do clube: "quero ver" é de cada um, e um marcador aceso
     porque outra pessoa quer ver seria o seu gesto tomado por ela — e apertá-lo
     tiraria a escolha de alguém em vez de fazer a sua. O cartaz na fila é um só;
     quem o quer pode ser mais de um. */
  const inWatchlist = useCallback(
    (id: number) =>
      !!me && watchlist.some(w => String(w.id) === String(id) && w.wanters.includes(me.id)),
    [watchlist, me]
  );

  /* A fila de agora, para handlers que não podem se refazer quando ela muda:
     `toggleWatch` é entregue a cada pôster do catálogo, e uma função nova a
     cada marcação é uma prop nova em todos os cem. */
  const watchRef = useRef(watchlist);
  watchRef.current = watchlist;

  /* E quem sou eu, pelo mesmo motivo. */
  const meRef = useRef(me);
  meRef.current = me;

  /* ── o marcador é o seu "quero ver", e só o seu ─────────────────────────
     Nenhuma recusa a prever aqui: tirar o seu é sempre seu direito, e o que não
     é seu nunca aparece aceso. O cartaz só sai da fila quando a última pessoa
     que o queria desistir — é isso que as duas emendas na lista local dizem. */
  const toggleWatch = useCallback(
    async (m: Movie | WatchItem) => {
      const me = meRef.current;
      if (!me) return;
      const held = watchRef.current.find(w => String(w.id) === String(m.id));
      const mine = !!held?.wanters.includes(me.id);
      try {
        if (mine) {
          await cdel(`/watchlist/${m.id}`);
          setWatchlist(list =>
            list
              .map(w =>
                String(w.id) === String(m.id)
                  ? { ...w, wanters: w.wanters.filter(id => id !== me.id) }
                  : w
              )
              .filter(w => String(w.id) !== String(m.id) || w.wanters.length > 0)
          );
        } else {
          await cpost('/watchlist', {
            movie: { id: m.id, title: m.title, year: m.year, genre: m.genre, poster: m.poster },
          });
          setWatchlist(list =>
            held
              ? list.map(w =>
                  String(w.id) === String(m.id) ? { ...w, wanters: [...w.wanters, me.id] } : w
                )
              : [
                  ...list,
                  {
                    id: m.id,
                    title: m.title,
                    year: m.year,
                    genre: m.genre,
                    poster: m.poster,
                    wanters: [me.id],
                  },
                ]
          );
        }
      } catch (e) {
        fault('Não foi possível atualizar a fila: ' + (e as Error).message);
      }
    },
    [fault]
  );

  /* A resposta do servidor é a verdade e entra na lista local, então a tela se
     atualiza sem recarregar o clube. Nada é aplicado antes da resposta: um
     comentário que aparece e some é pior que um que demora meio segundo. Vale
     igual para o voto — o contador é placar, e placar não pode piscar. */
  const comment = useCallback(
    async (reviewId: string, body: string, parentId?: string | null) => {
      const saved = await social.comment(reviewId, body, parentId);
      setComments(prev => [...prev, saved]);
    },
    []
  );

  const uncomment = useCallback(async (id: string) => {
    await social.uncomment(id);
    setComments(prev => prev.filter(c => c.id !== id));
    // O servidor apaga as curtidas em cascata; a lista local tem de acompanhar,
    // ou o contador some com o comentário e volta no próximo boot.
    setCommentLikes(prev => prev.filter(l => l.commentId !== id));
  }, []);

  const likeComment = useCallback(
    async (id: string, liked: boolean) => {
      await social.likeComment(id, liked);
      setCommentLikes(prev => {
        const rest = prev.filter(l => !(l.commentId === id && l.reviewerId === meId));
        return liked && meId ? [...rest, { commentId: id, reviewerId: meId }] : rest;
      });
    },
    [meId]
  );

  const voteOn = useCallback(
    async (reviewId: string, value: 1 | -1 | 0) => {
      const { vote } = await social.vote(reviewId, value);
      setVotes(prev => {
        const rest = prev.filter(v => !(v.reviewId === reviewId && v.reviewerId === meId));
        return vote ? [...rest, vote] : rest;
      });
    },
    [meId]
  );

  /* A lâmpada da marquise: sem ela, uma sessão começava e quem estava no
     catálogo só descobria abrindo a aba Sessão. Pergunta de fora e nunca assina
     o stream da sala — entrar nele é entrar na sala (ver lib/screening.ts). O
     erro morre em silêncio: ninguém pediu esta pergunta, e uma lâmpada apagada
     é uma falha honesta. */
  const readRoom = useCallback(async () => {
    try {
      const next = await readPulse();
      /* Só quando mudou de verdade. Roda a cada minuto e meio numa aba que fica
         aberta a noite toda, e um objeto novo a cada volta redesenharia o app
         inteiro para concluir que a sala continua escura. */
      setPulse(prev => (samePulse(prev, next) ? prev : next));
    } catch {
      /* engolido: ver acima */
    }
  }, []);

  /* Ao vivo é o caminho rápido, não o único: o EventSource desiste depois de
     algumas recusas (ver lib/live.ts), e uma marquise dizendo "ao vivo" duas
     horas depois do fim seria mentira acesa no alto de toda tela. Um minuto e
     meio, o mesmo do sino, e parada com a aba escondida. */
  useEffect(() => {
    if (!booted) return;
    void readRoom();
    const tick = () => {
      if (document.visibilityState === 'visible') void readRoom();
    };
    const id = window.setInterval(tick, 90_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [booted, readRoom]);

  /* O clube ao vivo. Tudo acima era uma fotografia tirada no boot: uma aba
     aberta às oito mostrava às onze o mesmo de oito.

     O aviso do servidor diz só QUAL coleção mudou, e buscar de novo em vez de
     aplicar um delta é a decisão inteira: há uma única forma de cada coleção
     chegar — a rota —, então a tela ao vivo não tem como divergir da
     recarregada. Erro morre em silêncio; a próxima rodada recupera. */
  const applyLive = useCallback((kinds: ReadonlySet<LiveKind>) => {
    const quiet = () => {
      /* engolido: ver acima */
    };
    if (kinds.has('social')) {
      void social
        .all()
        .then(s => {
          setComments(s.comments);
          setVotes(s.votes);
          setCommentLikes(s.commentLikes);
        })
        .catch(quiet);
    }
    if (kinds.has('reviews')) {
      void capi<{ reviews: Review[] }>('/reviews')
        .then(r => setReviews(r.reviews))
        .catch(quiet);
    }
    if (kinds.has('watchlist')) {
      void capi<{ watchlist: WatchItem[] }>('/watchlist')
        .then(w => setWatchlist(w.watchlist))
        .catch(quiet);
    }
    if (kinds.has('reviewers')) {
      void capi<{ reviewers: Reviewer[] }>('/reviewers')
        .then(r => setReviewers(r.reviewers))
        .catch(quiet);
    }
    /* A sala abriu, fechou, ou alguém deu play. Único aviso daqui que não é uma
       coleção — é um cômodo —, então busca o pulso e não uma lista. */
    if (kinds.has('screening')) void readRoom();
    /* O clube em si: alguém entrou, saiu, virou ADM, ou trocou a foto. Mudaram
       quem está dentro e o que a sala é, então os dois são relidos. */
    if (kinds.has('club')) {
      void refreshClub().catch(quiet);
      void refreshReviewers().catch(quiet);
    }
  }, [readRoom, refreshClub, refreshReviewers]);

  /* Só depois de a sala carregar: antes não há clube na URL da API para o cano
     assinar, e insistir gastaria as tentativas do fluxo à toa. */
  useLive(applyLive, booted);

  const reload = useCallback((patch: Partial<Pick<Club, 'reviewers' | 'reviews' | 'watchlist'>>) => {
    if (patch.reviewers) setReviewers(patch.reviewers);
    if (patch.reviews) setReviews(patch.reviews);
    if (patch.watchlist) setWatchlist(patch.watchlist);
  }, []);

  const criteriaFor = useCallback(
    (genre: string) => criteria[genre] ?? criteria['Drama'] ?? [],
    [criteria]
  );

  const rateMovie = useCallback(
    (id: number) => {
      setSheetId(null);
      setPendingRate(id);
      goTab('rate');
    },
    [goTab]
  );

  /* Um objeto para o clube inteiro, refeito só quando algo dentro dele muda.
     Era um objeto novo a cada render: abrir a folha de um filme, ou um toast de
     seis segundos, redesenhava toda tela e todo cartão que lê daqui. */
  const ctx = useMemo<Club | null>(
    () =>
      club
        ? {
            me,
            club,
            isClubAdmin: club.role === 'admin',
            refreshClub,
            leaveClub,
            goHome: onLeaveClub,
            openClubSettings: () => setSheetOpen(true),
            signOut: onSignOut,
            refreshReviewers,
            refreshMe,
            avatarOf,
            reviewers,
            reviews,
            watchlist,
            criteria,
            genres,
            comments,
            votes,
            commentLikes,
            comment,
            uncomment,
            likeComment,
            voteOn,
            reload,
            criteriaFor,
            averages,
            inWatchlist,
            toggleWatch,
            goTab,
            goPerson,
            personId,
            goReview,
            focusReview,
            clearFocusReview,
            focusComment,
            clearFocusComment,
            aimComment,
            openSheet: setSheetId,
            rateMovie,
            fault,
          }
        : null,
    [
      me,
      club,
      refreshClub,
      leaveClub,
      onSignOut,
      refreshReviewers,
      refreshMe,
      avatarOf,
      reviewers,
      reviews,
      watchlist,
      criteria,
      genres,
      comments,
      votes,
      commentLikes,
      comment,
      uncomment,
      likeComment,
      voteOn,
      reload,
      criteriaFor,
      averages,
      inWatchlist,
      toggleWatch,
      goTab,
      goPerson,
      personId,
      goReview,
      focusReview,
      clearFocusReview,
      focusComment,
      clearFocusComment,
      aimComment,
      rateMovie,
      fault,
    ]
  );

  /* A vista que as peças sociais leem: o contexto acima é grande e é deste
     universo, e o de séries sabe entregar o mesmo pedaço — é isso que as deixa
     ser as MESMAS peças nos dois lados. Ver lib/world.tsx.

     `takeId` e não `reviewId`: o servidor manda os dois nomes, e daqui para
     dentro do componente só existe o que serve para as duas fichas. */
  const world = useMemo<World | null>(
    () =>
      ctx
        ? {
            me: ctx.me,
            reviewers: ctx.reviewers,
            comments: ctx.comments,
            votes: ctx.votes,
            commentLikes: ctx.commentLikes,
            comment: ctx.comment,
            uncomment: ctx.uncomment,
            likeComment: ctx.likeComment,
            voteOn: ctx.voteOn,
            avatarOf: ctx.avatarOf,
            goPerson: ctx.goPerson,
            focusComment: ctx.focusComment,
            clearFocusComment: ctx.clearFocusComment,
            fault: ctx.fault,
          }
        : null,
    [ctx]
  );

  /* Endereço apontando para clube que não existe, ou privado de que você não é.
     A saída é outra sala e não a tela de entrada: o problema não é quem você é,
     é onde você tentou entrar. */
  if (bootError && !club) {
    return (
      <>
        <HolographicWall asBackdrop />
        <div className="relative mx-auto flex min-h-[calc(100dvh/var(--ui-zoom))] w-full max-w-[560px] flex-col justify-center px-5">
          <h1 className="font-display text-[34px] leading-none tracking-[0.04em] text-beam">
            Este clube não abre
          </h1>
          <div className="mt-5">
            <Fault detail={bootError}>
              O clube não existe, ou é privado e você não está nele.
            </Fault>
          </div>
          <div className="mt-5">
            <Key onClick={onLeaveClub}>Ir para outro clube</Key>
          </div>
        </div>
      </>
    );
  }

  if (!ctx) {
    return (
      <>
        <HolographicWall asBackdrop />
        <div className="relative flex min-h-[calc(100dvh/var(--ui-zoom))] items-center justify-center">
          <span className="legend animate-flicker">Acendendo o projetor</span>
        </div>
      </>
    );
  }

  return (
    <ClubContext.Provider value={ctx}>
    <WorldProvider value={world}>
      {/* A parede atrás de tudo. É a sala, não decoração: é ela que diz que as
          luzes estão baixas antes de qualquer palavra ser lida. */}
      <HolographicWall asBackdrop />

      {/* ── no telefone, quem rola é o conteúdo, não a página ──────────────
          A barra de baixo era `fixed`, e barra `fixed` em navegador de celular
          sobe e desce durante a rolagem — é o Android recolhendo a própria
          barra de endereço, o que muda a altura da janela dezenas de vezes por
          gesto e arrasta junto tudo que está preso na borda.

          Enquanto a PÁGINA rola, isso é inevitável. Então a página para de
          rolar: a moldura ocupa a janela e não transborda, e quem rola é o
          `main` lá dentro. A barra de endereço não tem mais o que recolher, e a
          barra de baixo vira item de layout comum — que não tem em relação a
          que se mexer.

          No computador nada disso vale, e por isso a variante é do dedo e não
          um breakpoint. */}
      <div className="relative flex min-h-[calc(100dvh/var(--ui-zoom))] flex-col coarse:h-full coarse:min-h-0 coarse:overflow-hidden">
        <Marquee
          tabs={TABS}
          tab={tab}
          onTab={goTab}
          onOpenSelf={() => goPerson()}
          me={me}
          club={ctx.club}
          room={pulse}
          universe={lens}
          onUniverse={u => {
            location.hash = clubHash(slug, '', u);
          }}
          onEnterClub={slug => { location.hash = clubHash(slug, 'feed', lens); }}
          onOpenRequests={() => setSheetOpen(true)}
        />

        {/* O único que rola no telefone. `overscroll-contain` impede o gesto de
            vazar para a página de trás no fim da lista — é o que evita o "puxar
            para atualizar" do Android disparar no fim de um acervo.

            ── e o recuo do rodapé some na tela de avaliar ──────────────────
            Aquela tela termina num cartão colado no rodapé — a nota final e a
            chave de gravar, `sticky bottom-0` em Rate.tsx. Um recuo no fim de
            um ROLADOR é espaço depois do conteúdo, e um elemento colado no
            rodapé não passa por cima dele: ele assenta acima, e a página
            aparece por baixo do cartão.

            Nas outras telas o recuo é o respiro do fim da lista e fica. Aqui a
            última coisa da tela é o próprio cartão, e o fim dele é o fim. Só no
            dedo — no computador o cartão é uma coluna ao lado, presa pelo topo
            (`lg:bottom-auto`), e ali o respiro continua servindo. */}
        <main
          className={cn(
            'mx-auto w-full max-w-[1240px] flex-1 px-4 pb-20 pt-7 coarse:overflow-y-auto coarse:overscroll-contain sm:px-6 sm:pt-10',
            tab === 'rate' ? 'coarse:pb-0' : 'coarse:pb-8'
          )}
        >
          {bootError ? (
            <section>
              <h1 className="font-display text-[34px] leading-none tracking-[0.04em] text-beam">A sessão não começou</h1>
              <div className="mt-5 max-w-[60ch]">
                <Fault detail={bootError}>Não foi possível carregar os dados do Cineclube.</Fault>
                <p className="mt-4 text-[13.5px] text-ink-dim">
                  Confira se o servidor está rodando (<span className="q">node server.js</span>) e tente de novo.
                </p>
                <button
                  type="button"
                  onClick={() => void boot()}
                  className="mt-4 rounded-cell px-4 py-2.5 font-display text-[13px] uppercase tracking-[0.14em] text-ink ring-1 ring-house-rail hover:text-dye-brass hover:ring-dye-brass"
                >
                  Tentar de novo
                </button>
              </div>
            </section>
          ) : !booted ? (
            <div className="flex flex-col gap-3 py-16">
              <span className="legend animate-flicker">Acendendo o projetor</span>
            </div>
          ) : (
            <div key={tab} className="animate-frame-in">
              {tab === 'feed' && <FeedScreen />}
              {tab === 'sugestoes' && <MovieReels />}
              {tab === 'rate' && (
                <RateScreen pendingRate={pendingRate} onConsumedPending={() => setPendingRate(null)} />
              )}
              {tab === 'catalog' && <CatalogScreen />}
              {tab === 'watchlist' && <WatchlistScreen />}
              {/* Montada só enquanto a aba está aberta, de propósito: a tela
                  segura uma conexão SSE e, em modo torrent, um enxame. Nenhum
                  dos dois deve sobreviver ao interesse de assistir. */}
              {tab === 'screening' && (
                <ScreeningScreen
                  watchlist={watchlist}
                  /* A sala é uma só e pode estar tocando um episódio aberto do
                     outro lado. A ficha dele mora lá, e `id` é de uma SÉRIE —
                     mandá-lo para a tela de avaliar filme abriria outra obra. */
                  onRate={m =>
                    m.kind === 'episode'
                      ? (location.hash = clubHash(slug, `show/${m.id}`, 'series'))
                      : rateMovie(m.id)
                  }
                />
              )}
              {tab === 'reviews' && <ReviewsScreen />}
              {/* Uma tela para as duas rotas: `#people` é o endereço antigo e
                  sempre quis dizer "a minha". */}
              {(tab === 'perfil' || tab === 'people') && <ProfileScreen />}
            </div>
          )}
        </main>

        {/* A navegação, na zona do polegar. Só no dedo (`coarse:flex` mora
            dentro dela), e não na tela de avaliar: lá a nota final e a chave de
            gravar já são um cartão preso na borda de baixo, e duas barras
            disputando a faixa fariam a mais importante perder. Avaliar nem é
            destino desta barra — é aba escondida. */}
        {tab !== 'rate' ? (
          <SectionTabs variant="bar" tabs={TABS} tab={tab} onTab={goTab} room={pulse} rec={recOf(pulse)} />
        ) : null}
      </div>

      {/* Aqui e não na tela de perfil: é aberta por três lugares, e o pedido de
          entrada precisava de um deles. */}
      <SettingsSheet
        open={sheetOpen}
        focus={route.sheet ? 'clube' : undefined}
        onClose={() => {
          setSheetOpen(false);
          /* Aberta PELO endereço, fechá-la tem de tirar o endereço junto: senão
             um F5 reabre e o Voltar aponta para a folha que acabou de fechar.
             `replace` porque abrir e fechar folha não é lugar de voltar. */
          if (route.sheet) {
            history.replaceState(null, '', '#' + clubHash(slug, 'feed', lens));
            /* `replaceState` não dispara `hashchange`, e são dois ouvintes dele
               — o desta tela e o do app — que mantêm a rota viva. Sem o evento,
               os dois continuariam achando que a folha está aberta. */
            window.dispatchEvent(new HashChangeEvent('hashchange'));
          }
        }}
      />

      <ProjectionSheet
        movieId={sheetId}
        clubAvg={sheetId != null ? averages[sheetId]?.avg : undefined}
        clubCount={sheetId != null ? averages[sheetId]?.count : undefined}
        inWatchlist={sheetId != null ? inWatchlist(sheetId) : false}
        onClose={() => setSheetId(null)}
        onRate={rateMovie}
        onToggleWatch={m => void toggleWatch(m)}
      />

      {toast ? (
        <div className="fixed inset-x-0 bottom-4 z-50 mx-auto w-fit max-w-[92vw] px-4">
          <Fault>{toast}</Fault>
        </div>
      ) : null}
    </WorldProvider>
    </ClubContext.Provider>
  );
}

/* ── a lâmpada de gravação ────────────────────────────────────────────────
   Nunca é uma superfície: vermelho cheio nesta sala é a chave de gravar, uma
   por tela, e um retângulo vermelho no alto de TODA tela competiria com ela.
   Passa a luz, e a palavra Sessão em vermelho como texto.

   E não empurra nada: aparecer do nada jogaria Avaliados, o sino e os rostos
   para a direita de um quadro para o outro. Está sempre montada e ABRE, de zero
   à largura dela.

   Respira com o filme rodando e fica parada em pausa: duas informações pelo
   preço de nenhuma pergunta a mais. */
function Lamp({
  on,
  playing,
  className,
}: {
  on: boolean;
  playing: boolean;
  /* A margem à direita serve à marquise, onde a lâmpada vem ANTES da palavra na
     mesma linha; na barra ela fica acima e centrada, e a margem a tiraria do
     meio. Vem por fora porque quem sabe disso é quem monta a fileira. */
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'block h-1.5 flex-none rounded-full bg-dye-red-lit transition-[width,margin,opacity] duration-[420ms] ease-beam',
        on ? 'mr-2 w-1.5 opacity-100 shadow-[0_0_10px_rgba(242,86,74,0.85)]' : 'mr-0 w-0 opacity-0',
        /* O brilho está na classe acima e não só no laço: sob
           `prefers-reduced-motion` o index.css corta o laço em uma volta, e o
           repouso depois dela tem de ser a lâmpada acesa. */
        on && playing && 'animate-lamp',
        className
      )}
    />
  );
}

/* ── as cinco seções, em dois lugares ─────────────────────────────────────
   No computador na marquise; no telefone numa barra no rodapé, onde o polegar
   já está. Um componente só: escrever a fileira duas vezes seria manter duas
   verdades sobre quais seções existem e qual está acesa.

   As duas são montadas e uma fica em `display: none` conforme o ponteiro —
   isso tira a escondida da árvore de acessibilidade, então não há duas paradas
   de tabulação para a mesma seção.

   O traço vermelho troca de lado: nos dois casos é a borda voltada PARA O
   CONTEÚDO, e mantê-lo embaixo na barra o encostaria na borda da tela. */

/* Um ponto vermelho sozinho diz "alguma coisa"; o clube quer saber o quê antes
   de trocar de seção. Vai no `title` e no `aria-label` — este substitui a
   palavra "Sessão" na leitura, então carrega ela também. Fora dos componentes
   porque a barra e a marquise não podem contar a mesma sessão diferente. */
function recOf(room: ScreeningPulse) {
  if (!room.open) return null;
  return [
    room.status === 'playing' ? 'ao vivo' : 'em pausa',
    room.title,
    room.viewers ? plural(room.viewers, 'pessoa na sala', 'pessoas na sala') : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A ordem da barra do dedo, por decisão do dono. A marquise segue a tabela. */
export const BAR_ORDER: readonly TabId[] = ['screening', 'catalog', 'feed', 'watchlist', 'reviews'];

function SectionTabs({
  variant,
  tabs,
  tab,
  onTab,
  room,
  rec,
}: {
  variant: 'marquee' | 'bar';
  /** A tabela da lente. Ver `tabsFor`. */
  tabs: readonly { id: TabId; label: string; hidden?: boolean }[];
  tab: TabId;
  onTab: (t: TabId) => void;
  room: ScreeningPulse;
  /** O que a sala está fazendo, em palavras, para o `title` e o rótulo. */
  rec: string | null;
}) {
  const bar = variant === 'bar';
  /* A tabela lá em cima continua sendo a verdade sobre QUAIS seções existem e
     sobre a ordem da marquise; `BAR_ORDER` diz só em que ordem a barra do dedo
     as desenha. O que não está nomeado lá vai para o fim em vez de sumir — uma
     seção nova não pode desaparecer do telefone por esquecimento. */
  const shown = tabs.filter(t => !t.hidden);
  const items = bar
    ? [
        ...BAR_ORDER.flatMap(id => shown.filter(t => t.id === id)),
        ...shown.filter(t => !BAR_ORDER.includes(t.id)),
      ]
    : shown;
  return (
    <nav
      aria-label="Seções"
      className={cn(
        bar
          ? /* No FLUXO, e não `fixed`: presa era o que a fazia subir e descer
               com a barra de endereço do Android.

               E sem recuo de área segura: `env(safe-area-inset-bottom)` devolve
               o que `viewport-fit=cover` toma, e sem `cover` o navegador nunca
               tomou. Os dois são um par — se um dia isto for de ponta a ponta,
               o recuo volta junto com o `cover`. */
            'z-30 hidden flex-none border-t border-white/[0.07] bg-house/95 coarse:flex'
          : '-mx-1 flex min-w-0 max-w-full gap-1 overflow-x-auto px-1 [scrollbar-width:none] coarse:hidden [&::-webkit-scrollbar]:hidden'
      )}
    >
      {items.map(t => {
        const on = tab === t.id;
        /* A lâmpada é da Sessão e de mais nada: é a única aba que corresponde a
           um cômodo em vez de a uma prateleira. */
        const lit = t.id === 'screening' && room.open;
        return (
          <button
            key={t.id}
            type="button"
            aria-current={on ? 'page' : undefined}
            aria-label={rec && t.id === 'screening' ? `Sessão — ${rec}` : undefined}
            title={rec && t.id === 'screening' ? rec[0].toUpperCase() + rec.slice(1) : undefined}
            onClick={() => onTab(t.id)}
            className={cn(
              'relative flex items-center font-display uppercase leading-none transition-colors duration-150',
              bar
                ? /* Cinco colunas iguais, um alvo por seção. Quarenta e oito e
                     não os cinquenta e seis de uma barra do Android: aquela
                     medida pressupõe um ícone acima da palavra, e esta é só
                     palavra. Ainda passa do piso de toque. */
                  'min-h-[48px] flex-1 flex-col justify-center gap-1 px-1 text-[11px] tracking-[0.1em]'
                : 'flex-none rounded-cell px-3 py-2 text-[14px] tracking-[0.12em]',
              /* Acesa, a palavra vira vermelha — nunca por cima do creme da aba
                 atual: estar aberto e estar acontecendo são informações
                 diferentes, e a barra mostra as duas. Vermelho como TEXTO, que
                 a superfície vermelha é da chave de gravar. */
              on
                ? 'text-beam'
                : lit
                  ? 'text-dye-red-lit hover:text-dye-red-glow'
                  : 'text-ink-dim hover:text-ink'
            )}
          >
            {/* Na marquise a lâmpada vem antes da palavra e colapsa para largura
                zero quando apagada. Na barra ela fica ACIMA, e aí só a Sessão
                tinha o elemento: a palavra dela descia doze pixels em relação às
                outras quatro. Então a fatia existe em TODAS e só uma a preenche
                — vazia mede seis pixels e não desenha nada. */}
            {bar ? (
              <span aria-hidden className="flex h-1.5 items-center justify-center">
                {t.id === 'screening' ? (
                  <Lamp on={lit} playing={room.status === 'playing'} className="mr-0" />
                ) : null}
              </span>
            ) : t.id === 'screening' ? (
              <Lamp on={lit} playing={room.status === 'playing'} />
            ) : null}
            {t.label}
            {/* Na marquise o traço começa depois da lâmpada, e abre junto com
                ela na mesma curva: um sublinhado atravessando o ponto vermelho
                reclamaria a lâmpada para si. */}
            <span
              className={cn(
                'absolute h-[2px] transition-[opacity,left] [transition-duration:150ms,420ms] ease-beam',
                bar
                  ? 'inset-x-0 top-0'
                  : cn('-bottom-[1px] right-2', lit ? 'left-[22px]' : 'left-2'),
                on ? 'bg-dye-red opacity-100' : 'opacity-0'
              )}
            />
          </button>
        );
      })}
    </nav>
  );
}

/* O cabeçalho de um cinema é a marquise: o nome em luzes e o que está passando.
   A seção atual é a acesa. */
function Marquee({
  tabs,
  tab,
  onTab,
  onOpenSelf,
  me,
  club,
  room,
  universe,
  onUniverse,
  onEnterClub,
  onOpenRequests,
}: {
  tabs: readonly { id: TabId; label: string; hidden?: boolean }[];
  tab: TabId;
  onTab: (t: TabId) => void;
  onOpenSelf: () => void;
  me: SessionUser;
  club: ClubRow;
  /** O que a sala está fazendo. É isto que acende a lâmpada da Sessão. */
  room: ScreeningPulse;
  /** Por qual lente esta sala está sendo olhada agora. */
  universe: Universe;
  /** A outra lente, sobre o MESMO clube. Ver a nota ao lado da peça. */
  onUniverse: (u: Universe) => void;
  /** Trocar de sala, guardando a lente: um clube é um clube nos dois universos. */
  onEnterClub: (slug: string) => void;
  onOpenRequests: () => void;
}) {
  const rec = recOf(room);

  return (
    /* Sem `backdrop-blur`: ele fica sobre a parede, e a parede nunca para de se
       mexer — o navegador reborrava uma faixa de fundo vivo em todo quadro, em
       todo aparelho. Uma barra mais opaca lê quase igual e custa zero. */
    <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-house/95">
      {/* ── UMA LINHA, sempre ────────────────────────────────────────────
          Era `flex-wrap`, e num telefone o sino e o retrato caíam para uma
          segunda linha: a marquise dobrava de altura, e o bloco de ações ficava
          pendurado embaixo do nome da sala sem nada explicando por quê. Uma
          barra de topo que muda de altura conforme o comprimento do nome do
          clube não é uma barra — é um parágrafo.

          Quem cede espaço é o NOME: ele trunca, e truncado ainda diz em que
          sala você está. O bloco de ações não cede nada — são alvos de toque, e
          um alvo que encolhe deixa de ser alvo. */}
      <div className="mx-auto flex max-w-[1240px] items-center gap-x-2 px-4 py-3 sm:gap-x-6 sm:px-6">
        {/* O nome DA SALA e não o do produto: quem está em três clubes precisa
            saber em qual está antes de ler o resto da tela. A foto vem junto
            quando existe — é o que torna a troca reconhecível sem ler.

            E é ele que abre a lista de salas, porque é o lugar onde já se olha
            para saber em qual se está. */}
        <div className="mr-auto flex min-w-0 shrink items-center gap-x-1 sm:gap-x-3">
          <ClubSwitch club={club} onEnter={onEnterClub} />
          {/* ── a lente ─────────────────────────────────────────────────────
              Um clube é um clube nos dois universos — mesma gente, mesmo ADM —,
              então a troca guarda o clube e muda só o que se olha dentro dele.

              Ao lado do nome da sala: a lente é mais externa que a seção, e
              ficar junto das abas a faria ler como uma sexta aba. */}
          <Lens on={universe} onPick={onUniverse} />
        </div>
        <SectionTabs variant="marquee" tabs={tabs} tab={tab} onTab={onTab} room={room} rec={rec} />

        {/* `relative` porque o painel do sino se pendura AQUI, e não no sino:
            depois dele ainda vem o retrato, e alinhar o painel pela direita do
            sino o jogava para fora da tela num telefone. Ver `Notices`. */}
        <div className="relative flex flex-none items-center gap-1 sm:gap-2">
          {/* Quem está batendo na porta: só para quem pode abrir, e só quando há
              alguém. O pedido vivia numa lista atrás de perfil, engrenagem e
              Ajustes, sem nada anunciando que estava lá. Latão e não vermelho,
              pela mesma regra do sino: ter pedido pendente é um estado, e o
              vermelho aqui é da gravação. */}
          {club.role === 'admin' && (club.pending ?? 0) > 0 ? (
            <button
              type="button"
              onClick={onOpenRequests}
              title={plural(club.pending ?? 0, 'pessoa pedindo para entrar', 'pessoas pedindo para entrar')}
              aria-label={plural(club.pending ?? 0, 'pessoa pedindo para entrar', 'pessoas pedindo para entrar')}
              className="relative flex h-[30px] items-center gap-1.5 rounded-cell px-2 text-dye-brass transition-colors hover:text-beam"
            >
              <UserPlus className="h-[17px] w-[17px]" strokeWidth={1.8} />
              <span className="q text-[12px] font-semibold leading-none">{club.pending}</span>
            </button>
          ) : null}
          {/* Sem props: o sino é da rede, junta todas as salas da pessoa e
              carrega o clube em cada linha, então sabe sozinho para onde levar. */}
          <Notices />
          <button
            type="button"
            onClick={onOpenSelf}
            title={me.isAdmin ? 'Administrador do clube' : 'Meu perfil'}
            aria-label={`${me.name} — abrir meu perfil`}
            className="flex items-center gap-2 rounded-cell px-1 py-1 transition-colors hover:[&>span]:text-ink"
          >
            <Reel color={reelColor(me.dot, me.id)} src={me.avatar} size="lg">
              {initialsOf(me.name)}
            </Reel>
            <span className="hidden text-[13px] text-ink-dim transition-colors sm:inline">{me.name}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
