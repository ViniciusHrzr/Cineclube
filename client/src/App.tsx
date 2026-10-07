import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { HolographicWall } from '@/components/ui/holographic-wall-shadcnui';
import { ProjectionSheet } from '@/components/film';
import { Notices } from '@/components/notices';
import { ClubClosed, Projecting, ClubSwitch } from '@/components/clubs';
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
import { closeOutside, onDeepLink } from '@/lib/shell';
import { neighbour, useSwipeTabs } from '@/lib/swipe';
import { SeriesArchiveScreen } from '@/screens/series/Archive';
import { SeriesCatalogScreen } from '@/screens/series/Catalog';
import { SeriesFeedScreen } from '@/screens/series/Feed';
import { SeriesQueueScreen } from '@/screens/series/Queue';
import { SeasonSheet } from '@/screens/series/Season';
import { ShowScreen } from '@/screens/series/Show';
import { resetLive, useLive, type LiveKind } from '@/lib/live';
import { usePulse, type ScreeningMovie, type ScreeningPulse } from '@/lib/screening';
import { UserPlus } from 'lucide-react';
import { Lens, Reel } from '@/components/bits';
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
  { id: 'feed', label: 'Feed' },
  { id: 'rate', label: 'Avaliar', hidden: true },
  { id: 'catalog', label: 'Catálogo' },
  { id: 'sugestoes', label: 'Sugestões', hidden: true },
  { id: 'watchlist', label: 'Quero ver' },
  { id: 'screening', label: 'Sessão' },
  { id: 'reviews', label: 'Avaliados' },
  { id: 'perfil', label: 'Perfil', hidden: true },
  { id: 'people', label: 'Avaliadores', hidden: true },
] as const;

export const SERIES_TABS = [
  { id: 'feed', label: 'Feed' },
  { id: 'catalog', label: 'Catálogo' },
  { id: 'sugestoes', label: 'Sugestões', hidden: true },
  { id: 'watchlist', label: 'Minhas séries' },
  { id: 'screening', label: 'Sessão' },
  { id: 'reviews', label: 'Avaliados' },
  { id: 'show', label: 'Série', hidden: true },
  { id: 'perfil', label: 'Perfil', hidden: true },
] as const;

export type TabId = (typeof TABS)[number]['id'] | (typeof SERIES_TABS)[number]['id'];

const tabsFor = (universe: Universe) => (universe === 'series' ? SERIES_TABS : TABS);

type Club = {
  me: SessionUser;
  club: ClubRow;
  isClubAdmin: boolean;
  refreshClub: () => Promise<void>;
  leaveClub: () => Promise<void>;
  goHome: () => void;
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
  comments: ReviewComment[];
  votes: ReviewVote[];
  commentLikes: CommentLike[];
  comment: (reviewId: string, body: string, parentId?: string | null) => Promise<void>;
  uncomment: (id: string) => Promise<void>;
  likeComment: (id: string, liked: boolean) => Promise<void>;
  voteOn: (reviewId: string, value: 1 | -1 | 0) => Promise<void>;
  reload: (patch: Partial<Pick<Club, 'reviewers' | 'reviews' | 'watchlist'>>) => void;
  criteriaFor: (genre: string) => Criterion[];
  averages: Record<number, { avg: number; count: number }>;
  inWatchlist: (id: number) => boolean;
  toggleWatch: (m: Movie | WatchItem) => Promise<void>;
  goTab: (t: TabId) => void;
  goPerson: (reviewerId?: string | null) => void;
  personId: string | null;
  goReview: (reviewId: string, commentId?: string | null) => void;
  focusReview: string | null;
  clearFocusReview: () => void;
  focusComment: string | null;
  clearFocusComment: () => void;
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

type Universe = 'filmes' | 'series';

type Route = {
  universe: Universe;
  club: string | null;
  tab: TabId | null;
  review: string | null;
  comment: string | null;
  person: string | null;
  show: number | null;
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
  const clean = raw.split('?')[0];
  const all = clean.split('/').filter(Boolean);

  const universe: Universe = all[0] === 'series' ? 'series' : 'filmes';
  const parts = universe === 'series' ? all.slice(1) : all;

  if (parts[0] !== 'c' || !parts[1]) return { ...BLANK, universe };
  const club = decodeURIComponent(parts[1]);
  const [head, tail, deeper] = parts.slice(2);

  const table = tabsFor(universe) as readonly { id: string }[];
  const tab = table.some(t => t.id === head) ? (head as TabId) : null;
  const show = tab === 'show' && tail && /^\d+$/.test(tail) ? Number(tail) : null;
  const review = tab === 'reviews' && tail ? decodeURIComponent(tail) : null;
  const comment = review && deeper ? decodeURIComponent(deeper) : null;
  const person = tab === 'perfil' && tail ? decodeURIComponent(tail) : null;
  const sheet = head === 'ajustes';
  return { universe, club, tab, review, comment, person, show, sheet };
}

function emailRouteFromHash(): 'confirmar' | 'senha' | null {
  const head = (location.hash || '').replace(/^#/, '').split('?')[0].split('/').filter(Boolean)[0];
  return head === 'confirmar' || head === 'senha' ? head : null;
}

const lensOf = (universe: Universe) => (universe === 'series' ? 'series/' : '');

const clubHash = (slug: string, rest = '', universe: Universe = 'filmes') =>
  `${lensOf(universe)}c/${encodeURIComponent(slug)}${rest ? '/' + rest : ''}`;

export default function App() {
  const [me, setMe] = useState<SessionUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [skippedPassword, setSkippedPassword] = useState(false);
  const [route, setRoute] = useState<Route>(() => routeFromHash());
  const [emailRoute, setEmailRoute] = useState(() => emailRouteFromHash());

  const checkAuth = useCallback(async () => {
    try {
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

  useEffect(() => {
    appIsReady();
  }, []);

  useEffect(
    () =>
      onDeepLink(raw => {
        let url: URL;
        try {
          url = new URL(raw);
        } catch {
          return;
        }

        if (url.protocol === 'cineclube:') {
          const code = url.searchParams.get('code');
          if (!code) return;
          void auth
            .handoff(code)
            .then(() => {
              closeOutside();
              void checkAuth();
            })
            .catch(() => {
              closeOutside();
            });
          return;
        }

        if (url.hash) location.hash = url.hash.replace(/^#/, '');
      }),
    [checkAuth]
  );

  useEffect(() => {
    const onHash = () => {
      setRoute(routeFromHash());
      setEmailRoute(emailRouteFromHash());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    setClub(route.club);
    resetLive();
  }, [route.club]);

  const signOut = useCallback(async () => {
    try {
      await auth.logout();
    } catch {
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

  if (emailRoute === 'confirmar') {
    return <ConfirmEmail onDone={() => { location.hash = ''; void checkAuth(); }} />;
  }
  if (emailRoute === 'senha') {
    return <ResetPassword onSignedIn={u => { location.hash = ''; setMe(u); void checkAuth(); }} />;
  }

  if (!me) return <SignIn onSignedIn={u => { setMe(u); void checkAuth(); }} />;

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

  if (!route.club) return <EnterFirstClub universe={route.universe} />;

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

  return (
    <ClubApp
      key={`${route.universe}/${route.club}`}
      slug={route.club}
      route={route}
      me={me}
      setMe={setMe}
      onSignOut={() => void signOut()}
      onLeaveClub={() => {
        location.hash = lensOf(route.universe);
      }}
    />
  );
}

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

function SeriesClubApp({
  slug,
  route,
  me,
  onHome,
}: {
  slug: string;
  route: Route;
  me: SessionUser;
  onHome: () => void;
}) {
  const [club, setClubRow] = useState<ClubRow | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [roster, setRoster] = useState<Reviewer[]>([]);
  const [queue, setQueue] = useState<QueuedShow[] | null>(null);
  const [takes, setTakes] = useState<ShowTake[] | null>(null);
  const [criteria, setCriteria] = useState<Record<string, Criterion[]> | null>(null);
  const [comments, setComments] = useState<TakeComment[]>([]);
  const [votes, setVotes] = useState<TakeVote[]>([]);
  const [commentLikes, setCommentLikes] = useState<CommentLike[]>([]);
  const [focusComment, setFocusComment] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>(() => route.tab ?? 'feed');
  const [showId, setShowId] = useState<number | null>(() => route.show);
  const [pulse] = usePulse(!!club);
  const [avaliando, setAvaliando] = useState<ScreeningMovie | null>(null);
  const [deServico, setDeServico] = useState(false);

  const fault = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 6000);
  }, []);

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

  const refresh = useCallback(async () => {
    try {
      const [fila, gravadas] = await Promise.all([showsApi.queue(), showsApi.takes()]);
      setQueue(fila.shows);
      setTakes(gravadas.takes);
    } catch {
    }
  }, []);

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

  useSwipeTabs(
    () => {
      const ir = neighbour(barTabs(SERIES_TABS), tab, -1);
      if (ir) goTab(ir as TabId);
    },
    () => {
      const ir = neighbour(barTabs(SERIES_TABS), tab, 1);
      if (ir) goTab(ir as TabId);
    },
    showId == null
  );

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

  if (bootError && !club) return <ClubClosed detail={bootError} onHome={onHome} />;

  if (!club) return <Projecting />;

  const doShow = showId != null ? (takes ?? []).filter(t => t.showId === showId) : [];

  return (
    <WorldProvider value={world}>
      <HolographicWall asBackdrop />
      <div className="relative flex min-h-[calc(100dvh/var(--ui-zoom))] flex-col coarse:h-full coarse:min-h-0 coarse:overflow-hidden">
        <Marquee
          tabs={SERIES_TABS}
          tab={tab}
          onTab={goTab}
          onOpenSelf={() => {
            location.hash = clubHash(slug, 'perfil', 'filmes');
          }}
          me={me}
          club={club}
          room={pulse}
          universe="series"
          onUniverse={u => {
            location.hash = clubHash(slug, '', u);
          }}
          onEnterClub={slug => { location.hash = clubHash(slug, 'feed', 'series'); }}
          onOpenRequests={() => {
            location.hash = clubHash(slug, 'ajustes', 'filmes');
          }}
        />

        <main
          className="mx-auto w-full max-w-[1240px] flex-1 px-4 pb-20 pt-7 coarse:overflow-y-auto coarse:overscroll-contain coarse:pb-8 sm:px-6 sm:pt-10"
        >
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
            ) : tab === 'screening' ? null : tab === 'sugestoes' ? (
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

          {}
          <Sessao aberta={tab === 'screening'} deServico={deServico}>
            <ScreeningScreen
              shows={queue ?? []}
              onRate={m =>
                m.kind === 'episode'
                  ?
                    setAvaliando(m)
                  :
                    (location.hash = clubHash(slug, 'screening', 'filmes'))
              }
              onSeen={() => void refresh()}
              onDuty={setDeServico}
            />
          </Sessao>
        </main>

        {deServico && tab !== 'screening' ? <NoAr onVoltar={() => goTab('screening')} /> : null}

        <SectionTabs
          variant="bar"
          tabs={SERIES_TABS}
          tab={tab}
          onTab={goTab}
          room={pulse}
          rec={recOf(pulse)}
        />
      </div>

      {}
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
  const lens = route.universe;

  const [tab, setTab] = useState<TabId>(() => route.tab ?? 'feed');
  const [focusReview, setFocusReview] = useState<string | null>(() => route.review);
  const [focusComment, setFocusComment] = useState<string | null>(() => route.comment);
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
  const [deServico, setDeServico] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pulse, readRoom] = usePulse(booted);
  const [sheetOpen, setSheetOpen] = useState(route.sheet);

  useEffect(() => {
    if (route.sheet) setSheetOpen(true);
  }, [route.sheet]);

  const refreshClub = useCallback(async () => {
    const got = await clubsApi.get(slug);
    setClubRow(got.club);
    if (got.club.slug !== slug) {
      location.hash = clubHash(got.club.slug, tab, lens);
    }
  }, [slug, tab, lens]);

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

  const refreshMe = useCallback(async () => {
    const res = await auth.me();
    if (res.reviewer) setMe(res.reviewer);
  }, []);

  const avatarOf = useCallback(
    (reviewerId: string) => reviewers.find(r => r.id === reviewerId)?.avatar ?? null,
    [reviewers]
  );

  useEffect(() => {
    const onHash = () => {
      const { club: c, tab: t, review, comment: within, person } = routeFromHash();
      if (c !== slug) return;
      if (t) setTab(t);
      if (review) setFocusReview(review);
      if (within) setFocusComment(within);
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

  useSwipeTabs(
    () => {
      const ir = neighbour(barTabs(TABS), tab, -1);
      if (ir) goTab(ir as TabId);
    },
    () => {
      const ir = neighbour(barTabs(TABS), tab, 1);
      if (ir) goTab(ir as TabId);
    }
  );

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

  const clearFocusReview = useCallback(() => setFocusReview(null), []);
  const clearFocusComment = useCallback(() => setFocusComment(null), []);
  const aimComment = useCallback((commentId: string) => setFocusComment(commentId), []);

  const fault = useCallback(
    (msg: string) => {
      if (/Entre para continuar/i.test(msg)) {
        onSignOut();
        return;
      }
      setToast(msg);
      window.setTimeout(() => setToast(null), 6000);
    },
    [onSignOut]
  );

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

  const inWatchlist = useCallback(
    (id: number) =>
      !!me && watchlist.some(w => String(w.id) === String(id) && w.wanters.includes(me.id)),
    [watchlist, me]
  );

  const watchRef = useRef(watchlist);
  watchRef.current = watchlist;

  const meRef = useRef(me);
  meRef.current = me;

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

  const applyLive = useCallback((kinds: ReadonlySet<LiveKind>) => {
    const quiet = () => {
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
    if (kinds.has('screening')) void readRoom();
    if (kinds.has('club')) {
      void refreshClub().catch(quiet);
      void refreshReviewers().catch(quiet);
    }
  }, [readRoom, refreshClub, refreshReviewers]);

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

  if (bootError && !club) return <ClubClosed detail={bootError} onHome={onLeaveClub} />;

  if (!ctx) return <Projecting />;

  return (
    <ClubContext.Provider value={ctx}>
    <WorldProvider value={world}>
      {}
      <HolographicWall asBackdrop />

      {}
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

        {}
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
              {tab === 'reviews' && <ReviewsScreen />}
              {}
              {(tab === 'perfil' || tab === 'people') && <ProfileScreen />}
            </div>
          )}

          <Sessao aberta={tab === 'screening'} deServico={deServico}>
            <ScreeningScreen
              watchlist={watchlist}
              onRate={m =>
                m.kind === 'episode'
                  ? (location.hash = clubHash(slug, `show/${m.id}`, 'series'))
                  : rateMovie(m.id)
              }
              onDuty={setDeServico}
            />
          </Sessao>
        </main>

        {deServico && tab !== 'screening' ? <NoAr onVoltar={() => goTab('screening')} /> : null}

        {}
        {tab !== 'rate' ? (
          <SectionTabs variant="bar" tabs={TABS} tab={tab} onTab={goTab} room={pulse} rec={recOf(pulse)} />
        ) : null}
      </div>

      {}
      <SettingsSheet
        open={sheetOpen}
        focus={route.sheet ? 'clube' : undefined}
        onClose={() => {
          setSheetOpen(false);
          if (route.sheet) {
            history.replaceState(null, '', '#' + clubHash(slug, 'feed', lens));
            window.dispatchEvent(new HashChangeEvent('hashchange'));
          }
        }}
      />

      <ProjectionSheet
        movieId={sheetId}
        clubAvg={sheetId != null ? averages[sheetId]?.avg : undefined}
        clubCount={sheetId != null ? averages[sheetId]?.count : undefined}
        takes={sheetId != null ? reviews.filter(r => r.movieId === sheetId) : undefined}
        inWatchlist={sheetId != null ? inWatchlist(sheetId) : false}
        onClose={() => setSheetId(null)}
        onRate={rateMovie}
        onOpenTake={id => {
          setSheetId(null);
          goReview(id);
        }}
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

function Lamp({
  on,
  playing,
  className,
}: {
  on: boolean;
  playing: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'block h-1.5 flex-none rounded-full bg-dye-red-lit transition-[width,margin,opacity] duration-[420ms] ease-beam',
        on ? 'mr-2 w-1.5 opacity-100 shadow-[0_0_10px_rgba(242,86,74,0.85)]' : 'mr-0 w-0 opacity-0',
        on && playing && 'animate-lamp',
        className
      )}
    />
  );
}

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

function Sessao({
  aberta,
  deServico,
  children,
}: {
  aberta: boolean;
  deServico: boolean;
  children: React.ReactNode;
}) {
  if (!aberta && !deServico) return null;
  return (
    <div hidden={!aberta} className={aberta ? 'animate-frame-in' : undefined}>
      {children}
    </div>
  );
}

function NoAr({ onVoltar }: { onVoltar: () => void }) {
  return (
    <button
      type="button"
      onClick={onVoltar}
      className="sticky bottom-0 z-20 flex w-full items-center gap-2.5 border-t border-dye-red-lit/30 bg-house-deep/95 px-4 py-2.5 text-left backdrop-blur-sm"
    >
      <Lamp on playing />
      <span className="font-display text-[11.5px] uppercase tracking-[0.12em] text-dye-red-lit">
        No ar
      </span>
      <span className="truncate text-[12.5px] text-ink-dim">
        você é a fonte desta sessão
      </span>
      <span className="ml-auto flex-none font-display text-[11px] uppercase tracking-[0.12em] text-ink-dim">
        Voltar
      </span>
    </button>
  );
}

export const BAR_ORDER: readonly TabId[] = ['screening', 'catalog', 'feed', 'watchlist', 'reviews'];

export function barTabs<T extends { id: TabId; hidden?: boolean }>(tabs: readonly T[]) {
  const shown = tabs.filter(t => !t.hidden);
  return [
    ...BAR_ORDER.flatMap(id => shown.filter(t => t.id === id)),
    ...shown.filter(t => !BAR_ORDER.includes(t.id)),
  ];
}

function SectionTabs({
  variant,
  tabs,
  tab,
  onTab,
  room,
  rec,
}: {
  variant: 'marquee' | 'bar';
  tabs: readonly { id: TabId; label: string; hidden?: boolean }[];
  tab: TabId;
  onTab: (t: TabId) => void;
  room: ScreeningPulse;
  rec: string | null;
}) {
  const bar = variant === 'bar';
  const items = bar ? barTabs(tabs) : tabs.filter(t => !t.hidden);
  return (
    <nav
      aria-label="Seções"
      className={cn(
        bar
          ?
            'z-30 hidden flex-none border-t border-white/[0.07] bg-house/95 coarse:flex'
          : '-mx-1 flex min-w-0 max-w-full gap-1 overflow-x-auto px-1 [scrollbar-width:none] coarse:hidden [&::-webkit-scrollbar]:hidden'
      )}
    >
      {items.map(t => {
        const on = tab === t.id;
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
                ?
                  'min-h-[48px] flex-1 flex-col justify-center gap-1 px-1 text-[11px] tracking-[0.1em]'
                : 'flex-none rounded-cell px-3 py-2 text-[14px] tracking-[0.12em]',
              on
                ? 'text-beam'
                : lit
                  ? 'text-dye-red-lit hover:text-dye-red-glow'
                  : 'text-ink-dim hover:text-ink'
            )}
          >
            {}
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
            {}
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
  room: ScreeningPulse;
  universe: Universe;
  onUniverse: (u: Universe) => void;
  onEnterClub: (slug: string) => void;
  onOpenRequests: () => void;
}) {
  const rec = recOf(room);

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-house/95">
      {}
      <div className="mx-auto flex max-w-[1240px] items-center gap-x-2 px-4 py-3 sm:gap-x-6 sm:px-6">
        {}
        <div className="mr-auto flex min-w-0 shrink items-center gap-x-1 sm:gap-x-3">
          <ClubSwitch club={club} onEnter={onEnterClub} />
          {}
          <Lens on={universe} onPick={onUniverse} />
        </div>
        <SectionTabs variant="marquee" tabs={tabs} tab={tab} onTab={onTab} room={room} rec={rec} />

        {}
        <div className="relative flex flex-none items-center gap-1 sm:gap-2">
          {}
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
          {}
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
