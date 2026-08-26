import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { HolographicWall } from '@/components/ui/holographic-wall-shadcnui';
import { ProjectionSheet } from '@/components/film';
import { Fault } from '@/components/bits';
import {
  api,
  auth,
  del,
  initialsOf,
  post,
  reelColor,
  social,
  type Criterion,
  type CriterionVote,
  type Movie,
  type Reviewer,
  type Review,
  type ReviewComment,
  type SessionUser,
  type WatchItem,
} from '@/lib/api';
import { Reel } from '@/components/bits';
import { SignIn } from '@/screens/SignIn';
import { cn } from '@/lib/utils';
import { RateScreen } from '@/screens/Rate';
import { CatalogScreen, WatchlistScreen } from '@/screens/Catalog';
import { ReviewsScreen } from '@/screens/Reviews';
import { PeopleScreen } from '@/screens/People';
import { ScreeningScreen } from '@/screens/Screening';

export const TABS = [
  { id: 'rate', label: 'Avaliar' },
  { id: 'catalog', label: 'Catálogo' },
  { id: 'watchlist', label: 'Quero ver' },
  /* Between the queue and the reviews, because that is where it falls in an
     evening: you pick the film, you watch it, you rate it. */
  { id: 'screening', label: 'Sessão' },
  { id: 'reviews', label: 'Avaliados' },
  { id: 'people', label: 'Avaliadores' },
] as const;
export type TabId = (typeof TABS)[number]['id'];

type Club = {
  /** Who is signed in. The session is the authority on this, not the client. */
  me: SessionUser;
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
  votes: CriterionVote[];
  /** Escreve, e devolve o comentário gravado — a lista já se atualizou. */
  comment: (reviewId: string, body: string) => Promise<void>;
  uncomment: (id: string) => Promise<void>;
  /** +1, −1, ou 0 para tirar. Pressionar o voto que já está posto tira ele. */
  voteOn: (reviewId: string, key: string, value: 1 | -1 | 0) => Promise<void>;
  reload: (patch: Partial<Pick<Club, 'reviewers' | 'reviews' | 'watchlist'>>) => void;
  criteriaFor: (genre: string) => Criterion[];
  averages: Record<number, { avg: number; count: number }>;
  inWatchlist: (id: number) => boolean;
  toggleWatch: (m: Movie | WatchItem) => Promise<void>;
  goTab: (t: TabId) => void;
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

function tabFromHash(): TabId | null {
  const h = (location.hash || '').replace(/^#/, '');
  return (TABS as readonly { id: string }[]).some(t => t.id === h) ? (h as TabId) : null;
}

export default function App() {
  /* The catalogue is where the room opens. Rating is what you do about a film
     you have already picked, so it is the second step, not the front door — and
     a link shared with a section in it still wins over the default. */
  const [tab, setTab] = useState<TabId>(() => tabFromHash() ?? 'catalog');
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [watchlist, setWatchlist] = useState<WatchItem[]>([]);
  const [criteria, setCriteria] = useState<Record<string, Criterion[]>>({});
  const [genres, setGenres] = useState<string[]>([]);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [votes, setVotes] = useState<CriterionVote[]>([]);
  const [booted, setBooted] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [me, setMe] = useState<SessionUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [sheetId, setSheetId] = useState<number | null>(null);
  const [pendingRate, setPendingRate] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  /* The session decides whether the app renders at all, so it is asked first
     and separately: a signed-out visitor should reach the sign-in screen
     without waiting on the catalog. */
  const checkAuth = useCallback(async () => {
    try {
      const res = await auth.me();
      setMe(res.reviewer);
    } catch {
      setMe(null);
    } finally {
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  const boot = useCallback(async () => {
    setBootError(null);
    try {
      const [rv, rs, cr, wl, sc] = await Promise.all([
        api<{ reviewers: Reviewer[] }>('/api/reviewers'),
        api<{ reviews: Review[] }>('/api/reviews'),
        api<{ genres: string[]; criteria: Record<string, Criterion[]> }>('/api/catalog/criteria-all'),
        api<{ watchlist: WatchItem[] }>('/api/watchlist'),
        social.all(),
      ]);
      setReviewers(rv.reviewers);
      setReviews(rs.reviews);
      setCriteria(cr.criteria);
      setGenres(cr.genres);
      setWatchlist(wl.watchlist);
      setComments(sc.comments);
      setVotes(sc.votes);
      setBooted(true);
    } catch (e) {
      setBootError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (me) void boot();
  }, [me, boot]);

  const signOut = useCallback(async () => {
    try {
      await auth.logout();
    } catch {
      /* the cookie is gone either way; falling through logs the browser out */
    }
    setMe(null);
    setBooted(false);
  }, []);

  const refreshReviewers = useCallback(async () => {
    const rv = await api<{ reviewers: Reviewer[] }>('/api/reviewers');
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
      const t = tabFromHash();
      if (t) setTab(t);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const goTab = useCallback((t: TabId) => {
    setTab(t);
    if (tabFromHash() !== t) location.hash = t;
  }, []);

  const fault = useCallback((msg: string) => {
    // A 24h session ends quietly mid-use; drop to the sign-in screen instead of
    // showing an error the visitor cannot act on.
    if (/Entre com seu PIN/i.test(msg)) {
      setMe(null);
      setBooted(false);
      return;
    }
    setToast(msg);
    window.setTimeout(() => setToast(null), 6000);
  }, []);

  /* A string, não o objeto: quem está logado é redolhado a cada refreshMe, e um
     callback que depende do objeto inteiro se recria à toa. */
  const meId = me?.id ?? null;

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

  const toggleWatch = useCallback(
    async (m: Movie | WatchItem) => {
      const has = watchRef.current.some(w => String(w.id) === String(m.id));
      try {
        if (has) {
          await del(`/api/watchlist/${m.id}`);
          setWatchlist(list => list.filter(w => String(w.id) !== String(m.id)));
        } else {
          await post('/api/watchlist', {
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
    async (reviewId: string, body: string) => {
      const saved = await social.comment(reviewId, body);
      setComments(prev => [...prev, saved]);
    },
    []
  );

  const uncomment = useCallback(async (id: string) => {
    await social.uncomment(id);
    setComments(prev => prev.filter(c => c.id !== id));
  }, []);

  const voteOn = useCallback(
    async (reviewId: string, key: string, value: 1 | -1 | 0) => {
      const { vote } = await social.vote(reviewId, key, value);
      setVotes(prev => {
        const rest = prev.filter(
          v => !(v.reviewId === reviewId && v.key === key && v.reviewerId === meId)
        );
        return vote ? [...rest, vote] : rest;
      });
    },
    [meId]
  );

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
  const club = useMemo<Club | null>(
    () =>
      me
        ? {
            me,
            signOut: () => void signOut(),
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
            comment,
            uncomment,
            voteOn,
            reload,
            criteriaFor,
            averages,
            inWatchlist,
            toggleWatch,
            goTab,
            openSheet: setSheetId,
            rateMovie,
            fault,
          }
        : null,
    [
      me,
      signOut,
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
      comment,
      uncomment,
      voteOn,
      reload,
      criteriaFor,
      averages,
      inWatchlist,
      toggleWatch,
      goTab,
      rateMovie,
      fault,
    ]
  );

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

  if (!me || !club) return <SignIn onSignedIn={setMe} />;

  return (
    <ClubContext.Provider value={club}>
      {/* The wall behind everything. It is the room, not decoration: it is what
          tells you the lights are down before you read a single word. */}
      <HolographicWall asBackdrop />

      <div className="relative flex min-h-[calc(100dvh/var(--ui-zoom))] flex-col">
        <Marquee tab={tab} onTab={goTab} me={me} onSignOut={() => void signOut()} />

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
              {tab === 'people' && <PeopleScreen />}
            </div>
          )}
        </main>
      </div>

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

/* ── the marquee ──────────────────────────────────────────────────────────
   The header of a cinema is its marquee: the name in lights and what is
   playing. The current section is the lit one. */
function Marquee({
  tab,
  onTab,
  me,
  onSignOut,
}: {
  tab: TabId;
  onTab: (t: TabId) => void;
  me: SessionUser;
  onSignOut: () => void;
}) {
  return (
    /* No backdrop blur. It sat over the wall, and the wall never stops moving —
       so the browser was re-blurring a full-width strip of a live background on
       every single frame, on every device, whether or not anyone was scrolling.
       A more opaque bar reads almost the same and costs nothing. */
    <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-house/95">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        {/* The marquee is the way home, and home is the catalogue. */}
        <a href="#catalog" className="mr-auto flex items-baseline no-underline">
          <span className="font-display text-[26px] leading-none tracking-[0.14em] text-beam">CINECLUBE</span>
        </a>
        <nav aria-label="Seções" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map(t => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                aria-current={on ? 'page' : undefined}
                onClick={() => onTab(t.id)}
                className={cn(
                  'relative flex-none rounded-cell px-3 py-2 font-display text-[14px] uppercase leading-none tracking-[0.12em] transition-colors duration-150',
                  on ? 'text-beam' : 'text-ink-dim hover:text-ink'
                )}
              >
                {t.label}
                <span
                  className={cn(
                    'absolute inset-x-2 -bottom-[1px] h-[2px] transition-opacity duration-150',
                    on ? 'bg-dye-red opacity-100' : 'opacity-0'
                  )}
                />
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          {/* Your own face is the door to the room of faces. */}
          <button
            type="button"
            onClick={() => onTab('people')}
            title={me.isAdmin ? 'Administrador do clube' : 'Ver avaliadores'}
            aria-label={`${me.name} — ver avaliadores`}
            className="flex items-center gap-2 rounded-cell px-1 py-1 transition-colors hover:[&>span]:text-ink"
          >
            <Reel color={reelColor(me.dot, me.id)} src={me.avatar} size="lg">
              {initialsOf(me.name)}
            </Reel>
            <span className="hidden text-[13px] text-ink-dim transition-colors sm:inline">{me.name}</span>
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-cell px-2 py-1.5 font-display text-[12px] uppercase tracking-[0.12em] text-ink-dim transition-colors hover:text-dye-red-lit"
          >
            Sair
          </button>
        </div>
      </div>
    </header>
  );
}
