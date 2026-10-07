import { memo, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, Check, Info, Trash2, X } from 'lucide-react';
import { CardBody, CardContainer, CardItem } from '@/components/ui/3d-card-effect';
import { Fault, IconKey, Key, Poster, Reel, Skeleton, Strip, TrailerKey } from '@/components/bits';
import { api, fmt, initialsOf, reelColor, runtimeOf, type Movie, type Review } from '@/lib/api';
import { cn, plural } from '@/lib/utils';
import { useWorld } from '@/lib/world';
import { goesToService, watchDoor } from '@/lib/watch';

export const FilmCell = memo(function FilmCell({
  movie,
  avg,
  count,
  inWatchlist,
  onOpen,
  onRate,
  onToggleWatch,
  onRemove,
}: {
  movie: Movie;
  avg?: number;
  count?: number;
  inWatchlist?: boolean;
  onOpen: (id: number) => void;
  onRate: (id: number) => void;
  onToggleWatch?: (m: Movie) => void;
  onRemove?: (id: number) => void;
}) {
  return (
    <CardContainer containerClassName="block h-full w-full" className="h-full w-full">
      <CardBody className="flex h-full w-full flex-col">
        <CardItem translateZ={60} className="w-full">
          <button
            type="button"
            onClick={() => onOpen(movie.id)}
            aria-label={`Ver detalhes de ${movie.title}`}
            className="group/cell block w-full text-left"
          >
            {}
            <span className="relative block overflow-hidden rounded-cell">
              <Poster src={movie.poster} className="aspect-[2/3] w-full" />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 flex translate-y-full items-center justify-center gap-1.5 bg-beam px-2 py-2 font-display text-[11px] uppercase tracking-[0.14em] text-house-deep transition-transform duration-200 ease-beam group-hover/cell:translate-y-0 group-focus-visible/cell:translate-y-0 motion-reduce:transition-none">
                <Info className="h-3.5 w-3.5" strokeWidth={2} />
                Sinopse e trailer
              </span>
            </span>
          </button>
        </CardItem>

        <CardItem translateZ={30} className="mt-3 w-full">
          <h3 className="text-[14px] font-semibold leading-tight text-ink">{movie.title}</h3>
          {}
          {movie.original ? (
            <p className="q mt-0.5 truncate text-[11px] text-ink-faint" title={movie.original}>
              {movie.original}
            </p>
          ) : null}
          <p className="q mt-0.5 text-[11.5px] text-ink-dim">
            {movie.year ?? '—'} · {movie.genre}
          </p>
          <div className="mt-2 flex items-center gap-2">
            {avg != null ? (
              <>
                <Strip value={avg} cells={10} className="h-[5px] flex-1" />
                <span className="q text-[11.5px] text-beam">{fmt(avg)}</span>
                {count ? <span className="q text-[11px] text-ink-dim">({count})</span> : null}
              </>
            ) : (
              <span className="q text-[11.5px] text-ink-dim">sem avaliação</span>
            )}
          </div>
          <OnCell watch={movie.watch} title={movie.title} />
        </CardItem>

        <CardItem translateZ={18} className="mt-auto flex w-full gap-2 pt-3">
          <Key tone="flush" className="flex-1 px-2" onClick={() => onRate(movie.id)}>
            Avaliar
          </Key>
          {onToggleWatch ? (
            <IconKey
              active={inWatchlist}
              aria-pressed={inWatchlist}
              aria-label={inWatchlist ? 'Remover de Quero ver' : 'Adicionar a Quero ver'}
              onClick={() => onToggleWatch(movie)}
            >
              <Bookmark className="h-4 w-4" fill={inWatchlist ? 'currentColor' : 'none'} strokeWidth={1.7} />
            </IconKey>
          ) : null}
          {onRemove ? (
            <IconKey aria-label="Tirar da fila" onClick={() => onRemove(movie.id)}>
              <Trash2 className="h-4 w-4" strokeWidth={1.7} />
            </IconKey>
          ) : null}
        </CardItem>
      </CardBody>
    </CardContainer>
  );
});

export function ProjectionSheet({
  movieId,
  clubAvg,
  clubCount,
  takes,
  inWatchlist,
  onClose,
  onRate,
  onOpenTake,
  onToggleWatch,
}: {
  movieId: number | null;
  clubAvg?: number;
  clubCount?: number;
  takes?: Review[];
  inWatchlist: boolean;
  onClose: () => void;
  onRate: (id: number) => void;
  onOpenTake?: (reviewId: string) => void;
  onToggleWatch: (m: Movie) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [movie, setMovie] = useState<Movie | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (movieId == null) {
      if (el.open) el.close();
      return;
    }
    setMovie(null);
    setError(null);
    if (!el.open) el.showModal();
    let alive = true;
    api<Movie>(`/api/catalog/movie/${movieId}`)
      .then(m => alive && setMovie(m))
      .catch(e => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [movieId]);

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
      aria-label="Detalhes do filme"
      onClick={e => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'w-full max-w-[900px] max-h-[calc(100dvh/var(--ui-zoom))] overflow-hidden bg-transparent p-2 text-ink backdrop:bg-house-deep/95 sm:p-4',
        'open:animate-beam-in'
      )}
    >
      <div className="plate relative max-h-[calc(100dvh/var(--ui-zoom)-1rem)] overflow-y-auto overscroll-contain p-5 sm:max-h-[calc(100dvh/var(--ui-zoom)-2rem)] sm:p-7">
        <IconKey aria-label="Fechar" onClick={onClose} className="absolute right-3 top-3 z-10">
          <X className="h-4 w-4" strokeWidth={1.8} />
        </IconKey>

        {error ? (
          <Fault detail={error}>Não foi possível carregar os detalhes deste filme.</Fault>
        ) : !movie ? (
          <div className="flex flex-col gap-5 sm:flex-row">
            <Skeleton className="aspect-[2/3] w-[132px] flex-none sm:w-[190px]" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-6 w-3/5" />
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <Poster src={movie.poster} alt={`Pôster de ${movie.title}`} className="aspect-[2/3] w-[132px] flex-none sm:w-[190px]" />
            <div className="min-w-0 flex-1">
              <h2 className="pr-10 font-display text-[30px] leading-none tracking-[0.03em] text-beam">{movie.title}</h2>
              {}
              {movie.original ? (
                <p className="q mt-1.5 pr-10 text-[13px] text-ink-dim">{movie.original}</p>
              ) : null}
              {}
              <p className="q mt-2 text-[12.5px] text-ink-dim">
                {[
                  movie.year ?? '—',
                  runtimeOf(movie.runtime),
                  movie.director ? `dir. ${movie.director}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {}
                <span className="flex flex-wrap items-center gap-1.5">
                  {(movie.genres?.length ? movie.genres : [movie.genre]).map(g => (
                    <span
                      key={g}
                      className="rounded-[1px] px-2 py-0.5 font-display text-[11px] uppercase tracking-[0.14em] text-dye-red-lit ring-1 ring-dye-red-lit/50"
                    >
                      {g}
                    </span>
                  ))}
                </span>
              </div>

              <Verdicts club={clubAvg} clubCount={clubCount} crowd={movie.crowd} />

              <Roster takes={takes} onOpen={onOpenTake} />

              <p className="mt-4 max-w-[66ch] text-[13.5px] leading-relaxed text-ink-dim">
                {movie.overview || 'Sem sinopse disponível no TMDB.'}
              </p>
              {movie.cast?.length ? (
                <p className="mt-3 text-[12px] text-ink-dim">Elenco: {movie.cast.map(c => c.name).join(', ')}</p>
              ) : null}
              {movie.trailerUrl ? (
                <TrailerKey url={movie.trailerUrl} title={movie.title} className="mt-3" />
              ) : null}

              <WatchOn watch={movie.watch} title={movie.title} />

              <div className="mt-6 flex flex-wrap gap-2">
                <Key tone="commit" onClick={() => onRate(movie.id)}>
                  <Check className="h-4 w-4" strokeWidth={2} />
                  Avaliar este filme
                </Key>
                <Key
                  tone="flush"
                  className={inWatchlist ? 'text-dye-red-lit ring-dye-red-lit/50' : undefined}
                  onClick={() => onToggleWatch(movie)}
                >
                  <Bookmark className="h-4 w-4" fill={inWatchlist ? 'currentColor' : 'none'} strokeWidth={1.7} />
                  {inWatchlist ? 'Na fila' : 'Quero ver'}
                </Key>
              </div>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}

function Roster({ takes, onOpen }: { takes?: Review[]; onOpen?: (reviewId: string) => void }) {
  const world = useWorld();
  if (!takes?.length) return null;
  const ordenadas = [...takes].sort((a, b) => b.final - a.final);

  return (
    <div className="mt-5">
      <p className="legend mb-2.5">
        {plural(ordenadas.length, 'ficha no clube', 'fichas no clube')}
      </p>
      <ul className="flex flex-wrap gap-2">
        {ordenadas.map(t => (
          <li key={t.id}>
            <button
              type="button"
              disabled={!onOpen}
              onClick={() => onOpen?.(t.id)}
              title={onOpen ? `Abrir a ficha de ${t.reviewerName} no acervo` : undefined}
              className="flex items-center gap-2 rounded-cell bg-house-seat/55 py-1 pl-1 pr-2.5 ring-1 ring-inset ring-white/[0.06] transition-colors duration-150 enabled:hover:ring-white/25"
            >
              <Reel color={reelColor(t.reviewerDot, t.reviewerId)} src={world.avatarOf(t.reviewerId)} size="sm">
                {initialsOf(t.reviewerName)}
              </Reel>
              <span className="font-display text-[12px] uppercase tracking-[0.1em] text-ink">
                {t.reviewerName}
              </span>
              <span className="q text-[13px] font-medium text-beam">{fmt(t.final)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OnCell({ watch, title }: { watch: Movie['watch']; title: string }) {
  if (!watch?.streaming.length) return null;
  const shown = watch.streaming.slice(0, 4);
  const rest = watch.streaming.length - shown.length;

  return (
    <div className="mt-2 flex items-center gap-1">
      {shown.map(p => (
        <WatchLink key={p.id} provider={p.name} title={title} deep={p.url} fallback={watch.link}>
          {p.logo ? (
            <img
              src={p.logo}
              alt={p.name}
              width={18}
              height={18}
              loading="lazy"
              className="h-[18px] w-[18px] flex-none rounded-[2px] ring-1 ring-white/10"
            />
          ) : (
            <span className="q text-[10.5px] text-ink-dim">{p.name}</span>
          )}
        </WatchLink>
      ))}
      {rest > 0 ? <span className="q text-[10.5px] text-ink-faint">+{rest}</span> : null}
    </div>
  );
}

function WatchLink({
  provider,
  title,
  deep,
  fallback,
  children,
  className,
}: {
  provider: string;
  title: string;
  deep?: string | null;
  fallback: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  const href = deep || watchDoor(provider, title, fallback);
  if (!href) return <span className={className}>{children}</span>;
  const label = deep || goesToService(provider) ? `Abrir em ${provider}` : `Onde assistir: ${provider}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      className={cn(
        'transition-opacity duration-150 hover:opacity-80 focus-visible:opacity-80',
        className
      )}
    >
      {children}
    </a>
  );
}

function Verdicts({
  club,
  clubCount,
  crowd,
}: {
  club: number | null | undefined;
  clubCount: number | null | undefined;
  crowd: Movie['crowd'];
}) {
  const votes = (n: number) =>
    new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

  const gap = club != null && crowd ? club - crowd.score : null;
  const apart = gap != null && Math.abs(gap) >= 0.25;

  const verdict = (label: string, score: number, note: string, lit: boolean) => (
    <span className="flex items-center gap-2">
      <span className="legend w-[6ch] flex-none">{label}</span>
      <Strip value={score} cells={10} className="h-[5px] w-[70px] flex-none" />
      <span className={cn('q text-[12px] whitespace-nowrap', lit ? 'text-beam' : 'text-ink-dim')}>
        {fmt(score)} <span className="text-ink-faint">· {note}</span>
      </span>
    </span>
  );

  if (club == null && !crowd) {
    return <p className="q mt-3 text-[12px] text-ink-dim">sem avaliação do clube</p>;
  }

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {club != null
        ? verdict('Clube', club, plural(clubCount ?? 0, 'avaliação', 'avaliações'), true)
        : <p className="q text-[12px] text-ink-dim">sem avaliação do clube</p>}
      {crowd ? verdict('TMDB', crowd.score, `${votes(crowd.votes)} votos`, false) : null}
      {apart ? (
        <p className="q mt-0.5 text-[11.5px] text-dye-brass">
          {fmt(Math.abs(gap!))} {gap! > 0 ? 'acima' : 'abaixo'} do TMDB
        </p>
      ) : gap != null ? (
        <p className="q mt-0.5 text-[11.5px] text-ink-faint">o clube e o TMDB concordam</p>
      ) : null}
    </div>
  );
}

export function WatchOn({ watch, title }: { watch: Movie['watch']; title: string }) {
  if (watch === undefined) return null;

  if (!watch) {
    return (
      <div className="mt-5 border-t border-white/[0.07] pt-4">
        <span className="legend">Onde assistir</span>
        <p className="mt-2 text-[12.5px] text-ink-dim">
          Não está em nenhum streaming no Brasil.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5 border-t border-white/[0.07] pt-4">
      {}
      <span className="legend">Onde assistir</span>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {watch.streaming.map(p => (
          <WatchLink
            key={p.id}
            provider={p.name}
            title={title}
            deep={p.url}
            fallback={watch.link}
            className="flex shrink-0 items-center gap-2 rounded-cell bg-house-deep/70 py-1 pl-1 pr-2.5 ring-1 ring-house-rail"
          >
            {}
            {p.logo ? (
              <img
                src={p.logo}
                alt=""
                width={20}
                height={20}
                loading="lazy"
                className="h-5 w-5 flex-none rounded-[2px] object-contain"
              />
            ) : null}
            <span className="whitespace-nowrap text-[11.5px] leading-none text-ink">{p.name}</span>
          </WatchLink>
        ))}
      </div>
    </div>
  );
}

export function Bin({ children }: { children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-5 sm:grid-cols-[repeat(auto-fill,minmax(178px,1fr))]">
      <AnimatePresence initial={false}>
        {items.map((child, i) => (
          <motion.div
            key={(child as { key?: string })?.key ?? i}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1], delay: Math.min(i, 9) * 0.022 }}
            className="h-full"
          >
            {child}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
