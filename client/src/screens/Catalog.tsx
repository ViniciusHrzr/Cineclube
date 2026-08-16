import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  useVelocity,
} from 'framer-motion';
import { GripVertical } from 'lucide-react';
import { Blank, Chip, Fault, Key, Poster, SearchField, Skeleton } from '@/components/bits';
import { Bin, FilmCell } from '@/components/film';
import { api, del, type Movie, type WatchItem } from '@/lib/api';
import { cn, norm } from '@/lib/utils';
import { useClub } from '@/App';

type Page = { items: Movie[]; page: number; totalPages: number };

export function CatalogScreen() {
  const club = useClub();
  const [sort, setSort] = useState<'popular' | 'club'>('popular');
  const [genre, setGenre] = useState('Todos');
  const [cache, setCache] = useState<Record<string, Page>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Movie[] | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<number>();

  const key = `${sort}|${genre}`;
  const entry = cache[key];
  const searchMode = query.trim().length > 0;

  /* Search goes to TMDB, not to the loaded page: the club looks for a film they
     just watched, and it is almost never on the popular list. */
  useEffect(() => {
    const q = query.trim();
    window.clearTimeout(timer.current);
    if (!q) {
      setFound(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = window.setTimeout(() => {
      api<{ results: Movie[] }>(`/api/catalog/search?q=${encodeURIComponent(q)}`)
        .then(r => setFound(r.results))
        .catch(e => {
          setFound([]);
          setError('Não foi possível buscar no TMDB: ' + (e as Error).message);
        })
        .finally(() => setSearching(false));
    }, 350);
    return () => window.clearTimeout(timer.current);
  }, [query]);

  const loadPage = useCallback(async () => {
    if (sort === 'club') return;
    setLoading(true);
    setError(null);
    const current = cache[key] ?? { items: [], page: 0, totalPages: 1 };
    try {
      const next = current.page + 1;
      const data = await api<{ results: Movie[]; page: number; totalPages: number }>(
        genre === 'Todos'
          ? `/api/catalog/popular?page=${next}`
          : `/api/catalog/discover?genre=${encodeURIComponent(genre)}&page=${next}`
      );
      setCache(c => ({
        ...c,
        [key]: { items: current.items.concat(data.results), page: data.page, totalPages: data.totalPages },
      }));
    } catch (e) {
      setError('Não foi possível falar com o TMDB agora: ' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sort, genre, key, cache]);

  useEffect(() => {
    if (sort !== 'club' && !cache[key] && !loading) void loadPage();
    // one fetch per filter combination; the cache is the guard
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sort]);

  /* The club ranking is computed from what has already been rated, so it needs
     no network at all — it is the one view that works with TMDB unreachable. */
  const clubRanked: Movie[] = (() => {
    const by: Record<number, { m: Movie; scores: number[] }> = {};
    club.reviews.forEach(r => {
      by[r.movieId] ||= {
        m: {
          id: r.movieId,
          title: r.movieTitle,
          year: r.movieYear,
          genre: r.movieGenre,
          poster: r.moviePoster,
        },
        scores: [],
      };
      by[r.movieId].scores.push(r.final);
    });
    return Object.values(by)
      .map(v => ({ ...v.m, _avg: v.scores.reduce((s, n) => s + n, 0) / v.scores.length }))
      .sort((a, b) => (b as never as { _avg: number })._avg - (a as never as { _avg: number })._avg)
      .filter(m => genre === 'Todos' || m.genre === genre);
  })();

  const browseItems = sort === 'club' ? clubRanked : entry?.items ?? [];
  const items = searchMode ? found ?? [] : browseItems;
  const firstLoad = searchMode ? searching && !found : sort === 'popular' && loading && !items.length;

  return (
    <section>
      <header className="mb-6">
        <h1 className="font-display text-[38px] leading-none tracking-[0.04em] text-beam sm:text-[46px]">Catálogo</h1>
        <p className="q mt-2 text-[12.5px] text-ink-dim">
          {firstLoad
            ? 'carregando…'
            : searchMode
            ? `${items.length} resultado(s) para “${query.trim()}”`
            : sort === 'club'
            ? `${items.length} filme(s) já avaliados pelo clube`
            : `${items.length} filme(s) · fonte TMDB`}
        </p>
      </header>

      <div className="mb-5 max-w-[440px]">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Buscar um filme no TMDB…"
          hint={searchMode ? 'buscando no acervo do TMDB, não só nesta página' : undefined}
        />
      </div>

      {/* While a search is open the browse filters would lie about what is on
          screen, so they step aside rather than sit there inert. */}
      {!searchMode ? (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <Chip on={sort === 'popular'} onClick={() => setSort('popular')}>Populares</Chip>
            <Chip on={sort === 'club'} onClick={() => setSort('club')}>Melhores do clube</Chip>
          </div>
          <div className="mb-6 flex flex-wrap gap-2">
            {['Todos', ...club.genres].map(g => (
              <Chip key={g} on={genre === g} onClick={() => setGenre(g)}>
                {g}
              </Chip>
            ))}
          </div>
        </>
      ) : null}

      {error ? <div className="mb-6"><Fault>{error}</Fault></div> : null}

      {firstLoad ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-5 sm:grid-cols-[repeat(auto-fill,minmax(178px,1fr))]">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="aspect-[2/3] w-full" />
          ))}
        </div>
      ) : items.length ? (
        <Bin>
          {items.map(m => (
            <FilmCell
              key={m.id}
              movie={m}
              avg={club.averages[m.id]?.avg}
              count={club.averages[m.id]?.count}
              inWatchlist={club.inWatchlist(m.id)}
              onOpen={() => club.openSheet(m.id)}
              onRate={() => club.rateMovie(m.id)}
              onToggleWatch={() => void club.toggleWatch(m)}
            />
          ))}
        </Bin>
      ) : !error ? (
        <Blank
          title={
            searchMode
              ? 'Nenhum filme com esse título'
              : sort === 'club'
              ? 'O clube ainda não avaliou nenhum filme'
              : 'Nenhum filme encontrado'
          }
        >
          {searchMode
            ? 'Verifique a grafia, ou tente o título original.'
            : sort === 'club'
            ? 'Assim que a primeira avaliação for gravada, o ranking do clube aparece aqui.'
            : 'Tente outro gênero.'}
        </Blank>
      ) : null}

      {!searchMode && sort === 'popular' && entry && entry.page < entry.totalPages && !error ? (
        <div className="mt-8">
          <Key tone="flush" disabled={loading} onClick={() => void loadPage()}>
            {loading ? 'Carregando…' : 'Carregar mais'}
          </Key>
        </div>
      ) : null}
    </section>
  );
}

/* The box a card occupies in the grid, in page coordinates so a scroll during
   the drag does not move the target out from under the hand. */
type Slot = { x: number; y: number; w: number; h: number };

/** A card off the wall: which one, how big it was, and where it was held. */
type Lift = { id: number; w: number; h: number; grabX: number; grabY: number };

/* The queue closing over a gap is the animation that carries the meaning, so
   it is a spring, not a duration — it settles like something with weight. */
const REFLOW = { type: 'spring', stiffness: 520, damping: 42, mass: 0.9 } as const;

export function WatchlistScreen() {
  const club = useClub();
  const [query, setQuery] = useState('');
  const [lift, setLift] = useState<Lift | null>(null);
  const [landing, setLanding] = useState(false);
  const cellRefs = useRef(new Map<number, HTMLDivElement>());
  const slots = useRef<Slot[]>([]);
  const reduce = useReducedMotion();

  /* The pointer handlers live for the whole gesture, so they cannot read the
     queue off the render that began it — that copy goes stale on the first
     reorder, and the drag starts fighting itself. This ref is the live one. */
  const order = useRef(club.watchlist);
  order.current = club.watchlist;

  /* The card is drawn on a fixed layer at these viewport coordinates. The raw
     values track the pointer exactly; the springs are what the eye follows, and
     the lag between them is the whole feeling of holding something in the air. */
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const fx = useSpring(x, { stiffness: 760, damping: 44, mass: 0.7 });
  const fy = useSpring(y, { stiffness: 760, damping: 44, mass: 0.7 });
  /* It banks into the direction it is thrown and rights itself when it stops. */
  const bank = useSpring(useTransform(useVelocity(fx), [-1600, 1600], [-10, 10]), {
    stiffness: 220,
    damping: 24,
  });

  const filtering = query.trim().length > 0;
  const shown = filtering
    ? club.watchlist.filter(w => norm(w.title).includes(norm(query.trim())))
    : club.watchlist;

  async function remove(id: number) {
    try {
      await del(`/api/watchlist/${id}`);
      club.reload({ watchlist: club.watchlist.filter(w => String(w.id) !== String(id)) });
    } catch (e) {
      club.fault('Não foi possível remover: ' + (e as Error).message);
    }
  }

  /* The new order is applied locally first so the queue answers the hand at
     once, then sent whole. If the server refuses, its copy is authoritative and
     the list snaps back — a silently divergent order would be worse than a jump. */
  async function persist(next: WatchItem[]) {
    club.reload({ watchlist: next });
    try {
      const res = await api<{ watchlist: WatchItem[] }>('/api/watchlist/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: next.map(w => w.id) }),
      });
      club.reload({ watchlist: res.watchlist });
    } catch (e) {
      club.fault('Não foi possível salvar a ordem: ' + (e as Error).message);
      const fresh = await api<{ watchlist: WatchItem[] }>('/api/watchlist');
      club.reload({ watchlist: fresh.watchlist });
    }
  }

  function moveTo(id: number, targetIndex: number) {
    const list = [...club.watchlist];
    const from = list.findIndex(w => w.id === id);
    if (from < 0) return;
    const to = Math.max(0, Math.min(list.length - 1, targetIndex));
    if (from === to) return;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    void persist(list);
  }

  /* Pointer events rather than HTML5 drag-and-drop, which does not exist on a
     touch screen at all. The grip lifts the card onto a fixed layer where it
     follows the hand, and the queue underneath closes and opens around it. */
  function beginLift(e: React.PointerEvent, id: number) {
    if (filtering || lift) return; // reordering a filtered view would reorder the wrong thing
    if (e.button !== 0) return;
    const host = cellRefs.current.get(id);
    if (!host) return;

    /* The boxes are measured once, at the lift: they do not move while a card
       is in the air, only which film sits in which box does. Measured through
       offsetLeft rather than a client rect, because a reflow still settling
       from the last drop is a transform, and a rect would report the animation
       instead of the grid — and held relative to the grid, whose own position
       is read fresh every frame. That is what makes a scroll mid-drag need no
       bookkeeping: the boxes move because the grid did. */
    const grid = host.parentElement;
    const els = order.current.map(w => cellRefs.current.get(w.id));
    if (!grid || els.some(el => !el)) return;
    const rooted = grid === host.offsetParent;
    const gx = rooted ? 0 : grid.offsetLeft;
    const gy = rooted ? 0 : grid.offsetTop;
    slots.current = els.map(el => ({
      x: el!.offsetLeft - gx,
      y: el!.offsetTop - gy,
      w: el!.offsetWidth,
      h: el!.offsetHeight,
    }));

    e.preventDefault();

    /* The page is zoomed, so a pointer's client pixels and the CSS pixels a
       style is written in are two different units. The grid reports both of its
       widths, and the ratio between them converts one to the other — read live,
       so it survives the visitor zooming the browser on top of it. Everything
       below this line is in CSS pixels, the grid's own. */
    const scale = () => {
      const r = grid.getBoundingClientRect();
      const k = grid.offsetWidth ? r.width / grid.offsetWidth : 1;
      return { k, ox: r.left / k, oy: r.top / k };
    };

    const start = scale();
    const rect = host.getBoundingClientRect();
    const cardW = rect.width / start.k;
    const cardH = rect.height / start.k;
    const grabX = (e.clientX - rect.left) / start.k;
    const grabY = (e.clientY - rect.top) / start.k;
    x.jump(rect.left / start.k);
    y.jump(rect.top / start.k);
    fx.jump(rect.left / start.k);
    fy.jump(rect.top / start.k);
    setLift({ id, w: cardW, h: cardH, grabX, grabY });

    const at = { cx: e.clientX, cy: e.clientY };
    const heldCursor = document.body.style.cursor;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    /* Nearest box to the card's own centre, not to the pointer: what the club
       is aiming with is the poster they can see, not the pixel under a finger. */
    const follow = () => {
      const { k, ox, oy } = scale();
      const left = at.cx / k - grabX;
      const top = at.cy / k - grabY;
      x.set(left);
      y.set(top);
      const cx = left + cardW / 2 - ox;
      const cy = top + cardH / 2 - oy;
      let best = 0;
      let bestD = Infinity;
      slots.current.forEach((s, i) => {
        const d = (s.x + s.w / 2 - cx) ** 2 + (s.y + s.h / 2 - cy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      const from = order.current.findIndex(w => w.id === id);
      if (from < 0 || best === from) return;
      const next = [...order.current];
      const [item] = next.splice(from, 1);
      next.splice(best, 0, item);
      order.current = next;
      club.reload({ watchlist: next });
    };

    /* A long queue runs past the fold, so the page comes to meet the card when
       it is held against an edge. */
    let frame = 0;
    const tick = () => {
      const edge = 96;
      const above = at.cy;
      const below = window.innerHeight - at.cy;
      const step = above < edge ? -(1 - above / edge) * 20 : below < edge ? (1 - below / edge) * 20 : 0;
      if (step) window.scrollBy(0, step);
      follow();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    const move = (ev: PointerEvent) => {
      at.cx = ev.clientX;
      at.cy = ev.clientY;
    };
    const drop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', drop);
      window.removeEventListener('pointercancel', drop);
      cancelAnimationFrame(frame);
      document.body.style.cursor = heldCursor;
      document.body.style.userSelect = '';

      /* The card is flown into the box it earned rather than blinked back into
         the grid, so the eye keeps hold of it the whole way down. */
      const slot = slots.current[order.current.findIndex(w => w.id === id)];
      const settle = () => {
        setLift(null);
        setLanding(false);
      };
      if (slot && !reduce) {
        setLanding(true);
        const { ox, oy } = scale();
        const spring = { type: 'spring' as const, stiffness: 560, damping: 44 };
        animate(x, ox + slot.x, spring);
        animate(y, oy + slot.y, { ...spring, onComplete: settle });
      } else {
        settle();
      }

      void persist(order.current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', drop);
  }

  const flying = lift ? club.watchlist.find(w => w.id === lift.id) : undefined;

  return (
    <section>
      <header className="mb-6">
        <h1 className="font-display text-[38px] leading-none tracking-[0.04em] text-beam sm:text-[46px]">Quero ver</h1>
        <p className="q mt-2 text-[12.5px] text-ink-dim">
          {filtering
            ? `${shown.length} de ${club.watchlist.length} filme(s)`
            : `${club.watchlist.length} filme(s) na fila do clube`}
        </p>
      </header>

      {club.watchlist.length ? (
        <div className="mb-5 max-w-[440px]">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Filtrar a fila…"
            hint={filtering ? 'a ordem só pode ser mudada com a fila inteira à vista' : 'arraste pela alça para reordenar'}
          />
        </div>
      ) : null}

      {shown.length ? (
        <div
          className={cn(
            'grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-5 sm:grid-cols-[repeat(auto-fill,minmax(178px,1fr))]',
            lift && 'select-none'
          )}
        >
          <AnimatePresence initial={false}>
            {shown.map((w, i) => {
              const air = lift?.id === w.id;
              return (
                <motion.div
                  key={w.id}
                  layout="position"
                  transition={reduce ? { duration: 0 } : REFLOW}
                  exit={{ opacity: 0, scale: 0.94 }}
                  ref={el => {
                    if (el) cellRefs.current.set(w.id, el);
                    else cellRefs.current.delete(w.id);
                  }}
                  /* Nothing in the grid answers the hand while a card is up:
                     the cells would tilt and open under a pointer that is
                     carrying something else. */
                  className={cn('relative h-full', lift && 'pointer-events-none')}
                >
                  <motion.div
                    className="h-full"
                    animate={{ opacity: air ? 0 : 1, scale: air ? 0.97 : 1 }}
                    transition={reduce ? { duration: 0 } : { duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  >
                    {!filtering ? (
                      <button
                        type="button"
                        onPointerDown={e => beginLift(e, w.id)}
                        onKeyDown={e => {
                          const idx = club.watchlist.findIndex(x => x.id === w.id);
                          if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                            e.preventDefault();
                            moveTo(w.id, idx - 1);
                          }
                          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                            e.preventDefault();
                            moveTo(w.id, idx + 1);
                          }
                        }}
                        aria-label={`Mover ${w.title}. Posição ${club.watchlist.findIndex(x => x.id === w.id) + 1} de ${club.watchlist.length}. Use as setas.`}
                        style={{ touchAction: 'none' }}
                        className="absolute left-1.5 top-1.5 z-20 cursor-grab rounded-cell bg-house-deep/85 p-1.5 text-ink-dim ring-1 ring-white/10 backdrop-blur-sm transition-colors hover:text-beam active:cursor-grabbing"
                      >
                        <GripVertical className="h-4 w-4" strokeWidth={1.8} />
                      </button>
                    ) : null}
                    <span className="q absolute right-1.5 top-1.5 z-20 rounded-cell bg-house-deep/85 px-1.5 py-0.5 text-[10px] text-ink-dim ring-1 ring-white/10">
                      {filtering ? club.watchlist.findIndex(x => x.id === w.id) + 1 : i + 1}
                    </span>
                    <FilmCell
                      movie={w as Movie}
                              onOpen={() => club.openSheet(w.id)}
                      onRate={() => club.rateMovie(w.id)}
                      onRemove={() => void remove(w.id)}
                    />
                  </motion.div>

                  {/* The frame the card came out of, left standing open so the
                      queue reads as a queue with a gap in it and not as a
                      queue one film short. */}
                  {air ? (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.18 }}
                      className="pointer-events-none absolute inset-x-0 top-0 aspect-[2/3] rounded-cell border border-dashed border-beam/25 bg-beam/[0.03]"
                    />
                  ) : null}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      ) : filtering ? (
        <Blank title="Nenhum filme na fila com esse título">Limpe o filtro para ver a fila inteira.</Blank>
      ) : (
        <Blank title="A fila está vazia">
          Marque filmes no Catálogo e eles entram aqui, prontos para a próxima sessão. Gravar uma avaliação
          tira o filme da fila automaticamente.
        </Blank>
      )}

      {/* The card in the air. It lives on the body rather than in the grid: a
          cell inside the grid is inside the 3d-card's transformed box, and a
          transformed ancestor would hold it there. */}
      {createPortal(
        <AnimatePresence>
          {lift && flying ? (
            <motion.div
              aria-hidden
              className="pointer-events-none fixed left-0 top-0 z-[60] will-change-transform"
              style={{
                x: reduce ? x : fx,
                y: reduce ? y : fy,
                width: lift.w,
                rotate: reduce ? 0 : bank,
                // it lifts around the point it was taken by, not around its middle
                transformOrigin: `${(lift.grabX / lift.w) * 100}% 8%`,
              }}
              initial={{ scale: 1, opacity: 0.85 }}
              animate={{ scale: landing || reduce ? 1 : 1.07, opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.14 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            >
              <div className="relative overflow-hidden rounded-cell ring-1 ring-beam/30 shadow-[0_34px_70px_-20px_rgba(0,0,0,0.9),0_0_60px_-18px_rgba(255,233,196,0.4)]">
                <Poster src={flying.poster} className="aspect-[2/3] w-full" />
                <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-house-deep/95 via-house-deep/10 to-transparent" />
                <span className="absolute inset-x-0 bottom-0 block truncate px-2 pb-2 font-display text-[13px] uppercase leading-tight tracking-[0.1em] text-beam">
                  {flying.title}
                </span>
                {/* the position it would take if it were let go now */}
                <span className="q absolute right-1.5 top-1.5 rounded-cell bg-house-deep/90 px-1.5 py-0.5 text-[10px] text-beam ring-1 ring-beam/30">
                  {club.watchlist.findIndex(w => w.id === lift.id) + 1}
                </span>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body
      )}
    </section>
  );
}

