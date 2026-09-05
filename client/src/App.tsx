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
  /* ── o feed abre a sala ─────────────────────────────────────────────────
     Primeiro na fila e porta de entrada, e as duas coisas andam juntas: um
     feed que não é a tela de chegada é um feed que ninguém lê. O clube avalia
     em horas diferentes, e o que ele nunca teve foi um lugar que dissesse
     "isto aconteceu enquanto você não estava".

     Isto muda a porta de entrada, que era o catálogo desde o início. A troca é
     de uma linha — mover esta entrada para baixo de `catalog` e trocar o
     `?? 'feed'` logo abaixo. */
  { id: 'feed', label: 'Feed' },
  /* ── uma rota que não é uma aba ─────────────────────────────────────────
     Avaliar não se escolhe: escolhe-se um filme, e avaliar é o que se faz com
     ele. Uma aba levava a uma tela vazia com uma busca dentro, que é pedir para
     a pessoa achar de novo um filme que ela já tinha achado.

     Sai da barra, fica na tabela. `hidden` e não uma exclusão porque a rota
     precisa continuar existindo: `rateMovie` escreve `#rate`, e um endereço que
     a tabela não reconhece derruba o botão Voltar e o recarregar de volta para
     o feed. Navegação e roteamento são duas listas que aqui coincidiam por
     acidente. */
  { id: 'rate', label: 'Avaliar', hidden: true },
  { id: 'catalog', label: 'Catálogo' },
  { id: 'watchlist', label: 'Quero ver' },
  /* Between the queue and the reviews, because that is where it falls in an
     evening: you pick the film, you watch it, you rate it. */
  { id: 'screening', label: 'Sessão' },
  { id: 'reviews', label: 'Avaliados' },
  /* ── o perfil ───────────────────────────────────────────────────────────
     Chega-se por um rosto: o seu na marquise, o de qualquer pessoa em qualquer
     lugar do app. Nunca por uma aba — uma aba "Perfil" só poderia levar ao seu,
     e o que faz disto uma rede social é justamente ele existir para todo mundo.

     `#perfil/<id>` carrega de quem é. Sem id, é o seu — que é o que o rosto na
     marquise pede e o que um `#perfil` colado sem nada significa.

     Substituiu a tela `Avaliadores`, que era um painel de formulários com o
     nome de uma seção. O que ela fazia — nome, foto, PIN, cadastrar, remover —
     mora agora na folha de ajustes, atrás da engrenagem do próprio perfil. */
  { id: 'perfil', label: 'Perfil', hidden: true },
  /* O endereço antigo, mantido roteável e nada mais. Alguém pode ter `#people`
     guardado, e um endereço que a tabela não reconhece derruba o Voltar e joga
     o recarregar no feed sem dizer por quê. Ele cai no seu próprio perfil, que
     é o cômodo para onde a porta dele sempre apontou. */
  { id: 'people', label: 'Avaliadores', hidden: true },
] as const;
export type TabId = (typeof TABS)[number]['id'];

type Club = {
  /** Who is signed in. The session is the authority on this, not the client. */
  me: SessionUser;
  /** Qual sala é esta: nome, foto, visibilidade e o seu papel nela. */
  club: ClubRow;
  /** Se você administra ESTA sala — diferente de `me.isAdmin`, que é a instalação. */
  isClubAdmin: boolean;
  /** Relê o clube depois de o ADM mexer no nome, na foto ou na visibilidade. */
  refreshClub: () => Promise<void>;
  /** Sair da sala. As suas fichas aqui continuam onde estão. */
  leaveClub: () => Promise<void>;
  /** Voltar ao saguão sem sair de nada — depois de encerrar o clube, por exemplo. */
  goLobby: () => void;
  /* Abre a folha de ajustes — conta, senha e, para o ADM, a sala e os pedidos.
     Mora no contexto porque três lugares a abrem: a engrenagem do próprio
     perfil, o distintivo de pedidos na marquise e um aviso do sino. Enquanto ela
     era estado local do perfil, um pedido de entrada não tinha como se anunciar:
     ficava numa lista atrás de dois cliques que ninguém sabia dar. */
  openClubSettings: () => void;
  signOut: () => void;
  refreshReviewers: () => Promise<void>;
  /** Re-reads the session after the person edits their own name or portrait. */
  refreshMe: () => Promise<void>;
  /** The portrait of whoever signed a take, looked up by id. */
  avatarOf: (reviewerId: string) => string | null;
  reviewers: Reviewer[];
  reviews: Review[];
  watchlist: WatchItem[];
  criteria: Record<string, Criterion[]>;
  genres: string[];
  /* ── a conversa em cima das avaliações ──────────────────────────────────
     Carregada inteira no boot, junto com o resto do clube, e não por avaliação.
     A tela de avaliados desenha o acervo todo: buscar por ficha seriam quarenta
     requisições e um estado de carregando dentro de cada gaveta. Num clube de
     quatro pessoas isto é da ordem de centenas de linhas. */
  comments: ReviewComment[];
  votes: ReviewVote[];
  commentLikes: CommentLike[];
  /* Escreve, e devolve o comentário gravado — a lista já se atualizou.
     `parentId` faz dele uma resposta; a profundidade para em um. */
  comment: (reviewId: string, body: string, parentId?: string | null) => Promise<void>;
  uncomment: (id: string) => Promise<void>;
  /** Curtir e descurtir o comentário de outra pessoa. */
  likeComment: (id: string, liked: boolean) => Promise<void>;
  /** +1, −1, ou 0 para tirar. Pressionar o voto que já está posto tira ele. */
  voteOn: (reviewId: string, value: 1 | -1 | 0) => Promise<void>;
  reload: (patch: Partial<Pick<Club, 'reviewers' | 'reviews' | 'watchlist'>>) => void;
  criteriaFor: (genre: string) => Criterion[];
  averages: Record<number, { avg: number; count: number }>;
  inWatchlist: (id: number) => boolean;
  toggleWatch: (m: Movie | WatchItem) => Promise<void>;
  goTab: (t: TabId) => void;
  /* ── abrir o perfil de alguém ───────────────────────────────────────────
     Chamado por todo rosto do app. Sem id, abre o seu.

     É esta função que transforma o produto numa rede social, e ela é de uma
     linha: o que faltava nunca foi a página, era o clube ser feito de pessoas
     clicáveis em vez de nomes desenhados. */
  goPerson: (reviewerId?: string | null) => void;
  /** De quem é o perfil aberto agora, ou null enquanto for o seu. */
  personId: string | null;
  /* Abre o acervo numa avaliação específica, e escreve o endereço dela. É o que
     o sino chama e o que "copiar link" produz. */
  goReview: (reviewId: string, commentId?: string | null) => void;
  /** Qual ficha o endereço está pedindo, ou null. */
  focusReview: string | null;
  /** Chamado pela tela quando ela já abriu e rolou até o alvo. */
  clearFocusReview: () => void;
  /** E qual comentário dentro dela, quando o aviso aponta para um texto. */
  focusComment: string | null;
  clearFocusComment: () => void;
  /* O mesmo alvo, sem a viagem. `goReview` é "vá até lá"; isto é "é este", para
     quem já vai abrir a conversa onde está — o feed abre a ficha na própria
     linha agora, e mandar a pessoa para o acervo só para acender um comentário
     seria a viagem que a abertura no lugar existe para evitar. */
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

/* ── o endereço de uma avaliação ──────────────────────────────────────────
   A seção sempre morou no hash; uma ficha dentro dela não morava em lugar
   nenhum. `#reviews/r1a2b3c` é o endereço dela.

   A chave é o id da avaliação e não o par filme+avaliador, porque é o id que o
   aviso do sino carrega e é ele que sobrevive a uma regravação — o upsert casa
   por (avaliador, filme) e não toca na coluna `id`, então um link colado no
   Discord continua valendo depois de a pessoa ajustar a própria nota.

   Uma seção desconhecida cai no catálogo, como sempre caiu; um id que não
   existe mais abre a aba e não foca nada, que é o que sobra de honesto quando
   a coisa apontada foi apagada. */
/* ── e agora o clube vem antes ────────────────────────────────────────────
   `#c/<slug>/reviews/<id>` em vez de `#reviews/<id>`. O clube na frente, e não
   guardado na sessão, porque este endereço é feito para ser colado no Discord:
   guardado na sessão, ele significaria coisas diferentes conforme a sala em que
   o leitor estivesse por acaso. O outro motivo é mecânico e está em clubs.js —
   `EventSource` não manda cabeçalho, então a sala ao vivo precisa do clube na
   URL de qualquer jeito.

   Sem `c/` na frente, não há clube: é o saguão. Um endereço antigo do tempo de
   um clube só (`#reviews/...`) cai lá também, que é o mais honesto — a ficha que
   ele aponta existe, mas quem lê o endereço não tem como saber de qual sala. */
type Route = {
  club: string | null;
  tab: TabId | null;
  review: string | null;
  comment: string | null;
  person: string | null;
  /* A folha de ajustes do clube, aberta pelo endereço. Não é uma aba e nunca
     vai ser uma: é uma folha por cima da sala. Ganhou endereço porque o saguão
     precisa poder MANDAR alguém nela — o convite de emprestar o acervo à rede
     tem um botão que diz "abrir os ajustes", e um botão que diz isso e larga a
     pessoa no mural é o botão mentindo. */
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
  /* Um quarto segmento endereça o comentário dentro da ficha, e é o que faz
     um aviso levar ao texto em vez de à carta inteira. Sem ele o sino abria a
     avaliação certa e deixava a pessoa procurando qual das respostas era a que
     ele anunciou. */
  const comment = review && deeper ? decodeURIComponent(deeper) : null;
  /* De quem é o perfil. `perfil` sem id, e o endereço antigo `people`, são o
     seu — quem escreveu qualquer um dos dois estava pedindo a própria página. */
  const person = tab === 'perfil' && tail ? decodeURIComponent(tail) : null;
  /* `ajustes` não é aba, então `tab` continua nulo e a sala abre no mural com a
     folha por cima — que é exatamente o que acontece quando se abre os ajustes
     de dentro. Fechar a folha limpa o segmento, ou o endereço continuaria
     dizendo que ela está aberta depois de ela ter sido fechada. */
  const sheet = head === 'ajustes';
  return { club, tab, review, comment, person, sheet };
}

/* ── os dois endereços que um e-mail abre ─────────────────────────────────
   `#confirmar/<token>` e `#senha/<token>`. Ficam fora de `routeFromHash` de
   propósito: aquele resolve o que existe DENTRO de um clube, e estes dois são
   anteriores a haver clube, conta ou sessão. Ler aqui é uma linha; ensinar a
   outra função a falar de um mundo que não é o dela seria emaranhar as duas. */
function emailRouteFromHash(): 'confirmar' | 'senha' | null {
  const head = (location.hash || '').replace(/^#/, '').split('?')[0].split('/').filter(Boolean)[0];
  return head === 'confirmar' || head === 'senha' ? head : null;
}

/** O endereço de uma seção dentro de um clube. Um lugar só que monta isto. */
const clubHash = (slug: string, rest = '') =>
  `c/${encodeURIComponent(slug)}${rest ? '/' + rest : ''}`;

/* ══════════════════════════════════════════════════════════════════════════
   O app, antes de haver uma sala.

   Três perguntas em ordem, e cada uma só faz sentido depois da anterior: quem é
   você, você já guardou uma segunda chave, e em que sala você está. Só depois
   das três existe um clube para o resto do produto falar sobre — e é por isso
   que este componente existe separado do de baixo: `ClubApp` pode assumir que
   tem clube, sessão e dados, e não precisa desenhar nenhum dos estados de
   "ainda não".
   ══════════════════════════════════════════════════════════════════════════ */
export default function App() {
  const [me, setMe] = useState<SessionUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [skippedPassword, setSkippedPassword] = useState(false);
  /* As contas de antes da entrada pelo Google que ninguém reivindicou. `null`
     enquanto não se perguntou; a lista se esvazia sozinha conforme as pessoas
     voltam, e no dia em que estiver vazia esta tela some para sempre. */
  const [orphans, setOrphans] = useState<Orphan[] | null>(null);
  const [skippedClaim, setSkippedClaim] = useState(false);
  const [route, setRoute] = useState<Route>(() => routeFromHash());
  /* Lido junto da rota e pelo mesmo ouvinte: sair da tela de confirmação
     reescreve o endereço, e sem isto o app continuaria mostrando a tela que o
     endereço já não pede. */
  const [emailRoute, setEmailRoute] = useState(() => emailRouteFromHash());
  /** A folha da própria conta, aberta pelo rosto na barra do saguão. */
  const [self, setSelf] = useState(false);

  /* A sessão decide se o app renderiza, então ela é perguntada primeiro e
     sozinha: quem está deslogado tem de chegar na tela de entrada sem esperar
     por catálogo nenhum. */
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

  /* Só depois de haver sessão, e o erro morre em silêncio: uma lista vazia e uma
     lista que não carregou levam ao mesmo lugar — seguir sem oferecer nada. */
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

  /* ── quem a API está falando ──────────────────────────────────────────
     Escrito ANTES de qualquer tela do clube montar, e é isso que torna seguro
     o slug morar num módulo em vez de descer por props até o botão de curtir
     (ver lib/api.ts). O cano ao vivo é fechado junto: ele é de uma sala, e uma
     conexão que sobrevive à troca continuaria trazendo — e buscando — o que
     acontece numa sala que já saiu da tela. */
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

  /* Entrar numa sala, e opcionalmente já num lugar dentro dela: o saguão põe uma
     ficha inteira na tela e o clique nela tem de levar àquela ficha, não ao
     mural do clube que a contém. Sem destino, a porta é o mural — que é onde
     alguém que só quer entrar quer chegar. */
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

  /* ── os dois endereços que chegam por e-mail ────────────────────────────
     Antes da pergunta "quem é você", e é o ponto: quem clicou num link de
     redefinição está fora justamente porque não consegue responder essa
     pergunta, e quem confirma um endereço pode estar fazendo isso no celular
     enquanto a conta está aberta no computador.

     Não são abas nem seções de clube nenhum, então não passam por
     `routeFromHash` — ele só sabe falar de endereços que começam com `c/`. */
  if (emailRoute === 'confirmar') {
    return <ConfirmEmail onDone={() => { location.hash = ''; void checkAuth(); }} />;
  }
  if (emailRoute === 'senha') {
    return <ResetPassword onSignedIn={u => { location.hash = ''; setMe(u); void checkAuth(); }} />;
  }

  if (!me) return <SignIn onSignedIn={u => { setMe(u); void checkAuth(); }} />;

  /* A senha vem antes do saguão porque é sobre a conta, não sobre uma sala — e
     porque logo depois da primeira entrada é o único momento em que a frase
     "guarde uma segunda chave" tem contexto. Pular é permitido: um seguro
     obrigatório na porta é um pedágio. */
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

  /* ── "você já tinha conta aqui?" ──────────────────────────────────────
     Depois da senha e antes de tudo o mais, e só quando há o que reivindicar. A
     lista só traz contas órfãs de um clube em que a pessoa já está (ver
     auth.js), então esta tela naturalmente aparece DEPOIS de o ADM ter aceitado
     a entrada dela — que é a ordem certa e é o que torna o PIN uma prova
     suficiente.

     QUANDO oferecer é decidido inteiramente no servidor: quem já reivindicou e
     quem já disse que não é nenhuma recebem uma lista vazia. Esta tela não tem
     opinião sobre isso, e é de propósito — a versão em que ela tinha perguntava
     a mesma coisa a todo mundo, toda vez, para sempre. */
  if (orphans && orphans.length > 0 && !skippedClaim) {
    return (
      <ClaimAccount
        accounts={orphans}
        onClaimed={() => {
          /* A ficha, a fila e a conversa mudaram de dono, e a sessão aponta para
             outra conta. Recarregar é mais honesto do que costurar isso a mão. */
          location.reload();
        }}
        onSkip={() => {
          setSkippedClaim(true);
          // Some agora na tela; o servidor garante que não volte amanhã.
          void auth.dismissClaim().catch(() => {
            /* Falhou gravar: a tela some nesta sessão e a pergunta volta depois.
               Insistir com um erro seria punir quem só disse "não sou daqui". */
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
        {/* A folha da conta também no saguão: uma pessoa que ainda não está em
            clube nenhum precisa poder trocar o próprio nome e cadastrar uma
            senha, e o único lugar em que ela está é este. */}
        <AccountSheet open={self} onClose={() => setSelf(false)} me={me} onChanged={checkAuth} />
      </>
    );
  }

  /* `key` no slug: trocar de clube desmonta o app inteiro em vez de reaproveitar
     as telas. É deliberado e é o que mantém a promessa de isolamento também do
     lado de cá — nenhum estado do clube anterior (fichas, fila, conversa, sala
     de projeção) sobrevive à troca, porque o componente que os segurava deixou
     de existir. */
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

/* ══════════════════════════════════════════════════════════════════════════
   O app dentro de uma sala.

   Isto era o app inteiro. O que mudou é que ele deixou de ser o único: agora
   recebe o clube já resolvido e pode assumir as três coisas que o componente
   acima garantiu — há sessão, há senha resolvida, e há uma sala. Toda chamada
   daqui para baixo passa por `capi`, que já sabe qual é (ver lib/api.ts).
   ══════════════════════════════════════════════════════════════════════════ */
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
  /* O feed é onde a sala abre. Era o catálogo, e o catálogo continua sendo a
     resposta para "o que a gente vê agora" — mas essa pergunta é feita uma vez
     por semana, e "o que aconteceu por aqui" é feita toda vez que alguém entra.
     Um link com uma seção dentro continua ganhando do padrão. */
  const [tab, setTab] = useState<TabId>(() => route.tab ?? 'feed');
  /** A ficha que o endereço pede, até a tela abri-la. Ver `goReview`. */
  const [focusReview, setFocusReview] = useState<string | null>(() => route.review);
  /** E o comentário dentro dela, quando o endereço vai tão fundo. */
  const [focusComment, setFocusComment] = useState<string | null>(() => route.comment);
  /* De quem é o perfil aberto. Null significa "o meu" — e não "nenhum": a tela
     resolve isso contra a sessão, que é a única que sabe quem é você. Guardar o
     seu id aqui seria gravar a resposta antes de a sessão existir. */
  const [personId, setPersonId] = useState<string | null>(() => route.person);
  /** Qual sala é esta, com a foto, a visibilidade e o seu papel nela. */
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
  /* Se a sala está com um filme rodando agora. Mora aqui e não na tela da
     sessão porque a coisa toda é justamente para quem NÃO está nela. */
  const [pulse, setPulse] = useState<ScreeningPulse>(DARK);
  /* A folha de ajustes, aberta por quatro lugares agora — a engrenagem do
     próprio perfil, o distintivo de pedidos na marquise, um aviso do sino, e o
     endereço `#c/<slug>/ajustes`, que é como o saguão manda alguém direto ao
     interruptor de emprestar o acervo à rede. Nasce aberta quando o endereço
     pede. Ver `openClubSettings` e `routeFromHash`. */
  const [sheetOpen, setSheetOpen] = useState(route.sheet);

  /* O endereço continua mandando enquanto ele existir: chegar em `ajustes`
     abre, e voltar para uma seção qualquer fecha. Sem isto, o botão de voltar
     deixaria a folha aberta sobre o mural. */
  useEffect(() => {
    if (route.sheet) setSheetOpen(true);
  }, [route.sheet]);

  const refreshClub = useCallback(async () => {
    const got = await clubsApi.get(slug);
    setClubRow(got.club);
    /* Renomear troca o endereço. Se o nome mudou nesta aba, o hash aqui aponta
       para um slug que não existe mais — e a próxima navegação cairia num 404.
       Reescrever agora é mais barato do que descobrir depois. */
    if (got.club.slug !== slug) {
      location.hash = clubHash(got.club.slug, tab);
    }
  }, [slug, tab]);

  /* ── carregar a sala ──────────────────────────────────────────────────
     O clube vem antes de tudo porque ele decide se há o que carregar: um slug
     que não existe, ou um clube privado de que você não é, respondem 404 aqui
     e a tela diz isso em vez de disparar cinco buscas que vão todas falhar. */
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

  /* Sair da sala, não da conta: as suas fichas aqui continuam onde estão, e o
     que você deixa é a lista de quem está dentro. */
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

  /* A name and a portrait live in two places at once: the roster, and the
     session that draws them in the marquee. Editing your own has to move both,
     and the session is the one the server is authoritative about. */
  const refreshMe = useCallback(async () => {
    const res = await auth.me();
    if (res.reviewer) setMe(res.reviewer);
  }, []);

  /* A review carries the name and the colour of whoever gave it, but not their
     picture — that would put a URL on every one of them for something that
     changes per person, not per review. The roster already knows. */
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
      /* Só quando há um id no endereço. Voltar para `#reviews` limpo não deve
         apagar o foco que a tela acabou de consumir, nem acender um antigo. */
      if (review) setFocusReview(review);
      if (within) setFocusComment(within);
      /* O perfil é a exceção, e ela é deliberada: aqui o id NÃO é um foco que
         se consome, é qual página está aberta. `#perfil` sem id significa "o
         meu", então o null tem de chegar — sem isto, ir do perfil de alguém
         para o seu pelo botão Voltar deixaria a pessoa anterior na tela. */
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

  /* ── ir ao perfil de alguém ─────────────────────────────────────────────
     A aba, o endereço e de quem é, de uma vez. O endereço é escrito sempre,
     inclusive já estando num perfil: é ele que a pessoa cola no Discord, e ir
     de um perfil a outro tem de mexer no Voltar.

     `null` explícito e não ausência: chamar sem id é o gesto de pedir o SEU
     perfil, e ele tem de apagar quem estava aberto antes.

     A rolagem volta ao topo porque isto é troca de página e não de aba: quem
     desce até a afinidade de alguém, clica num nome de lá e continua na mesma
     altura chega no meio de outra pessoa sem ver de quem. */
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

  /* Ir para uma ficha específica: a aba, o endereço e o alvo, de uma vez. O
     endereço é escrito mesmo quando já se está na aba, porque é ele que a
     pessoa copia — e porque recarregar tem de voltar para o mesmo lugar. */
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

  /* Consumido pela tela assim que ela abre a ficha e rola até ela. Sem isto o
     mesmo alvo voltaria a se abrir a cada redesenho, e fechar a gaveta à mão
     seria desfeito no instante seguinte. */
  const clearFocusReview = useCallback(() => setFocusReview(null), []);
  /* Limpado pela conversa, e não pela tela: só ela sabe quando já abriu o
     suficiente e rolou até o texto. */
  const clearFocusComment = useCallback(() => setFocusComment(null), []);
  /* Sem tocar na aba nem no endereço: quem chama isto já está com a conversa
     abrindo debaixo do dedo. O endereço continua sendo escrito por `goReview`,
     que é o que o sino usa e o que "copiar link" produz. */
  const aimComment = useCallback((commentId: string) => setFocusComment(commentId), []);

  const fault = useCallback(
    (msg: string) => {
      /* Uma sessão que venceu no meio do uso cai na tela de entrada em vez de
         mostrar um erro sobre o qual não há o que fazer. Trinta dias deslizantes
         tornam isto raro, mas raro não é nunca — e a frase é a que o servidor
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

  /* A string, não o objeto: quem está logado é redolhado a cada refreshMe, e um
     callback que depende do objeto inteiro se recria à toa. */
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

  /* The queue as of now, for handlers that must not be rebuilt when it changes.
     Every poster in the catalogue is handed `toggleWatch`, and a new function
     each time somebody bookmarks a film is a new prop on all hundred of them. */
  const watchRef = useRef(watchlist);
  watchRef.current = watchlist;

  /* O clube e quem sou eu, para o mesmo uso e pelo mesmo motivo que a fila logo
     acima: `toggleWatch` é entregue a cada pôster do catálogo, e uma função
     nova a cada vez que alguém entra no clube ou troca de foto é uma prop nova
     em todos os cem. */
  const rosterRef = useRef(reviewers);
  rosterRef.current = reviewers;
  const meRef = useRef(me);
  meRef.current = me;
  /** Se você administra ESTA sala. Mesmo motivo de ref das duas acima. */
  const adminRef = useRef(false);
  adminRef.current = club?.role === 'admin';

  const toggleWatch = useCallback(
    async (m: Movie | WatchItem) => {
      const held = watchRef.current.find(w => String(w.id) === String(m.id));
      const has = !!held;
      /* ── tirar é de quem pôs ─────────────────────────────────────────────
         A mesma regra que o servidor aplica (ver routes/watchlist.js), dita
         aqui para o marcador do catálogo não mandar um pedido que já se sabe
         recusado. A recusa continua sendo do servidor: isto é o produto
         explicando antes, não decidindo.

         Na fila, a tesoura nem aparece nos filmes dos outros — lá o pôster tem
         a marca de quem escolheu ao lado e o silêncio se explica sozinho. No
         catálogo o marcador é um só e ele não tem essa marca, então quem
         aperta merece uma frase. */
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

  /* ── escrever na conversa ────────────────────────────────────────────────
     A resposta do servidor é a verdade e entra na lista local, então a tela se
     atualiza sem recarregar o clube inteiro. Nada é aplicado antes da resposta:
     um comentário que aparece e some depois é pior que um que demora meio
     segundo para aparecer, e a mesma escolha vale para o voto — o contador é a
     coisa que o clube vai ler como placar, e ele não pode piscar. */
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
    // O servidor apaga as curtidas em cascata; a lista local tem de fazer o
    // mesmo, ou um contador some junto com o comentário e volta no próximo boot.
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

  /* ── a lâmpada da marquise ──────────────────────────────────────────────
     Uma sessão começava e ninguém ficava sabendo. Quem estava no catálogo,
     lendo o feed ou escrevendo uma nota não tinha como descobrir que o clube
     tinha entrado na sala a não ser abrindo a aba Sessão para ver — e o custo
     de "não estar sabendo" aqui é chegar dez minutos atrasado num filme que os
     outros três já começaram.

     Perguntar de fora, e nunca assinar o stream da sala: entrar nele é entrar
     na sala. O porquê está inteiro em lib/screening.ts.

     O erro morre em silêncio pelo mesmo motivo de `applyLive` logo abaixo:
     ninguém pediu esta pergunta. Uma lâmpada apagada é uma falha honesta —
     o pior que acontece é a pessoa abrir a aba para conferir, que é o que ela
     fazia antes de a lâmpada existir. */
  const readRoom = useCallback(async () => {
    try {
      const next = await readPulse();
      /* Só quando mudou de verdade. Isto roda a cada minuto e meio numa aba
         que fica aberta a noite inteira, e um objeto novo a cada volta
         redesenharia o app inteiro — a marquise, a tela aberta e todo pôster
         dentro dela — para concluir que a sala continua escura. */
      setPulse(prev => (samePulse(prev, next) ? prev : next));
    } catch {
      /* engolido: ver acima */
    }
  }, []);

  /* Ao vivo é o caminho rápido, não o único: o EventSource desiste depois de
     algumas recusas seguidas (ver lib/live.ts), e uma marquise que ficasse
     dizendo "ao vivo" duas horas depois de a sessão acabar seria uma mentira
     acesa no alto de toda tela. A pergunta periódica é o que garante que a
     lâmpada é verdade mesmo quando o cano cai. Um minuto e meio, o mesmo do
     sino, e parada enquanto a aba está escondida. */
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

  /* ── o clube ao vivo ────────────────────────────────────────────────────
     Tudo aqui em cima era uma fotografia tirada no boot. O clube conversa em
     horas diferentes, com a página aberta ao lado do Discord por horas, e uma
     aba aberta às oito da noite mostrava às onze exatamente o que mostrava às
     oito: o comentário que alguém escreveu no meio disso existia no banco e não
     na tela de mais ninguém até um F5.

     O servidor agora avisa (ver live.js), e o aviso diz só QUAL coleção mudou.
     Buscar de novo, e não aplicar um delta que veio junto, é a decisão de
     desenho inteira: existe uma única forma de cada coleção chegar — a rota — e
     por isso não há como a tela ao vivo divergir da tela recarregada.

     Um erro aqui morre em silêncio de propósito. Ninguém pediu esta busca; ela
     é a consequência de outra pessoa ter feito alguma coisa, e um toast
     vermelho por cima da tela de quem não pediu nada seria o produto reclamando
     de um trabalho que ele mesmo inventou. O que se perde é uma rodada, e a
     próxima — ou a pergunta periódica do sino e do feed — recupera. */
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
    /* A sala abriu, fechou, ou alguém apertou play ou pause. É o único aviso
       daqui que não é uma coleção — é um cômodo — e por isso não busca uma
       lista, busca o pulso. Ver `readRoom` acima. */
    if (kinds.has('screening')) void readRoom();
    /* E o clube em si: alguém entrou, saiu, virou ADM, ou o ADM trocou a foto.
       Duas coisas mudaram — quem está dentro e o que a sala é —, então as duas
       são relidas. */
    if (kinds.has('club')) {
      void refreshClub().catch(quiet);
      void refreshReviewers().catch(quiet);
    }
  }, [readRoom, refreshClub, refreshReviewers]);

  /* Só depois de a sala ter carregado: antes disso não há clube na URL da API
     para o cano assinar, e insistir gastaria as tentativas do fluxo à toa. */
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

  /* One object for the whole club, rebuilt only when something in it actually
     changed. It used to be a fresh object on every render of this component,
     which meant opening a film's sheet, or a toast appearing for six seconds,
     re-rendered every screen and every card that reads from it. */
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

  /* ── a sala não abriu ─────────────────────────────────────────────────
     Um endereço que aponta para um clube que não existe, ou para um privado de
     que você não é, chega aqui. A saída é o saguão e não a tela de entrada: o
     problema não é quem você é, é onde você tentou entrar. */
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
      {/* The wall behind everything. It is the room, not decoration: it is what
          tells you the lights are down before you read a single word. */}
      <HolographicWall asBackdrop />

      <div className="relative flex min-h-[calc(100dvh/var(--ui-zoom))] flex-col">
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

        <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 pb-20 pt-7 sm:px-6 sm:pt-10">
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
              {/* Mounted only while the tab is open, and that is deliberate: the
                  screen holds an SSE connection and, in torrent mode, a swarm.
                  Neither should outlive somebody's interest in watching. */}
              {tab === 'screening' && <ScreeningScreen />}
              {tab === 'reviews' && <ReviewsScreen />}
              {/* Uma tela para as duas rotas. `#people` é o endereço antigo e
                  não tem página própria: ele sempre quis dizer "a minha", e
                  agora diz isso levando ao perfil sem id. */}
              {(tab === 'perfil' || tab === 'people') && <ProfileScreen />}
            </div>
          )}
        </main>
      </div>

      {/* A folha de ajustes vive aqui e não na tela de perfil: ela é aberta por
          três lugares, e o pedido de entrada precisava de um deles. */}
      <SettingsSheet
        open={sheetOpen}
        focus={route.sheet ? 'clube' : undefined}
        onClose={() => {
          setSheetOpen(false);
          /* Se a folha foi aberta PELO endereço, fechá-la tem de tirar o
             endereço junto: senão um F5 a reabre e o botão de voltar aponta
             para a folha que a pessoa acabou de fechar. `replace` e não uma
             navegação nova, porque abrir e fechar uma folha não é um lugar
             onde alguém queira voltar. */
          if (route.sheet) {
            history.replaceState(null, '', '#' + clubHash(slug, 'feed'));
            /* `replaceState` não dispara `hashchange`, e são dois ouvintes de
               `hashchange` — o desta tela e o do app inteiro — que mantêm a
               rota viva. Sem o evento, os dois ficariam achando que a folha
               ainda está aberta enquanto o endereço já diz que não. */
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
   A marquise de um cinema diz duas coisas: o nome em luzes e o que está
   passando. A segunda faltava. Agora tem uma lâmpada, e ela é literalmente a
   mesma que o produto já usa para "isto está rodando" — o ponto de seis pixels
   com o brilho vermelho, a única coisa redonda deste sistema.

   ── por que ela nunca é uma superfície ─────────────────────────────────────
   A tentação era um distintivo vermelho preenchido escrito REC. Vermelho cheio
   nesta sala é a chave de gravar, uma por tela, e um retângulo vermelho no alto
   de TODA tela competiria com ela em todas elas — o mesmo argumento que fez o
   distintivo do sino ser de latão. O que passa é a luz: a lâmpada, e a palavra
   Sessão em vermelho como texto. A superfície continua sendo do botão.

   ── e por que ela não empurra nada ─────────────────────────────────────────
   Uma lâmpada que aparece do nada alarga a aba e joga Avaliados, o sino e o
   rosto de todo mundo para a direita de um quadro para o outro. Aqui ela está
   sempre montada e ABRE: de zero à largura dela, na curva do produto, e a barra
   se acomoda junto. O salto vira o gesto — a marquise acendendo porque a sala
   acendeu.

   Respira enquanto o filme roda e fica parada quando alguém pausou. Duas
   informações pelo preço de nenhuma pergunta a mais, e a diferença é visível
   pelo canto do olho, que é de onde esta lâmpada vai ser vista. */
function Lamp({ on, playing }: { on: boolean; playing: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'block h-1.5 flex-none rounded-full bg-dye-red-lit transition-[width,margin,opacity] duration-[420ms] ease-beam',
        on ? 'mr-2 w-1.5 opacity-100 shadow-[0_0_10px_rgba(242,86,74,0.85)]' : 'mr-0 w-0 opacity-0',
        /* O brilho também está na classe acima, e não só no laço: sob
           `prefers-reduced-motion` o index.css corta o laço em uma volta, e o
           repouso depois dela tem de ser a lâmpada acesa — não a apagada. */
        on && playing && 'animate-lamp'
      )}
    />
  );
}

/* ── the marquee ──────────────────────────────────────────────────────────
   The header of a cinema is its marquee: the name in lights and what is
   playing. The current section is the lit one. */
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
  /** O seu próprio rosto, que é a porta do seu perfil. */
  onOpenSelf: () => void;
  me: SessionUser;
  /** Em que sala você está. O nome dela substituiu o do produto na marquise. */
  club: ClubRow;
  /** O que a sala está fazendo agora. É isto que acende a lâmpada da Sessão. */
  room: ScreeningPulse;
  /** A porta de volta ao saguão. Era "Sair"; sair da conta ficou nos ajustes. */
  onLobby: () => void;
  /** Abre os ajustes do clube, onde os pedidos de entrada são respondidos. */
  onOpenRequests: () => void;
}) {
  /* ── o que a lâmpada diz quando alguém pergunta ─────────────────────────
     Um ponto vermelho na marquise sozinho diz "alguma coisa"; o clube quer
     saber O QUÊ, e quer saber antes de trocar de aba. Vai no `title` para o
     mouse e no `aria-label` para quem não vê o ponto — o `aria-label` é o que
     substitui "Sessão" na leitura, então ele carrega a palavra também. */
  const rec = room.open
    ? [
        room.status === 'playing' ? 'ao vivo' : 'em pausa',
        room.title,
        room.viewers ? plural(room.viewers, 'pessoa na sala', 'pessoas na sala') : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    /* No backdrop blur. It sat over the wall, and the wall never stops moving —
       so the browser was re-blurring a full-width strip of a live background on
       every single frame, on every device, whether or not anyone was scrolling.
       A more opaque bar reads almost the same and costs nothing. */
    <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-house/95">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        {/* ── a marquise agora diz o nome DA SALA ───────────────────────────
            E não o do produto. Uma pessoa em três clubes precisa saber em qual
            está antes de ler qualquer outra coisa da tela, e o lugar onde ela já
            olha é este. O produto se chama Cineclube em todo lugar que importa —
            o saguão, a aba do navegador, a tela de entrada.

            A foto vem junto quando existe, pequena: é o que torna a troca de
            sala reconhecível de relance, sem ler. E o conjunto é a porta de
            volta ao saguão, que é para onde um nome de lugar deve levar. */}
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
        <nav aria-label="Seções" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.filter(t => !('hidden' in t && t.hidden)).map(t => {
            const on = tab === t.id;
            /* A lâmpada é da Sessão e de mais nada. É a única aba que
               corresponde a um cômodo em vez de a uma prateleira, e a única
               em que "está acontecendo agora" é uma frase com sentido. */
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
                  'relative flex flex-none items-center rounded-cell px-3 py-2 font-display text-[14px] uppercase leading-none tracking-[0.12em] transition-colors duration-150',
                  /* Acesa, a palavra vira vermelha — mas nunca por cima do
                     creme da aba atual. Estar aberto e estar acontecendo são
                     duas informações diferentes e a marquise mostra as duas:
                     a atual continua sendo a de creme, e a lâmpada queima do
                     mesmo jeito nela. Vermelho como TEXTO, e não como
                     preenchimento: a regra da lâmpada guarda a superfície
                     vermelha para a chave de gravar. */
                  on
                    ? 'text-beam'
                    : lit
                      ? 'text-dye-red-lit hover:text-dye-red-glow'
                      : 'text-ink-dim hover:text-ink'
                )}
              >
                {t.id === 'screening' ? <Lamp on={lit} playing={room.status === 'playing'} /> : null}
                {t.label}
                {/* O traço da aba atual começa depois da lâmpada, e não debaixo
                    dela: ele sublinha a palavra, e um sublinhado que atravessa
                    o ponto vermelho é o traço reclamando a lâmpada para si. Vai
                    junto com o abrir dela, na mesma curva, para a Sessão acesa e
                    aberta ser um movimento só. */}
                <span
                  className={cn(
                    'absolute -bottom-[1px] right-2 h-[2px] transition-[opacity,left] [transition-duration:150ms,420ms] ease-beam',
                    lit ? 'left-[22px]' : 'left-2',
                    on ? 'bg-dye-red opacity-100' : 'opacity-0'
                  )}
                />
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          {/* ── quem está batendo na porta ─────────────────────────────────
              Só para quem pode abrir, e só quando há alguém. Um pedido de
              entrada vivia numa lista atrás de perfil → engrenagem → Ajustes, e
              nada em lugar nenhum dizia que ele estava lá: alguém pedia e
              esperava indefinidamente.

              Latão e não vermelho, pela mesma regra do distintivo do sino: ter
              pedido pendente é um estado, e o vermelho desta sala é da gravação
              e da lâmpada da sessão. */}
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
              carrega o clube em cada linha, então ele mesmo sabe para onde
              levar. Ele é o mesmo componente do saguão. */}
          <Notices />
          {/* O seu rosto é a porta do seu perfil — e é o mesmo gesto que abre o
              de qualquer outra pessoa em qualquer lugar do app. Levava à sala
              de formulários chamada Avaliadores; agora leva à sua página. */}
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
          {/* Era "Sair" e deslogava. Agora sair da conta é uma coisa rara que
              mora nos ajustes, e o que uma pessoa faz o tempo todo é trocar de
              sala — então é essa a porta que fica na barra. */}
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
