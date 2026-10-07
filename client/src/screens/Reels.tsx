import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Maximize2,
  Play,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { Fault, IconKey, Key, Poster, Skeleton, Strip, TrailerKey } from '@/components/bits';
import { WatchOn } from '@/components/film';
import { Breakdown } from '@/components/take';
import { Conversation, TakeVotes } from '@/components/social';
import { PersonName, PersonReel } from '@/components/person';
import {
  api,
  fmt,
  reels,
  runtimeOf,
  type ShowTake,
  type Movie,
  type ReelItem,
  type Review,
  type ShowDetail,
} from '@/lib/api';
import { cn, norm, plural, useFinePointer } from '@/lib/utils';
import { useClub, type TabId } from '@/App';

export type RatedTitle = {
  id: number;
  score: number | null;
  takes: number;
  mine: boolean;
  at: string;
};

const AHEAD = 4;

const WINDOW = 3;

const COLUMN = 0.7;

const HUD_MS = 3600;

const SEEDS = 4;

const GAP_MIN = 2;
const GAP_SPREAD = 3;

function gapOf(id: number) {
  return GAP_MIN + ((Math.imul(id, 2654435761) >>> 0) % GAP_SPREAD);
}

export function ReelsScreen({
  kind,
  rated,
  openLabel,
  onOpen,
  queued,
  onQueue,
  queueLabel,
  renderTakes,
  onExit,
}: {
  kind: ReelItem['kind'];
  rated: RatedTitle[];
  openLabel: string;
  onOpen: (item: ReelItem) => void;
  queued: (id: number) => boolean;
  onQueue: (item: ReelItem) => void;
  queueLabel: [off: string, on: string];
  renderTakes: (id: number) => React.ReactNode;
  onExit: () => void;
}) {
  const [genre, setGenre] = useState<string | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const [pinned, setPinned] = useState<ReelItem[]>([]);
  const [found, setFound] = useState<ReelItem[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [settled, setSettled] = useState(0);
  const [muted, setMuted] = useState(true);
  const [filtering, setFiltering] = useState(false);
  const [full, setFull] = useState(false);
  const [ficha, setFicha] = useState<ReelItem | null>(null);
  const [toast, setToast] = useState('');
  const [hud, setHud] = useState(true);

  const stage = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const alarm = useRef<number>();
  const hudTimer = useRef<number>();
  const atRef = useRef(0);

  const immersive = !useFinePointer();

  const pinIds = useMemo(
    () =>
      rated
        .slice()
        .sort((a, b) => b.at.localeCompare(a.at))
        .map(r => r.id)
        .join(','),
    [rated]
  );

  const scoreOf = useMemo(() => new Map(rated.map(r => [r.id, r])), [rated]);

  const seeds = useMemo(
    () =>
      rated
        .filter(r => r.score != null)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, SEEDS)
        .map(r => r.id)
        .join(','),
    [rated]
  );

  useEffect(() => {
    let alive = true;
    reels
      .genres(kind)
      .then(got => alive && setGenres(got.genres))
      .catch(() => alive && setGenres([]));
    return () => {
      alive = false;
    };
  }, [kind]);

  useEffect(() => {
    if (!pinIds) {
      setPinned([]);
      return;
    }
    let alive = true;
    reels
      .pinned(kind, pinIds.split(',').map(Number))
      .then(got => alive && setPinned(got.results))
      .catch(() => alive && setPinned([]));
    return () => {
      alive = false;
    };
  }, [kind, pinIds]);

  const load = useCallback(
    async (want: number) => {
      setLoading(true);
      try {
        const got = await reels.page(kind, genre, want, seeds ? seeds.split(',').map(Number) : []);
        setPages(got.results.length ? got.totalPages : want);
        setFound(prev => (want === 1 ? got.results : prev.concat(got.results)));
        setPage(want);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [kind, genre, seeds]
  );

  useEffect(() => {
    setFound([]);
    setActive(0);
    setSettled(0);
    atRef.current = 0;
    track.current?.scrollTo({ top: 0 });
    void load(1);
  }, [load]);

  const items = useMemo(() => {
    const mine = genre ? pinned.filter(p => p.genres.includes(genre)) : pinned;
    const seen = new Set(mine.map(p => p.id));
    const rest = found.filter(f => !seen.has(f.id));
    if (!mine.length) return rest;

    const out: ReelItem[] = [];
    let at = 0;
    mine.forEach((p, i) => {
      out.push(p);
      const gap = i === mine.length - 1 ? rest.length - at : gapOf(p.id);
      out.push(...rest.slice(at, at + gap));
      at += gap;
    });
    return out;
  }, [pinned, found, genre]);

  const here = items[active] ?? null;
  const seat = items[settled] ?? null;

  useEffect(() => {
    const box = track.current;
    if (!box) return;
    const spy = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const at = Number((e.target as HTMLElement).dataset.frame);
          atRef.current = at;
          setActive(at);
        }
      },
      { root: box, threshold: 0.6 }
    );
    for (const f of box.querySelectorAll<HTMLElement>('[data-frame]')) spy.observe(f);
    return () => spy.disconnect();
  }, [items.length]);

  useEffect(() => {
    const t = window.setTimeout(() => setSettled(active), 320);
    return () => window.clearTimeout(t);
  }, [active]);

  useEffect(() => {
    if (loading || page >= pages) return;
    if (active >= items.length - AHEAD) void load(page + 1);
  }, [active, items.length, loading, page, pages, load]);

  const jump = useCallback((delta: number) => {
    const box = track.current;
    if (!box) return;
    const frames = box.querySelectorAll<HTMLElement>('[data-frame]');
    const target = frames[Math.min(Math.max(atRef.current + delta, 0), frames.length - 1)];
    if (target) box.scrollTo({ top: target.offsetTop, behavior: 'smooth' });
  }, []);

  const showHud = useCallback(() => {
    window.clearTimeout(hudTimer.current);
    setHud(true);
    hudTimer.current = window.setTimeout(() => setHud(false), HUD_MS);
  }, []);

  useEffect(() => {
    showHud();
    return () => window.clearTimeout(hudTimer.current);
  }, [active, showHud]);

  const toggleHud = useCallback(() => {
    if (!hud) return showHud();
    window.clearTimeout(hudTimer.current);
    setHud(false);
  }, [hud, showHud]);

  const hush = useCallback(() => setMuted(true), []);

  const flash = useCallback((msg: string) => {
    window.clearTimeout(alarm.current);
    setToast(msg);
    alarm.current = window.setTimeout(() => setToast(''), 2400);
  }, []);
  useEffect(() => () => window.clearTimeout(alarm.current), []);

  useEffect(() => {
    if (ficha) return;
    const key = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') setFiltering(false);
        return;
      }
      if (e.key === 'Escape') {
        if (filtering) return setFiltering(false);
        if (full) return setFull(false);
        return;
      }
      if (filtering) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        jump(e.key === 'ArrowDown' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [jump, ficha, filtering, full]);

  const height = useReelHeight(stage);
  const column: React.CSSProperties =
    !immersive && height
      ? { height: '100%', width: `min(100%, ${Math.round(height * COLUMN)}px)` }
      : { height: '100%', width: '100%' };

  const save = (it: ReelItem) => {
    const on = !queued(it.id);
    onQueue(it);
    flash(on ? `“${it.title}” ${queueLabel[1].toLowerCase()}` : `Tirado: ${it.title}`);
  };

  const sideways = useSideSwipe(immersive && !filtering ? onExit : undefined);

  return (
    <section
      className={cn(immersive ? 'fixed inset-0 z-40 bg-house-deep' : 'flex flex-col')}
      data-noswipe
      onTouchStart={sideways.onTouchStart}
      onTouchEnd={sideways.onTouchEnd}
    >
      {}
      <div
        ref={stage}
        style={!immersive && height ? { height } : undefined}
        className={cn(
          immersive
            ? 'h-full w-full'
            : 'grid place-items-center -mt-7 -mb-20 sm:-mt-10',
          !immersive && !height && 'h-[70dvh]'
        )}
      >
        <div
          style={column}
          onPointerMove={e => {
            if (e.pointerType === 'mouse') showHud();
          }}
          onPointerLeave={e => {
            if (e.pointerType !== 'mouse') return;
            window.clearTimeout(hudTimer.current);
            setHud(false);
          }}
          className={cn(
            'relative overflow-hidden bg-house',
            !immersive && 'rounded-plate ring-1 ring-white/[0.07]'
          )}
        >
          <div
            ref={track}
            tabIndex={0}
            role="region"
            aria-label="Sugestões — o reel de trailers"
            onClick={toggleHud}
            className={cn(
              'absolute inset-0 snap-y snap-mandatory overflow-y-auto overscroll-contain',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-dye-brass/70',
              '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
            )}
          >
            {items.length ? (
              <>
                {items.map((it, i) => (
                  <Frame
                    key={`${it.kind}-${it.id}-${i}`}
                    index={i}
                    item={it}
                    rated={scoreOf.get(it.id) ?? null}
                    near={Math.abs(i - active) <= 1}
                    within={Math.abs(i - active) <= WINDOW}
                  />
                ))}
                {}
                <Projector
                  at={settled}
                  videoKey={seat?.trailerKey ?? null}
                  label={seat?.title ?? ''}
                  muted={muted}
                  onBalk={hush}
                  parked={!!ficha || full || filtering}
                />
              </>
            ) : (
              <div className="grid h-full place-items-center px-6 text-center">
                {loading ? (
                  <Skeleton className="aspect-video w-full" />
                ) : error ? (
                  <Fault detail={error}>Não foi possível carregar os trailers.</Fault>
                ) : (
                  <p className="text-[13px] leading-relaxed text-ink-dim">
                    Nenhum trailer neste gênero. Escolha outro na chave acima — ou volte para tudo.
                  </p>
                )}
              </div>
            )}
          </div>

          {}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[4] flex items-center gap-2 bg-gradient-to-b from-house-deep/90 via-house-deep/40 to-transparent p-3">
            {}
            <button
              type="button"
              onClick={onExit}
              title="Voltar ao catálogo"
              aria-label="Fechar as sugestões e voltar ao catálogo"
              className={cn(
                'pointer-events-auto flex flex-none items-center rounded-cell bg-house-seat/85',
                'text-ink-dim ring-1 ring-house-rail transition-colors hover:text-beam hover:ring-white/25',
                immersive ? 'h-10 w-10 justify-center' : 'gap-2 px-3 py-2'
              )}
            >
              <ChevronLeft className="h-[18px] w-[18px] flex-none" strokeWidth={1.9} aria-hidden />
              {!immersive ? (
                <span className="font-display text-[12px] uppercase leading-none tracking-[0.12em]">
                  Catálogo
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setFiltering(true)}
              aria-expanded={filtering}
              aria-label={`Filtrar por gênero — ${genre ?? 'tudo'}`}
              className="pointer-events-auto inline-flex items-center gap-2 rounded-cell bg-house-seat/85 px-3 py-2 font-display text-[12px] uppercase leading-none tracking-[0.12em] text-ink-dim ring-1 ring-house-rail transition-colors hover:text-beam hover:ring-white/25 coarse:min-h-[40px]"
            >
              <span>Gênero</span>
              <span className="text-dye-brass">{genre ?? 'Tudo'}</span>
              <ChevronDown className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2} aria-hidden />
            </button>

            {items.length ? (
              <span className="q ml-auto flex-none pr-1 text-[11px] text-ink-dim">
                {active + 1} / {items.length}
              </span>
            ) : null}
          </div>

          {}
          {here ? (
            <div
              className={cn(
                'absolute bottom-14 right-3 z-[3] flex flex-col items-end gap-3',
                'transition-opacity duration-200',
                hud ? 'opacity-100' : 'pointer-events-none opacity-0'
              )}
            >
              <RailKey
                label={queued(here.id) ? queueLabel[1] : queueLabel[0]}
                active={queued(here.id)}
                onClick={() => save(here)}
              >
                <Bookmark
                  className="h-[18px] w-[18px]"
                  fill={queued(here.id) ? 'currentColor' : 'none'}
                  strokeWidth={1.7}
                />
              </RailKey>

              <RailKey label="Maximizar o trailer" onClick={() => setFull(true)}>
                <Maximize2 className="h-[17px] w-[17px]" strokeWidth={1.8} />
              </RailKey>

              {}
              <div className="relative">
                {scoreOf.has(here.id) ? (
                  <RatedTip key={here.id} rated={scoreOf.get(here.id)!} />
                ) : null}
                <RailKey
                  label={`Abrir a ficha de ${here.title}`}
                  lit={scoreOf.has(here.id)}
                  onClick={() => setFicha(here)}
                >
                  <span className="font-display text-[10.5px] uppercase leading-none tracking-[0.1em]">
                    Ficha
                  </span>
                </RailKey>
              </div>

              <RailKey
                label={muted ? 'Ligar o som' : 'Tirar o som'}
                active={!muted}
                onClick={() => setMuted(m => !m)}
              >
                {muted ? (
                  <VolumeX className="h-[17px] w-[17px]" strokeWidth={1.8} />
                ) : (
                  <Volume2 className="h-[17px] w-[17px]" strokeWidth={1.8} />
                )}
              </RailKey>

              <RailKey label="Passar para o próximo" onClick={() => jump(1)}>
                <ChevronDown className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </RailKey>
            </div>
          ) : null}

          {filtering ? (
            <GenrePanel
              genres={genres}
              value={genre}
              onPick={g => {
                setGenre(g);
                setFiltering(false);
              }}
              onClose={() => setFiltering(false)}
            />
          ) : null}

          {toast ? (
            <div className="pointer-events-none absolute inset-x-3 bottom-4 z-[8] flex justify-center">
              <span className="plate flex items-center gap-2.5 px-4 py-2.5 animate-frame-in">
                <span className="h-1.5 w-1.5 flex-none rounded-full bg-dye-green-lit" />
                <span className="text-[12.5px] leading-none text-ink">{toast}</span>
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {full && here ? (
        <FullTrailer
          item={here}
          muted={muted}
          rated={scoreOf.get(here.id) ?? null}
          queued={queued(here.id)}
          queueLabel={queueLabel}
          onQueue={() => save(here)}
          onSound={() => setMuted(m => !m)}
          onPrev={() => jump(-1)}
          onNext={() => jump(1)}
          onClose={() => setFull(false)}
        />
      ) : null}

      {ficha ? (
        <Ficha
          item={ficha}
          rated={scoreOf.get(ficha.id) ?? null}
          openLabel={openLabel}
          onOpen={() => {
            const it = ficha;
            setFicha(null);
            onOpen(it);
          }}
          queued={queued(ficha.id)}
          queueLabel={queueLabel}
          onQueue={() => save(ficha)}
          onClose={() => setFicha(null)}
          renderTakes={renderTakes}
        />
      ) : null}
    </section>
  );
}

function useReelHeight(ref: React.RefObject<HTMLElement>) {
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const zoom = Number(getComputedStyle(document.documentElement).zoom) || 1;
      setHeight(Math.max(380, (window.innerHeight - el.getBoundingClientRect().top) / zoom));
    };
    measure();
    const eye = new ResizeObserver(measure);
    eye.observe(document.documentElement);
    window.addEventListener('resize', measure);
    return () => {
      eye.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref]);

  return height;
}

const SIDE = 72;

function useSideSwipe(onExit?: () => void) {
  const from = useRef<{ x: number; y: number } | null>(null);

  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      from.current = t ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const start = from.current;
      from.current = null;
      const t = e.changedTouches[0];
      if (!start || !t || !onExit) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dx) < SIDE || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      onExit();
    },
  };
}

function useGentle() {
  const [gentle, setGentle] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setGentle(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return gentle;
}

const embedOf = (key: string, bare: boolean) =>
  `https://www.youtube-nocookie.com/embed/${key}?autoplay=1&mute=1` +
  `&rel=0&modestbranding=1&playsinline=1&enablejsapi=1` +
  (bare ? '&controls=0&disablekb=1&fs=0&iv_load_policy=3&cc_load_policy=0' : '');

function command(frame: React.RefObject<HTMLIFrameElement>, func: string, args: unknown[] = []) {
  frame.current?.contentWindow?.postMessage(
    JSON.stringify({ event: 'command', func, args }),
    '*'
  );
}

function hushCaptions(frame: React.RefObject<HTMLIFrameElement>) {
  command(frame, 'unloadModule', ['captions']);
  command(frame, 'unloadModule', ['cc']);
}

function useSound(frame: React.RefObject<HTMLIFrameElement>, muted: boolean, rolling: boolean) {
  useEffect(() => {
    if (!rolling) return;
    command(frame, muted ? 'mute' : 'unMute');
    if (!muted) command(frame, 'playVideo');
  }, [frame, muted, rolling]);
}

const UNSTARTED = -1;
const ENDED = 0;
const PLAYING = 1;
const PAUSED = 2;
const BUFFERING = 3;
const CUED = 5;
const HELLO_MS = 260;

function useYtState(frame: React.RefObject<HTMLIFrameElement>, on: unknown) {
  const [state, setState] = useState(UNSTARTED);

  useEffect(() => {
    setState(UNSTARTED);
    if (!on) return;

    let greeted = false;
    const hello = () =>
      frame.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
        '*'
      );

    const heard = (e: MessageEvent) => {
      if (e.source && e.source !== frame.current?.contentWindow) return;
      if (!/(^|\.)youtube(-nocookie)?\.com$/.test(hostOf(e.origin))) return;
      greeted = true;
      let said: unknown;
      try {
        said = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      const box = said as { event?: string; info?: number | { playerState?: number } };
      const told = typeof box?.info === 'number' ? box.info : box?.info?.playerState;
      if (typeof told === 'number') setState(told);
    };

    window.addEventListener('message', heard);
    const ping = window.setInterval(() => !greeted && hello(), HELLO_MS);
    hello();

    return () => {
      window.removeEventListener('message', heard);
      window.clearInterval(ping);
    };
  }, [on, frame]);

  return state;
}

function hostOf(origin: string) {
  try {
    return new URL(origin).hostname;
  } catch {
    return '';
  }
}

const Frame = memo(function Frame({
  index,
  item,
  rated,
  near,
  within,
}: {
  index: number;
  item: ReelItem;
  rated: RatedTitle | null;
  near: boolean;
  within: boolean;
}) {
  const still = item.backdrop ?? item.poster;

  if (!within) {
    return (
      <section
        data-frame={index}
        aria-label={item.title}
        className="h-full w-full snap-start snap-always bg-house-deep"
      />
    );
  }

  return (
    <section
      data-frame={index}
      aria-label={item.title}
      className="relative h-full w-full snap-start snap-always overflow-hidden bg-house-deep"
    >
      {}
      {near ? (
        <>
          {item.poster ?? still ? (
            <div
              aria-hidden
              className="absolute -inset-10 bg-cover bg-center opacity-[0.55] blur-2xl saturate-[.6]"
              style={{ backgroundImage: `url(${item.poster ?? still})` }}
            />
          ) : null}
          <div aria-hidden className="absolute inset-0 bg-house-deep/60" />
        </>
      ) : null}

      {}
      <div className="absolute inset-0 grid place-items-center">
        <div className="relative aspect-video w-full overflow-hidden bg-black ring-1 ring-white/10">
          {still ? (
            <img
              src={still}
              alt=""
              loading="lazy"
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            />
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          'absolute inset-x-0 bottom-0 px-5 pb-6 pt-5',
          'pr-[68px]',
          'bg-gradient-to-t from-house-deep/[0.96] via-house-deep/[0.86] to-transparent'
        )}
      >
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="rounded-[1px] bg-dye-brass px-1.5 py-[3px] font-display text-[10.5px] uppercase leading-none tracking-[0.14em] text-house-deep">
            {item.genre}
          </span>
          <span className="q text-[11px] text-ink-dim">
            {[item.year, item.crowd ? `TMDB ${fmt(item.crowd.score)}` : null].filter(Boolean).join(' · ')}
          </span>
        </p>

        <h2 className="mt-2 font-display text-[26px] uppercase leading-[0.92] tracking-[0.02em] text-beam sm:text-[30px]">
          {item.title}
        </h2>

        {rated ? (
          <span className="mt-2 flex items-center gap-2">
            <Strip value={rated.score ?? 0} cells={10} className="h-[5px] w-[88px] flex-none" />
            <span className="q text-[13px] text-beam">{rated.score != null ? fmt(rated.score) : '—'}</span>
            <span className="q text-[10.5px] text-ink-faint">
              {plural(rated.takes, 'ficha do clube', 'fichas do clube')}
            </span>
          </span>
        ) : null}

        {item.overview ? (
          <p className="mt-2 line-clamp-2 text-[12.5px] leading-snug text-ink-dim">{item.overview}</p>
        ) : null}
      </div>
    </section>
  );
});

const NUDGE_MS = 1200;

function Projector({
  at,
  videoKey,
  label,
  muted,
  onBalk,
  parked,
}: {
  at: number;
  videoKey: string | null;
  label: string;
  muted: boolean;
  onBalk: () => void;
  parked: boolean;
}) {
  const beam = useRef<HTMLIFrameElement>(null);
  const gentle = useGentle();
  const [asked, setAsked] = useState(false);
  const armed = !gentle || asked;
  const want = armed && !parked ? videoKey : null;

  const seed = useRef<string | null>(null);
  if (want && !seed.current) seed.current = want;
  const born = seed.current;

  const state = useYtState(beam, born);
  const [aired, setAired] = useState<string | null>(null);
  const [offer, setOffer] = useState(false);
  const wanted = useRef<string | null>(null);
  const loaded = useRef<string | null>(null);
  const balks = useRef(0);

  useEffect(() => {
    wanted.current = want;
    balks.current = 0;
  }, [want]);

  useEffect(() => {
    if (!want) {
      if (loaded.current) command(beam, 'pauseVideo');
      return;
    }
    if (loaded.current === want) command(beam, 'playVideo');
    else if (loaded.current) command(beam, 'loadVideoById', [{ videoId: want }]);
    loaded.current = want;
  }, [want]);

  useEffect(() => {
    if (state === PLAYING) {
      if (wanted.current) setAired(wanted.current);
      hushCaptions(beam);
      return;
    }
    if (!wanted.current) return;
    if (state === ENDED) {
      command(beam, 'seekTo', [0, true]);
      command(beam, 'playVideo');
    }
    if (state === CUED) command(beam, 'playVideo');
    if (state === PAUSED) {
      balks.current += 1;
      if (balks.current > 2) {
        command(beam, 'mute');
        onBalk();
      }
      command(beam, 'playVideo');
    }
  }, [state, onBalk]);

  const shown = aired === want && (state === PLAYING || state === BUFFERING);

  useSound(beam, muted, shown);

  useEffect(() => {
    setOffer(false);
    if (!want || shown) return;
    let tries = 0;
    const nudge = window.setInterval(() => {
      tries += 1;
      if (tries <= 2) command(beam, 'playVideo');
      else if (tries === 3) command(beam, 'loadVideoById', [{ videoId: want }]);
      else {
        setOffer(true);
        window.clearInterval(nudge);
      }
    }, NUDGE_MS);
    return () => window.clearInterval(nudge);
  }, [want, shown]);

  const door = !parked && !!videoKey && (!armed || offer);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 h-full"
      style={{ top: `${at * 100}%` }}
    >
      <div className="grid h-full place-items-center">
        <div className="relative aspect-video w-full">
          {born ? (
            <iframe
              ref={beam}
              src={embedOf(born, true)}
              title={`Trailer de ${label}`}
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              tabIndex={-1}
              aria-hidden={!shown}
              className={cn(
                'pointer-events-none absolute inset-0 h-full w-full border-0',
                shown ? 'opacity-100 transition-opacity duration-300' : 'opacity-0'
              )}
            />
          ) : null}
          {door ? (
            <button
              type="button"
              onClick={() => {
                setAsked(true);
                command(beam, 'playVideo');
                if (!muted) command(beam, 'unMute');
              }}
              className="pointer-events-auto absolute inset-0 grid place-items-center bg-house-deep/45 text-beam transition-colors hover:bg-house-deep/20"
            >
              <span className="flex items-center gap-2 rounded-cell bg-house-seat/85 px-4 py-2.5 font-display text-[12px] uppercase tracking-[0.14em] ring-1 ring-house-rail">
                <Play className="h-3.5 w-3.5 fill-current" strokeWidth={0} aria-hidden />
                Tocar o trailer
              </span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RailKey({
  label,
  active,
  lit,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  lit?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'relative grid h-11 w-11 flex-none place-items-center rounded-cell bg-house-seat/85',
        'ring-1 transition-colors duration-150 active:translate-y-px',
        lit
          ? 'text-dye-brass ring-dye-brass/70 hover:text-beam-hot'
          : active
            ? 'text-dye-brass ring-dye-brass/60'
            : 'text-ink-dim ring-house-rail hover:text-beam hover:ring-white/25'
      )}
    >
      {lit ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-bulb rounded-cell bg-dye-brass/[0.18]"
        />
      ) : null}
      <span className="relative">{children}</span>
    </button>
  );
}

const TIP_MS = 3200;

function RatedTip({ rated }: { rated: RatedTitle }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setGone(true), TIP_MS);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <span
      aria-hidden={gone}
      className={cn(
        'pointer-events-none absolute right-[calc(100%+8px)] top-1/2 z-10 -translate-y-1/2',
        'flex items-center gap-2 rounded-cell bg-house-seat/95 px-2.5 py-1.5 ring-1 ring-dye-brass/45',
        'animate-frame-in transition-opacity duration-500',
        gone && 'opacity-0'
      )}
    >
      <Check className="h-3.5 w-3.5 flex-none text-dye-brass" strokeWidth={2.2} aria-hidden />
      <span className="whitespace-nowrap font-display text-[10.5px] uppercase leading-none tracking-[0.12em] text-ink">
        {rated.mine ? 'Você já avaliou' : 'O clube já avaliou'}
      </span>
      {rated.score != null ? (
        <span className="q text-[11px] leading-none text-dye-brass">{fmt(rated.score)}</span>
      ) : null}
    </span>
  );
}

function GenrePanel({
  genres,
  value,
  onPick,
  onClose,
}: {
  genres: string[];
  value: string | null;
  onPick: (g: string | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const q = norm(query.trim());
  const shown = genres.filter(g => !q || norm(g).includes(q));
  const all = !q || norm('Tudo').includes(q);

  return (
    <div className="absolute inset-0 z-[6] flex flex-col gap-3 bg-house-deep/[0.97] p-4 animate-frame-in">
      <div className="flex items-center justify-between gap-3">
        <span className="legend">Filtrar o reel</span>
        <IconKey aria-label="Fechar o filtro" onClick={onClose} className="flex-none">
          <X className="h-4 w-4" strokeWidth={1.8} />
        </IconKey>
      </div>

      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Buscar gênero…"
        aria-label="Buscar gênero"
        className="w-full rounded-cell bg-house-seat px-3 py-2.5 text-[13px] text-ink ring-1 ring-house-rail placeholder:text-ink-faint focus:outline-none focus:ring-dye-brass/70"
      />

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain">
        {all ? <GenreRow label="Tudo" on={value === null} onClick={() => onPick(null)} /> : null}
        {shown.map(g => (
          <GenreRow key={g} label={g} on={value === g} onClick={() => onPick(g)} />
        ))}
        {!all && !shown.length ? (
          <p className="mt-6 text-center text-[13px] text-ink-dim">Nenhum gênero com esse nome.</p>
        ) : null}
      </div>
    </div>
  );
}

function GenreRow({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-cell px-3 py-2.5 text-left',
        'font-display text-[13px] uppercase leading-none tracking-[0.12em]',
        'ring-1 transition-colors duration-150 coarse:min-h-[44px]',
        on
          ? 'bg-dye-brass/[0.14] text-dye-brass ring-dye-brass/70'
          : 'text-ink ring-house-rail hover:ring-white/25'
      )}
    >
      <span className="truncate">{label}</span>
      {on ? <Check className="h-4 w-4 flex-none" strokeWidth={2.2} aria-hidden /> : null}
    </button>
  );
}

function FullTrailer({
  item,
  muted,
  rated,
  queued,
  queueLabel,
  onQueue,
  onSound,
  onPrev,
  onNext,
  onClose,
}: {
  item: ReelItem;
  muted: boolean;
  rated: RatedTitle | null;
  queued: boolean;
  queueLabel: [string, string];
  onQueue: () => void;
  onSound: () => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const beam = useRef<HTMLIFrameElement>(null);
  const rolling = useYtState(beam, item.trailerKey) === PLAYING;
  useSound(beam, muted, rolling);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener('cancel', cancel);
    return () => el.removeEventListener('cancel', cancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-label={`Trailer de ${item.title}`}
      className="h-[calc(100dvh/var(--ui-zoom))] max-h-none w-full max-w-none border-0 bg-house-deep p-0 text-ink backdrop:bg-house-deep open:animate-beam-in"
    >
      <div className="flex h-full flex-col">
        <div className="grid min-h-0 flex-1 place-items-center p-3 sm:p-5">
          <div className="aspect-video w-full max-w-[min(100%,calc((100dvh/var(--ui-zoom)-190px)*16/9))] overflow-hidden bg-black ring-1 ring-white/10">
            <iframe
              ref={beam}
              src={embedOf(item.trailerKey, false)}
              title={`Trailer de ${item.title}`}
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
              className="h-full w-full border-0"
            />
          </div>
        </div>

        <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-3 border-t border-house-rail bg-house px-4 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="legend truncate">
              {[item.genre, item.year, rated?.score != null ? `clube ${fmt(rated.score)}` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className="mt-1.5 truncate font-display text-[24px] uppercase leading-none tracking-[0.03em] text-beam">
              {item.title}
            </p>
          </div>

          <div className="flex flex-none items-center gap-2.5">
            <IconKey aria-label="Trailer anterior" onClick={onPrev}>
              <ChevronUp className="h-4 w-4" strokeWidth={1.9} />
            </IconKey>
            <IconKey aria-label="Próximo trailer" onClick={onNext}>
              <ChevronDown className="h-4 w-4" strokeWidth={1.9} />
            </IconKey>
            <IconKey
              aria-label={muted ? 'Ligar o som' : 'Tirar o som'}
              active={!muted}
              onClick={onSound}
            >
              {muted ? (
                <VolumeX className="h-4 w-4" strokeWidth={1.8} />
              ) : (
                <Volume2 className="h-4 w-4" strokeWidth={1.8} />
              )}
            </IconKey>
            <IconKey
              aria-label={queued ? queueLabel[1] : queueLabel[0]}
              active={queued}
              onClick={onQueue}
            >
              <Bookmark className="h-4 w-4" fill={queued ? 'currentColor' : 'none'} strokeWidth={1.7} />
            </IconKey>
            <Key tone="commit" onClick={onClose}>
              Voltar ao reel
            </Key>
          </div>
        </div>
      </div>
    </dialog>
  );
}

type FichaData = {
  title: string;
  original: string | null;
  year: number | null;
  poster: string | null;
  facts: string[];
  genres: string[];
  overview: string | null;
  cast: string[];
  trailerUrl: string | null;
  crowd: { score: number; votes: number } | null;
  watch: Movie['watch'];
};

function Ficha({
  item,
  rated,
  openLabel,
  onOpen,
  queued,
  queueLabel,
  onQueue,
  onClose,
  renderTakes,
}: {
  item: ReelItem;
  rated: RatedTitle | null;
  openLabel: string;
  onOpen: () => void;
  queued: boolean;
  queueLabel: [string, string];
  onQueue: () => void;
  onClose: () => void;
  renderTakes: (id: number) => React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<FichaData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener('cancel', cancel);
    return () => el.removeEventListener('cancel', cancel);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    const ask =
      item.kind === 'show'
        ? api<{ show: ShowDetail }>(`/api/series/${item.id}`).then(r => showFicha(r.show))
        : api<Movie>(`/api/catalog/movie/${item.id}`).then(movieFicha);
    ask.then(f => alive && setData(f)).catch(e => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [item.id, item.kind]);

  return (
    <dialog
      ref={ref}
      aria-label={`Ficha de ${item.title}`}
      onClick={e => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'w-full max-w-[900px] max-h-[calc(100dvh/var(--ui-zoom))] overflow-hidden bg-transparent p-2 text-ink',
        'backdrop:bg-house-deep/95 open:animate-beam-in sm:p-4'
      )}
    >
      {}
      <div className="plate relative max-h-[calc(100dvh/var(--ui-zoom)-1rem)] overflow-y-auto overscroll-contain p-5 sm:max-h-[calc(100dvh/var(--ui-zoom)-2rem)] sm:p-7">
        <IconKey aria-label="Fechar" onClick={onClose} className="absolute right-3 top-3 z-10">
          <X className="h-4 w-4" strokeWidth={1.8} />
        </IconKey>

        {error ? (
          <Fault detail={error}>Não foi possível carregar a ficha.</Fault>
        ) : !data ? (
          <div className="flex flex-col gap-5 sm:flex-row">
            <Skeleton className="aspect-[2/3] w-[132px] flex-none sm:w-[176px]" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-7 w-3/5" />
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <Poster
                src={data.poster}
                alt={`Pôster de ${data.title}`}
                className="aspect-[2/3] w-[132px] flex-none sm:w-[176px]"
              />
              <div className="min-w-0 flex-1">
                <h2 className="pr-10 font-display text-[30px] leading-none tracking-[0.03em] text-beam">
                  {data.title}
                </h2>
                {data.original ? (
                  <p className="q mt-1.5 pr-10 text-[13px] text-ink-dim">{data.original}</p>
                ) : null}
                {data.facts.length ? (
                  <p className="q mt-2 text-[12.5px] text-ink-dim">{data.facts.join(' · ')}</p>
                ) : null}

                <span className="mt-3 flex flex-wrap items-center gap-1.5">
                  {data.genres.map(g => (
                    <span
                      key={g}
                      className="rounded-[1px] px-2 py-0.5 font-display text-[11px] uppercase tracking-[0.14em] text-dye-red-lit ring-1 ring-dye-red-lit/50"
                    >
                      {g}
                    </span>
                  ))}
                </span>

                <Verdicts rated={rated} crowd={data.crowd} />

                <p className="mt-4 max-w-[66ch] text-[13.5px] leading-relaxed text-ink-dim">
                  {data.overview || 'Sem sinopse disponível no TMDB.'}
                </p>
                {data.cast.length ? (
                  <p className="mt-3 text-[12px] text-ink-dim">Elenco: {data.cast.join(', ')}</p>
                ) : null}
                {data.trailerUrl ? (
                  <TrailerKey url={data.trailerUrl} title={data.title} className="mt-3">
                    Ver o trailer inteiro
                  </TrailerKey>
                ) : null}

                <WatchOn watch={data.watch} title={data.title} />

                <div className="mt-6 flex flex-wrap gap-2">
                  <Key tone="commit" onClick={onOpen}>
                    <Check className="h-4 w-4" strokeWidth={2} />
                    {openLabel}
                  </Key>
                  <Key
                    tone="flush"
                    className={queued ? 'text-dye-red-lit ring-dye-red-lit/50' : undefined}
                    onClick={onQueue}
                  >
                    <Bookmark className="h-4 w-4" fill={queued ? 'currentColor' : 'none'} strokeWidth={1.7} />
                    {queued ? queueLabel[1] : queueLabel[0]}
                  </Key>
                </div>
              </div>
            </div>

            {}
            <div className="mt-7 border-t border-white/[0.07] pt-5">{renderTakes(item.id)}</div>
          </>
        )}
      </div>
    </dialog>
  );
}

function Verdicts({ rated, crowd }: { rated: RatedTitle | null; crowd: FichaData['crowd'] }) {
  const votes = (n: number) =>
    new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

  const line = (label: string, score: number, note: string, lit: boolean) => (
    <span className="flex items-center gap-2">
      <span className="legend w-[6ch] flex-none">{label}</span>
      <Strip value={score} cells={10} className="h-[5px] w-[70px] flex-none" />
      <span className={cn('q whitespace-nowrap text-[12px]', lit ? 'text-beam' : 'text-ink-dim')}>
        {fmt(score)} <span className="text-ink-faint">· {note}</span>
      </span>
    </span>
  );

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {rated?.score != null ? (
        line('Clube', rated.score, plural(rated.takes, 'ficha', 'fichas'), true)
      ) : (
        <p className="q text-[12px] text-ink-dim">sem avaliação do clube</p>
      )}
      {crowd ? line('TMDB', crowd.score, `${votes(crowd.votes)} votos`, false) : null}
    </div>
  );
}

const movieFicha = (m: Movie): FichaData => ({
  title: m.title,
  original: m.original ?? null,
  year: m.year,
  poster: m.poster,
  facts: [m.year ? String(m.year) : null, runtimeOf(m.runtime), m.director ? `dir. ${m.director}` : null].filter(
    Boolean
  ) as string[],
  genres: m.genres?.length ? m.genres : [m.genre],
  overview: m.overview ?? null,
  cast: (m.cast ?? []).map(c => c.name),
  trailerUrl: m.trailerUrl ?? null,
  crowd: m.crowd ?? null,
  watch: m.watch,
});

const showFicha = (s: ShowDetail): FichaData => ({
  title: s.title,
  original: s.original,
  year: s.year,
  poster: s.poster,
  facts: [
    s.year ? (s.endedYear && s.endedYear !== s.year ? `${s.year}–${s.endedYear}` : String(s.year)) : null,
    s.totalEpisodes ? `${s.totalEpisodes} ${plural(s.totalEpisodes, 'episódio', 'episódios')}` : null,
    runtimeOf(s.runtime),
    s.creators.length ? `criada por ${s.creators.join(', ')}` : null,
  ].filter(Boolean) as string[],
  genres: s.genres?.length ? s.genres : [s.genre],
  overview: s.overview,
  cast: [],
  trailerUrl: s.trailerUrl,
  crowd: s.crowd,
  watch: s.watch,
});

export function SuggestionsKey({ onOpen }: { onOpen: () => void }) {
  return (
    <Key
      tone="flush"
      onClick={onOpen}
      title="Trailers do que ver, por gênero — começando pelo que o clube já avaliou"
      className="flex-none"
    >
      {}
      <Play className="h-3 w-3 fill-current" strokeWidth={0} aria-hidden />
      Sugestões
    </Key>
  );
}

export function MovieReels() {
  const club = useClub();

  const rated = useMemo(() => {
    const by = new Map<number, RatedTitle>();
    for (const r of club.reviews) {
      const held = by.get(r.movieId);
      if (held) {
        held.mine = held.mine || r.reviewerId === club.me.id;
        if (r.date > held.at) held.at = r.date;
        continue;
      }
      const avg = club.averages[r.movieId];
      by.set(r.movieId, {
        id: r.movieId,
        score: avg?.avg ?? r.final,
        takes: avg?.count ?? 1,
        mine: r.reviewerId === club.me.id,
        at: r.date,
      });
    }
    return [...by.values()];
  }, [club.reviews, club.averages, club.me.id]);

  return (
    <ReelsScreen
      kind="movie"
      rated={rated}
      openLabel="Avaliar este filme"
      onOpen={it => club.rateMovie(it.id)}
      queued={id => club.inWatchlist(id)}
      onQueue={it =>
        void club.toggleWatch({
          id: it.id,
          title: it.title,
          year: it.year,
          genre: it.genre,
          poster: it.poster,
        })
      }
      queueLabel={['Quero ver', 'Na fila']}
      renderTakes={id => <MovieTakes movieId={id} />}
      onExit={() => club.goTab('catalog')}
    />
  );
}

export function SeriesReels({
  takes,
  meId,
  queued,
  onQueue,
  onOpen,
  onTab,
}: {
  takes: ShowTake[] | null;
  meId: string;
  queued: (id: number) => boolean;
  onQueue: (s: { id: number; title: string; year: number | null; genre: string; poster: string | null }) => void;
  onOpen: (showId: number) => void;
  onTab: (t: TabId) => void;
}) {
  const rated = useMemo(() => {
    const by = new Map<number, RatedTitle & { sum: number }>();
    for (const t of takes ?? []) {
      if (t.final == null) continue;
      const at = t.ratedAt ?? t.watchedAt;
      const held = by.get(t.showId);
      if (held) {
        held.sum += t.final;
        held.takes += 1;
        held.score = held.sum / held.takes;
        held.mine = held.mine || t.reviewerId === meId;
        if (at > held.at) held.at = at;
        continue;
      }
      by.set(t.showId, {
        id: t.showId,
        sum: t.final,
        score: t.final,
        takes: 1,
        mine: t.reviewerId === meId,
        at,
      });
    }
    return [...by.values()];
  }, [takes, meId]);

  return (
    <ReelsScreen
      kind="show"
      rated={rated}
      openLabel="Abrir a série"
      onOpen={it => onOpen(it.id)}
      queued={queued}
      onQueue={it =>
        onQueue({ id: it.id, title: it.title, year: it.year, genre: it.genre, poster: it.poster })
      }
      queueLabel={['Acompanhar', 'Nas minhas séries']}
      renderTakes={id => <ShowTakes showId={id} takes={takes} />}
      onExit={() => onTab('catalog')}
    />
  );
}

export function MovieTakes({ movieId }: { movieId: number }) {
  const club = useClub();
  const here = club.reviews
    .filter(r => r.movieId === movieId)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!here.length) {
    return (
      <p className="text-[13px] text-ink-dim">
        Ninguém do clube avaliou este filme ainda. A chave vermelha acima abre a ficha em branco.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <span className="legend">O que o clube achou</span>
      {here.map(r => (
        <TakePlate
          key={r.id}
          take={{ id: r.id, reviewerId: r.reviewerId, reviewerName: r.reviewerName }}
          person={{ id: r.reviewerId, name: r.reviewerName, dot: r.reviewerDot }}
          final={r.final}
          line={null}
          review={r}
        />
      ))}
    </div>
  );
}

export function ShowTakes({ showId, takes }: { showId: number; takes: ShowTake[] | null }) {
  const here = (takes ?? [])
    .filter(t => t.showId === showId && t.final != null)
    .sort((a, b) => (b.ratedAt ?? b.watchedAt).localeCompare(a.ratedAt ?? a.watchedAt));

  if (!here.length) {
    return (
      <p className="text-[13px] text-ink-dim">
        Ninguém do clube avaliou uma temporada desta série ainda.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <span className="legend">O que o clube achou</span>
      {here.map(t => (
        <TakePlate
          key={t.id}
          take={{ id: t.id, reviewerId: t.reviewerId, reviewerName: t.reviewerName ?? '' }}
          person={{ id: t.reviewerId, name: t.reviewerName ?? '', dot: t.reviewerDot }}
          final={t.final ?? 0}
          line={`Temporada ${t.season}`}
          review={t}
        />
      ))}
    </div>
  );
}

function TakePlate({
  take,
  person,
  final,
  line,
  review,
}: {
  take: { id: string; reviewerId: string; reviewerName: string };
  person: { id: string; name: string; dot: string | null };
  final: number;
  line: string | null;
  review: Review | ShowTake;
}) {
  return (
    <div className="rounded-cell bg-house-deep/55 p-4 ring-1 ring-inset ring-white/[0.06]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PersonReel person={person} size="sm" />
        <PersonName
          person={person}
          className="font-display text-[13px] uppercase tracking-[0.1em] text-ink"
        />
        {line ? <span className="q text-[11.5px] text-ink-dim">{line}</span> : null}
        <span className="ml-auto flex flex-none items-center gap-2.5">
          <Strip value={final} cells={10} className="hidden h-[6px] w-[90px] flex-none sm:block" />
          <span className="q font-display text-[20px] leading-none text-beam">{fmt(final)}</span>
        </span>
        <TakeVotes take={take} />
      </div>

      <div className="mt-3">
        <Breakdown r={review} comment={review.comment ?? undefined} />
      </div>

      <Conversation take={take} />
    </div>
  );
}
