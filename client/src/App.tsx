import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { HolographicWall } from '@/components/ui/holographic-wall-shadcnui';
import { ProjectionSheet } from '@/components/film';
import { Notices } from '@/components/notices';
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
import { resetLive, useLive, type LiveKind } from '@/lib/live';
import { DARK, readPulse, samePulse, type ScreeningPulse } from '@/lib/screening';
import { UserPlus } from 'lucide-react';
import { Key, Reel } from '@/components/bits';
import { AccountSheet, SettingsSheet } from '@/components/settings';
import { Lobby } from '@/screens/Lobby';
import { ClaimAccount, SetPassword, SignIn } from '@/screens/SignIn';
import { ConfirmEmail, ResetPassword } from '@/screens/EmailLink';

/** Uma conta de antes da entrada pelo Google, esperando dono. */
type Orphan = { id: string; name: string; dot: string; avatar: string | null };
import { cn, plural } from '@/lib/utils';
import { FeedScreen } from '@/screens/Feed';
import { RateScreen } from '@/screens/Rate';
import { CatalogScreen, WatchlistScreen } from '@/screens/Catalog';
import { ReviewsScreen } from '@/screens/Reviews';
import { ProfileScreen } from '@/screens/Profile';
import { ScreeningScreen } from '@/screens/Screening';

export const TABS = [
  /* Primeiro na fila e porta de entrada: um feed que não é a tela de chegada é
     um feed que ninguém lê. Para trocar a porta, mover esta entrada para baixo
     de `catalog` e mudar o `?? 'feed'` adiante. */
  { id: 'feed', label: 'Feed' },
  /* Rota, não aba: avaliar não se escolhe, escolhe-se um filme. `hidden` e não
     exclusão porque `rateMovie` escreve `#rate`, e um endereço que a tabela não
     reconhece derruba o Voltar e joga o recarregar no feed. */
  { id: 'rate', label: 'Avaliar', hidden: true },
  { id: 'catalog', label: 'Catálogo' },
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
export type TabId = (typeof TABS)[number]['id'];

type Club = {
  me: SessionUser;
  club: ClubRow;
  /** Se você administra ESTA sala — diferente de `me.isAdmin`, que é a instalação. */
  isClubAdmin: boolean;
  refreshClub: () => Promise<void>;
  /** Sair da sala. As suas fichas aqui continuam onde estão. */
  leaveClub: () => Promise<void>;
  goLobby: () => void;
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
   do sino carrega e o que sobrevive a uma regravação (o upsert casa por
   avaliador+filme e não toca na coluna `id`), então um link colado no Discord
   continua valendo depois de a pessoa ajustar a nota.

   O clube vem na frente, e não guardado na sessão, porque o endereço é feito
   para ser colado: na sessão ele significaria coisas diferentes conforme a sala
   em que o leitor estivesse. O outro motivo é mecânico e está em clubs.js —
   `EventSource` não manda cabeçalho.

   Sem `c/` na frente não há clube: é o saguão. Seção desconhecida cai no
   catálogo; id que não existe mais abre a aba e não foca nada. */
type Route = {
  club: string | null;
  tab: TabId | null;
  review: string | null;
  comment: string | null;
  person: string | null;
  /* A folha de ajustes aberta pelo endereço. Não é aba: é folha por cima da
     sala. Tem endereço porque o saguão precisa poder MANDAR alguém nela — o
     convite de emprestar o acervo à rede tem um botão "abrir os ajustes". */
  sheet: boolean;
};

const BLANK: Route = {
  club: null,
  tab: null,
  review: null,
  comment: null,
  person: null,
  sheet: false,
};

function routeFromHash(): Route {
  const raw = (location.hash || '').replace(/^#/, '');
  // O que vier depois de `?` é recado da volta do Google, não caminho.
  const clean = raw.split('?')[0];
  const parts = clean.split('/').filter(Boolean);

  if (parts[0] !== 'c' || !parts[1]) return BLANK;
  const club = decodeURIComponent(parts[1]);
  const [head, tail, deeper] = parts.slice(2);

  const tab = (TABS as readonly { id: string }[]).some(t => t.id === head) ? (head as TabId) : null;
  const review = tab === 'reviews' && tail ? decodeURIComponent(tail) : null;
  /* Um quarto segmento endereça o comentário dentro da ficha: é o que faz o
     aviso levar ao texto em vez de à carta inteira. */
  const comment = review && deeper ? decodeURIComponent(deeper) : null;
  /* De quem é o perfil. `perfil` sem id, e o antigo `people`, são o seu. */
  const person = tab === 'perfil' && tail ? decodeURIComponent(tail) : null;
  /* `ajustes` não é aba, então `tab` fica nulo e a sala abre no mural com a
     folha por cima — o mesmo que abrir os ajustes de dentro. */
  const sheet = head === 'ajustes';
  return { club, tab, review, comment, person, sheet };
}

/* `#confirmar/<token>` e `#senha/<token>`. Fora de `routeFromHash` de propósito:
   aquele resolve o que existe DENTRO de um clube, e estes dois são anteriores a
   haver clube, conta ou sessão. */
function emailRouteFromHash(): 'confirmar' | 'senha' | null {
  const head = (location.hash || '').replace(/^#/, '').split('?')[0].split('/').filter(Boolean)[0];
  return head === 'confirmar' || head === 'senha' ? head : null;
}

/** O endereço de uma seção dentro de um clube. Um lugar só que monta isto. */
const clubHash = (slug: string, rest = '') =>
  `c/${encodeURIComponent(slug)}${rest ? '/' + rest : ''}`;

/* ── o app antes de haver uma sala ────────────────────────────────────────
   Três perguntas em ordem, cada uma só fazendo sentido depois da anterior: quem
   é você, você já guardou uma segunda chave, e em que sala você está. Separado
   do `ClubApp` justamente por isso: lá embaixo dá para assumir que há clube,
   sessão e dados, sem desenhar nenhum estado de "ainda não". */
export default function App() {
  const [me, setMe] = useState<SessionUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [skippedPassword, setSkippedPassword] = useState(false);
  /* Contas de antes da entrada pelo Google que ninguém reivindicou. `null`
     enquanto não se perguntou; a lista se esvazia sozinha conforme as pessoas
     voltam, e no dia em que zerar esta tela some para sempre. */
  const [orphans, setOrphans] = useState<Orphan[] | null>(null);
  const [skippedClaim, setSkippedClaim] = useState(false);
  const [route, setRoute] = useState<Route>(() => routeFromHash());
  /* Lido junto da rota e pelo mesmo ouvinte: sair da tela de confirmação
     reescreve o endereço, e sem isto o app mostraria a tela que ele já não pede. */
  const [emailRoute, setEmailRoute] = useState(() => emailRouteFromHash());
  const [self, setSelf] = useState(false);

  /* A sessão decide se o app renderiza, então é perguntada primeiro e sozinha:
     quem está deslogado chega na tela de entrada sem esperar por catálogo. */
  const checkAuth = useCallback(async () => {
    try {
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

  /* Só depois de haver sessão, e o erro morre em silêncio: lista vazia e lista
     que não carregou levam ao mesmo lugar — seguir sem oferecer nada. */
  useEffect(() => {
    if (!me) return;
    void auth
      .claimable()
      .then(r => setOrphans(r.accounts))
      .catch(() => setOrphans([]));
  }, [me]);

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

  /* Entrar numa sala, e opcionalmente já num lugar dentro dela: o saguão põe
     fichas na tela e o clique tem de levar àquela ficha, não ao mural que a
     contém. Sem destino, a porta é o mural. */
  const enter = useCallback((slug: string, rest = 'feed') => {
    location.hash = clubHash(slug, rest);
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

  /* Antes do saguão porque é sobre a conta, não sobre uma sala — e porque logo
     depois da primeira entrada é o único momento em que "guarde uma segunda
     chave" tem contexto. Pular é permitido: obrigatório na porta é pedágio. */
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

  /* "Você já tinha conta aqui?" — depois da senha, e só quando há o que
     reivindicar. A lista só traz órfãs de um clube em que a pessoa já está (ver
     auth.js), então esta tela cai DEPOIS de o ADM ter aceitado a entrada, que é
     o que torna o PIN prova suficiente. QUANDO oferecer é decidido no servidor:
     quem já reivindicou e quem já recusou recebem lista vazia. */
  if (orphans && orphans.length > 0 && !skippedClaim) {
    return (
      <ClaimAccount
        accounts={orphans}
        onClaimed={() => {
          /* Ficha, fila e conversa mudaram de dono, e a sessão aponta para outra
             conta. Recarregar é mais honesto do que costurar isso a mão. */
          location.reload();
        }}
        onSkip={() => {
          setSkippedClaim(true);
          // Some agora na tela; o servidor garante que não volte amanhã.
          void auth.dismissClaim().catch(() => {
            /* Falhou gravar: some nesta sessão e a pergunta volta depois.
               Insistir com um erro seria punir quem disse "não sou daqui". */
          });
        }}
      />
    );
  }

  if (!route.club) {
    return (
      <>
        <Lobby
          me={me}
          onEnter={enter}
          onSignOut={() => void signOut()}
          onOpenSelf={() => setSelf(true)}
        />
        {/* Também no saguão: quem ainda não está em clube nenhum precisa poder
            trocar o próprio nome e cadastrar senha, e só está aqui. */}
        <AccountSheet open={self} onClose={() => setSelf(false)} me={me} onChanged={checkAuth} />
      </>
    );
  }

  /* `key` no slug: trocar de clube desmonta o app inteiro em vez de reaproveitar
     as telas. É o isolamento do lado de cá — nenhum estado do clube anterior
     sobrevive, porque o componente que o segurava deixou de existir. */
  return (
    <ClubApp
      key={route.club}
      slug={route.club}
      route={route}
      me={me}
      setMe={setMe}
      onSignOut={() => void signOut()}
      onLeaveClub={() => {
        location.hash = '';
      }}
    />
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
     distintivo de pedidos na marquise, um aviso do sino, e `#c/<slug>/ajustes`
     — como o saguão manda alguém direto ao interruptor de emprestar o acervo.
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
      location.hash = clubHash(got.club.slug, tab);
    }
  }, [slug, tab]);

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
      // Outro clube (ou o saguão): quem remonta é o componente de cima.
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
      const next = clubHash(slug, t);
      if ((location.hash || '').replace(/^#/, '') !== next) location.hash = next;
    },
    [slug]
  );

  /* A aba, o endereço e de quem é, de uma vez. O endereço é escrito sempre,
     inclusive já estando num perfil: ir de um perfil a outro tem de mexer no
     Voltar. `null` explícito e não ausência — chamar sem id pede o SEU perfil e
     tem de apagar quem estava aberto. A rolagem volta ao topo porque isto é
     troca de página: quem clica num nome lá embaixo cairia no meio de outra
     pessoa sem ver de quem. */
  const goPerson = useCallback(
    (reviewerId?: string | null) => {
      const id = reviewerId ?? null;
      setTab('perfil');
      setPersonId(id);
      const next = clubHash(slug, 'perfil' + (id ? `/${encodeURIComponent(id)}` : ''));
      if ((location.hash || '').replace(/^#/, '') !== next) location.hash = next;
      window.scrollTo({ top: 0, behavior: 'auto' });
    },
    [slug]
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
          (commentId ? `/${encodeURIComponent(commentId)}` : '')
      );
      if ((location.hash || '').replace(/^#/, '') !== next) location.hash = next;
    },
    [slug]
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

  const inWatchlist = useCallback((id: number) => watchlist.some(w => String(w.id) === String(id)), [watchlist]);

  /* A fila de agora, para handlers que não podem se refazer quando ela muda:
     `toggleWatch` é entregue a cada pôster do catálogo, e uma função nova a
     cada marcação é uma prop nova em todos os cem. */
  const watchRef = useRef(watchlist);
  watchRef.current = watchlist;

  /* O clube e quem sou eu, pelo mesmo motivo. */
  const rosterRef = useRef(reviewers);
  rosterRef.current = reviewers;
  const meRef = useRef(me);
  meRef.current = me;
  /** Se você administra ESTA sala. Mesmo motivo das duas acima. */
  const adminRef = useRef(false);
  adminRef.current = club?.role === 'admin';

  const toggleWatch = useCallback(
    async (m: Movie | WatchItem) => {
      const held = watchRef.current.find(w => String(w.id) === String(m.id));
      const has = !!held;
      /* Tirar é de quem pôs: a mesma regra do servidor (ver routes/watchlist.js),
         dita aqui para o marcador do catálogo não mandar um pedido que já se
         sabe recusado. Explicar antes, não decidir. Na fila a tesoura nem
         aparece nos filmes dos outros; no catálogo o marcador é um só e não tem
         a marca de quem escolheu, então quem aperta merece uma frase. */
      if (held && meRef.current) {
        const me = meRef.current;
        const owner = rosterRef.current.find(p => p.id === held.addedBy) ?? null;
        // O zelador agora é o ADM DESTA sala, e não o da instalação.
        if (owner?.id !== me.id && !adminRef.current && !me.isAdmin) {
          fault(
            owner
              ? `Só quem pôs o filme na fila pode tirar, e ${held.title} foi escolha de ${owner.name}.`
              : 'Este filme entrou na fila antes de ela registrar quem põe. Só quem administra o clube pode tirar.'
          );
          return;
        }
      }
      try {
        if (has) {
          await cdel(`/watchlist/${m.id}`);
          setWatchlist(list => list.filter(w => String(w.id) !== String(m.id)));
        } else {
          await cpost('/watchlist', {
            movie: { id: m.id, title: m.title, year: m.year, genre: m.genre, poster: m.poster },
          });
          setWatchlist(list => [
            ...list,
            { id: m.id, title: m.title, year: m.year, genre: m.genre, poster: m.poster },
          ]);
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
     catálogo só descobria abrindo a aba Sessão — e o custo é chegar dez minutos
     atrasado. Pergunta de fora e nunca assina o stream da sala: entrar nele é
     entrar na sala (o porquê está em lib/screening.ts). O erro morre em
     silêncio, como em `applyLive`: ninguém pediu esta pergunta, e uma lâmpada
     apagada é uma falha honesta. */
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

     O servidor avisa (ver live.js), e o aviso diz só QUAL coleção mudou. Buscar
     de novo em vez de aplicar um delta é a decisão inteira: há uma única forma
     de cada coleção chegar — a rota —, então a tela ao vivo não tem como
     divergir da recarregada.

     Erro morre em silêncio: ninguém pediu esta busca, ela é consequência de
     outra pessoa ter feito algo. Perde-se uma rodada; a próxima recupera. */
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
            goLobby: onLeaveClub,
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

  /* Endereço apontando para clube que não existe, ou privado de que você não é.
     A saída é o saguão e não a tela de entrada: o problema não é quem você é, é
     onde você tentou entrar. */
  if (bootError && !club) {
    return (
      <>
        <HolographicWall asBackdrop />
        <div className="relative mx-auto flex min-h-[calc(100dvh/var(--ui-zoom))] w-full max-w-[560px] flex-col justify-center px-5">
          <h1 className="font-display text-[34px] leading-none tracking-[0.04em] text-beam">
            Esta sala não abre
          </h1>
          <div className="mt-5">
            <Fault detail={bootError}>
              O clube não existe, ou é privado e você não está nele.
            </Fault>
          </div>
          <div className="mt-5">
            <Key onClick={onLeaveClub}>Voltar ao saguão</Key>
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
          tab={tab}
          onTab={goTab}
          onOpenSelf={() => goPerson()}
          me={me}
          club={ctx.club}
          room={pulse}
          onLobby={onLeaveClub}
          onOpenRequests={() => setSheetOpen(true)}
        />

        {/* O único que rola no telefone. `overscroll-contain` impede o gesto de
            vazar para a página de trás no fim da lista — é o que evita o "puxar
            para atualizar" do Android disparar no fim de um acervo. */}
        <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 pb-20 pt-7 coarse:overflow-y-auto coarse:overscroll-contain coarse:pb-8 sm:px-6 sm:pt-10">
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
              {tab === 'rate' && (
                <RateScreen pendingRate={pendingRate} onConsumedPending={() => setPendingRate(null)} />
              )}
              {tab === 'catalog' && <CatalogScreen />}
              {tab === 'watchlist' && <WatchlistScreen />}
              {/* Montada só enquanto a aba está aberta, de propósito: a tela
                  segura uma conexão SSE e, em modo torrent, um enxame. Nenhum
                  dos dois deve sobreviver ao interesse de assistir. */}
              {tab === 'screening' && <ScreeningScreen />}
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
          <SectionTabs variant="bar" tab={tab} onTab={goTab} room={pulse} rec={recOf(pulse)} />
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
            history.replaceState(null, '', '#' + clubHash(slug, 'feed'));
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
    </ClubContext.Provider>
  );
}

/* ── a lâmpada de gravação ────────────────────────────────────────────────
   O mesmo ponto de seis pixels que o produto já usa para "isto está rodando".

   Nunca é uma superfície: vermelho cheio nesta sala é a chave de gravar, uma
   por tela, e um retângulo vermelho no alto de TODA tela competiria com ela —
   o mesmo argumento que fez o distintivo do sino ser de latão. Passa a luz, e a
   palavra Sessão em vermelho como texto.

   E não empurra nada: aparecer do nada jogaria Avaliados, o sino e os rostos
   para a direita de um quadro para o outro. Está sempre montada e ABRE, de zero
   à largura dela, na curva do produto.

   Respira com o filme rodando e fica parada em pausa: duas informações pelo
   preço de nenhuma pergunta a mais, visíveis pelo canto do olho. */
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
   já está. Um componente só de propósito: escrever a fileira duas vezes seria
   manter duas verdades sobre quais seções existem e qual está acesa, e na
   terceira mexida elas divergiriam. O `variant` decide moldura e tamanho.

   As duas são montadas e uma fica em `display: none` conforme o ponteiro — isso
   tira a escondida da árvore de acessibilidade, então não há duas paradas de
   tabulação para a mesma seção.

   O traço vermelho troca de lado: embaixo da palavra em cima, em cima dela
   embaixo. Nos dois casos é a borda voltada PARA O CONTEÚDO; mantê-lo embaixo
   na barra o encostaria na borda da tela, onde não separa nada. */

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

function SectionTabs({
  variant,
  tab,
  onTab,
  room,
  rec,
}: {
  variant: 'marquee' | 'bar';
  tab: TabId;
  onTab: (t: TabId) => void;
  room: ScreeningPulse;
  /** O que a sala está fazendo, em palavras, para o `title` e o rótulo. */
  rec: string | null;
}) {
  const bar = variant === 'bar';
  return (
    <nav
      aria-label="Seções"
      className={cn(
        bar
          ? /* No FLUXO, e não `fixed`: presa era o que a fazia subir e descer
               com a barra de endereço do Android. Ver a moldura do app.

               E sem recuo de área segura. `env(safe-area-inset-bottom)` devolve
               o que `viewport-fit=cover` toma, e sem `cover` o navegador nunca
               tomou — a janela já termina onde os botões começam. Somar os dois
               engordava a barra. Os dois são um par: se um dia isto for de
               ponta a ponta, o recuo volta junto com o `cover`. */
            'z-30 hidden flex-none border-t border-white/[0.07] bg-house/95 coarse:flex'
          : '-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 [scrollbar-width:none] coarse:hidden [&::-webkit-scrollbar]:hidden'
      )}
    >
      {TABS.filter(t => !('hidden' in t && t.hidden)).map(t => {
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
                ? /* Cinco colunas iguais: um alvo por seção, com um quinto da
                     tela de largura cada. Quarenta e oito e não os cinquenta e
                     seis de uma barra do Android — aquela medida pressupõe um
                     ícone acima da palavra, e esta é só palavra. Ainda passa do
                     piso de toque. */
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
  tab,
  onTab,
  onOpenSelf,
  me,
  club,
  room,
  onLobby,
  onOpenRequests,
}: {
  tab: TabId;
  onTab: (t: TabId) => void;
  onOpenSelf: () => void;
  me: SessionUser;
  club: ClubRow;
  /** O que a sala está fazendo. É isto que acende a lâmpada da Sessão. */
  room: ScreeningPulse;
  onLobby: () => void;
  onOpenRequests: () => void;
}) {
  const rec = recOf(room);

  return (
    /* Sem `backdrop-blur`: ele fica sobre a parede, e a parede nunca para de se
       mexer — o navegador reborrava uma faixa de fundo vivo em todo quadro, em
       todo aparelho. Uma barra mais opaca lê quase igual e custa zero. */
    <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-house/95">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        {/* O nome DA SALA e não o do produto: quem está em três clubes precisa
            saber em qual está antes de ler o resto da tela. A foto vem junto
            quando existe — é o que torna a troca reconhecível sem ler. O
            conjunto é a porta de volta ao saguão. */}
        <button
          type="button"
          onClick={onLobby}
          title="Voltar ao saguão"
          className="group mr-auto flex items-center gap-2.5 rounded-cell py-1 pr-2 text-left"
        >
          {club.photo ? (
            <img
              src={club.photo}
              alt=""
              className="h-[26px] w-[26px] flex-none rounded-cell object-cover ring-1 ring-white/10"
            />
          ) : null}
          <span className="font-display text-[22px] leading-none tracking-[0.1em] text-beam transition-colors group-hover:text-beam-hot">
            {club.name}
          </span>
          {club.visibility === 'private' ? (
            <span className="legend hidden text-[9px] text-ink-faint sm:inline">Privado</span>
          ) : null}
        </button>
        <SectionTabs variant="marquee" tab={tab} onTab={onTab} room={room} rec={rec} />

        <div className="flex items-center gap-2">
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
              carrega o clube em cada linha, então sabe sozinho para onde levar.
              É o mesmo componente do saguão. */}
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
          {/* Era "Sair". Sair da conta é raro e mora nos ajustes; o que se faz o
              tempo todo é trocar de sala, então é essa a porta que fica aqui. */}
          <button
            type="button"
            onClick={onLobby}
            className="rounded-cell px-2 py-1.5 font-display text-[12px] uppercase tracking-[0.12em] text-ink-dim transition-colors hover:text-beam"
          >
            Saguão
          </button>
        </div>
      </div>
    </header>
  );
}
