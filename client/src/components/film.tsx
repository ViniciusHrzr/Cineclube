import { memo, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, Check, Info, Play, Trash2, X } from 'lucide-react';
import { CardBody, CardContainer, CardItem } from '@/components/ui/3d-card-effect';
import { Fault, IconKey, Key, Poster, Skeleton, Strip } from '@/components/bits';
import { api, fmt, type Movie } from '@/lib/api';
import { cn, plural } from '@/lib/utils';

/* ── the film cell ────────────────────────────────────────────────────────
   A film in the bin is a cell of celluloid on the wall: it tips toward the
   hand that reaches for it and its layers separate, which is the 3d-card
   effect doing the work it was written for. The face opens the projection
   sheet; the action row underneath is its own set of controls, so no button
   is ever nested inside another. */
/* The handlers take the film rather than closing over it. A bin holds a hundred
   of these and every one of them is a 3D card with its own layers, so the whole
   grid used to be rebuilt on each keystroke in the search field above it — an
   arrow function per card per render is enough to defeat any memo. Given the
   film as an argument, the callbacks are the same functions on every render and
   a card only re-renders when something about that film changed. */
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
            aria-label={`Ver ficha de ${movie.title}`}
            className="group/cell block w-full text-left"
          >
            {/* The strip is hidden by a translate, so it has to live inside a
                positioned box that clips it — otherwise it resolves against a
                far ancestor and sits permanently over the title.

                This box used to weave like a frame in the gate: two pixels and
                a fifth of a degree, over twenty seconds. It was the right idea
                and the wrong budget — one perpetually animated element per
                poster, twenty per page, each asking the browser for a
                compositor layer of its own. Chrome grants them all; Gecko has a
                ceiling, and past it it stops promoting and animates on the main
                thread instead, repainting every frame whether or not anything
                is happening. Twenty layers for two pixels nobody consciously
                sees is not a trade worth making. */}
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

/* ── the projection sheet ─────────────────────────────────────────────────
   A film opened from the bin, shown whole: poster, synopsis, cast, trailer.
   A native <dialog> rather than a route, because the grid's scroll position is
   what the club comes back to, and the platform gives the focus trap, Escape
   and background inertness for free. */
export function ProjectionSheet({
  movieId,
  clubAvg,
  clubCount,
  inWatchlist,
  onClose,
  onRate,
  onToggleWatch,
}: {
  movieId: number | null;
  clubAvg?: number;
  clubCount?: number;
  inWatchlist: boolean;
  onClose: () => void;
  onRate: (id: number) => void;
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
      aria-label="Ficha do filme"
      onClick={e => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'w-full max-w-[900px] bg-transparent p-2 text-ink backdrop:bg-house-deep/80 backdrop:backdrop-blur-sm sm:p-4',
        'open:animate-beam-in'
      )}
    >
      <div className="plate relative max-h-[calc(100dvh-1rem)] overflow-y-auto p-5 sm:p-7">
        <IconKey aria-label="Fechar" onClick={onClose} className="absolute right-3 top-3 z-10">
          <X className="h-4 w-4" strokeWidth={1.8} />
        </IconKey>

        {error ? (
          <Fault detail={error}>Não foi possível carregar esta ficha.</Fault>
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
              <p className="q mt-2 text-[12.5px] text-ink-dim">
                {movie.year ?? '—'}
                {movie.director ? ` · dir. ${movie.director}` : ''}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {/* Every genre the film carries, and not only the one it would
                    open on. Which of them a take is rated under is that take's
                    own decision, so the sheet states what is on offer rather
                    than pretending the film is one thing. */}
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
                {clubAvg != null ? (
                  <span className="flex items-center gap-2">
                    <Strip value={clubAvg} cells={10} className="h-[5px] w-[70px]" />
                    <span className="q text-[12px] text-beam">
                      {fmt(clubAvg)} · {plural(clubCount ?? 0, 'avaliação', 'avaliações')}
                    </span>
                  </span>
                ) : (
                  <span className="q text-[12px] text-ink-dim">sem avaliação do clube</span>
                )}
              </div>

              <p className="mt-4 max-w-[66ch] text-[13.5px] leading-relaxed text-ink-dim">
                {movie.overview || 'Sem sinopse disponível no TMDB.'}
              </p>
              {movie.cast?.length ? (
                <p className="mt-3 text-[12px] text-ink-dim">Elenco: {movie.cast.map(c => c.name).join(', ')}</p>
              ) : null}
              {movie.trailerUrl ? (
                <a
                  href={movie.trailerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex w-fit items-center gap-2 font-display text-[12px] uppercase tracking-[0.14em] text-dye-red-lit hover:text-[#ff7a6e]"
                >
                  <Play className="h-3.5 w-3.5" fill="currentColor" strokeWidth={0} />
                  Assistir trailer
                </a>
              ) : null}

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

/* A grid of cells, with the list stagger capped so a twenty-poster page never
   feels like it is loading twice. */
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
