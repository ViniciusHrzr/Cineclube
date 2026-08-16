import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Play, Search } from 'lucide-react';
import { Blank, Fault, Key, Poster, Skeleton, Strip } from '@/components/bits';
import {
  api,
  fmt,
  finalOf,
  post,
  verdictFor,
  weightedSum,
  type Criterion,
  type Movie,
  type Review,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { useClub } from '@/App';

export function RateScreen({
  pendingRate,
  onConsumedPending,
}: {
  pendingRate: number | null;
  onConsumedPending: () => void;
}) {
  const club = useClub();
  const reviewerId = club.me.id;
  const [movie, setMovie] = useState<Movie | null>(null);
  const [loadingMovie, setLoadingMovie] = useState(false);
  const [movieError, setMovieError] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const criteria = useMemo(() => (movie ? club.criteriaFor(movie.genre) : []), [movie, club]);

  const selectMovie = useCallback(
    async (id: number | string) => {
      setLoadingMovie(true);
      setMovieError(null);
      try {
        const m = await api<Movie>(`/api/catalog/movie/${id}`);
        setMovie(m);
        const fresh: Record<string, number> = {};
        club.criteriaFor(m.genre).forEach(c => (fresh[c.key] = 5));
        setScores(fresh);
        setComment('');
        setSaved(false);
      } catch (e) {
        setMovieError((e as Error).message);
      } finally {
        setLoadingMovie(false);
      }
    },
    [club]
  );

  useEffect(() => {
    if (pendingRate != null) {
      void selectMovie(pendingRate);
      onConsumedPending();
    }
  }, [pendingRate, selectMovie, onConsumedPending]);

  const final = movie ? finalOf(criteria, scores) : 0;
  const sum = movie ? weightedSum(criteria, scores) : 0;
  const existing =
    movie && club.reviews.find(r => r.reviewerId === reviewerId && r.movieId === movie.id);

  async function save() {
    if (!movie || saving) return;
    setSaving(true);
    try {
      // The server signs the take with the session, so no reviewer travels in
      // the body: whoever is logged in is who rated it.
      const rec = await post<Review>('/api/reviews', { movie, scores, comment });
      club.reload({
        reviews: club.reviews
          .filter(r => !(r.reviewerId === rec.reviewerId && r.movieId === rec.movieId))
          .concat([rec]),
        watchlist: club.watchlist.filter(w => String(w.id) !== String(rec.movieId)),
      });
      /* Each member is at their own browser, so the take is finished when it is
         saved. The film stays on screen so the score can be adjusted, and the
         notice offers the archive rather than handing the desk to someone else. */
      setSaved(true);
    } catch (e) {
      club.fault('Não foi possível gravar a avaliação: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <header className="mb-7">
        <h1 className="font-display text-[38px] leading-none tracking-[0.04em] text-beam sm:text-[46px]">
          Avaliar filme
        </h1>
      </header>

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0 space-y-7">
          <AnimatePresence>
            {saved ? (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                role="status"
                className="flex flex-wrap items-center gap-3 rounded-cell bg-dye-red/10 px-4 py-3 text-[13px] ring-1 ring-dye-red/40"
              >
                <span className="h-2 w-2 flex-none rounded-full bg-dye-red shadow-[0_0_10px_rgba(209,42,32,0.9)]" />
                <span className="flex-1">
                  <strong className="font-semibold">Gravado.</strong> Sua nota entrou no histórico do clube.
                  Mexer nos critérios e gravar de novo substitui esta avaliação.
                </span>
                <Key tone="ghost" onClick={() => club.goTab('reviews')}>
                  Ver no histórico
                </Key>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <Bay legend="Filme">
            {loadingMovie ? (
              <div className="flex gap-4">
                <Skeleton className="aspect-[2/3] w-[76px]" />
                <div className="flex-1 space-y-3 pt-1">
                  <Skeleton className="h-5 w-2/5" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            ) : movieError ? (
              <Fault detail={movieError}>Não foi possível carregar este filme.</Fault>
            ) : movie ? (
              <Slate movie={movie} onSwap={() => { setMovie(null); setScores({}); setComment(''); setSaved(false); }} />
            ) : (
              <MovieSearch onPick={id => void selectMovie(id)} />
            )}
          </Bay>

          {movie ? (
            <>
              <Bay legend="Critérios" note="0–10 · passo 0,5">
                <Channels
                  criteria={criteria}
                  scores={scores}
                  genre={movie.genre}
                  onChange={(k, v) => {
                    setScores(s => ({ ...s, [k]: v }));
                    setSaved(false);
                  }}
                />
              </Bay>

              <Bay legend="Comentário" note="opcional">
                <label className="block">
                  <span className="sr-only">Comentário sobre o filme</span>
                  <textarea
                    rows={3}
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    placeholder="O que ficou da sessão?"
                    className="w-full resize-y rounded-cell bg-house-deep px-3 py-2.5 text-[14px] leading-relaxed text-ink caret-dye-red ring-1 ring-house-rail placeholder:text-ink-dim focus-visible:ring-dye-cyan"
                  />
                </label>
              </Bay>
            </>
          ) : null}
        </div>

        <MasterCard
          hasMovie={!!movie}
          final={final}
          sum={sum}
          canSave={!!movie && !!reviewerId && !saving}
          saving={saving}
          isUpdate={!!existing}
          onSave={() => void save()}
          onReset={() => {
            if (!movie) return;
            const fresh: Record<string, number> = {};
            criteria.forEach(c => (fresh[c.key] = 5));
            setScores(fresh);
            setSaved(false);
          }}
        />
      </div>
    </section>
  );
}

function Bay({ legend, note, children }: { legend: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-white/[0.07] pt-5 first:border-0 first:pt-0">
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <span className="legend">{legend}</span>
        {note ? <span className="q text-[11px] text-ink-dim">{note}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Slate({ movie, onSwap }: { movie: Movie; onSwap: () => void }) {
  return (
    <div>
      <div className="flex items-start gap-4">
        <Poster src={movie.poster} alt={`Pôster de ${movie.title}`} className="aspect-[2/3] w-[86px] flex-none" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[26px] leading-none tracking-[0.03em] text-beam">{movie.title}</h2>
          <p className="q mt-2 text-[12.5px] text-ink-dim">
            {movie.year ?? '—'}
            {movie.director ? ` · dir. ${movie.director}` : ''}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="rounded-[1px] px-2 py-0.5 font-display text-[11px] uppercase tracking-[0.14em] text-dye-red-lit ring-1 ring-dye-red-lit/50">
              {movie.genre}
            </span>
            <button type="button" onClick={onSwap} className="text-[12.5px] text-ink-dim underline underline-offset-4 hover:text-beam">
              trocar de filme
            </button>
          </div>
        </div>
      </div>
      {movie.overview || movie.cast?.length || movie.trailerUrl ? (
        <div className="mt-4 border-t border-white/[0.07] pt-4">
          {movie.overview ? (
            <p className="max-w-[66ch] text-[13px] leading-relaxed text-ink-dim">{movie.overview}</p>
          ) : null}
          {movie.cast?.length ? (
            <p className="mt-2 text-[12px] text-ink-dim">Elenco: {movie.cast.map(c => c.name).join(', ')}</p>
          ) : null}
          {movie.trailerUrl ? (
            <a
              href={movie.trailerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-2 font-display text-[12px] uppercase tracking-[0.14em] text-dye-red-lit hover:text-[#ff7a6e]"
            >
              <Play className="h-3.5 w-3.5" fill="currentColor" strokeWidth={0} />
              Assistir trailer
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MovieSearch({ onPick }: { onPick: (id: number) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const timer = useRef<number>();

  const run = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const data = await api<{ results: Movie[] }>(
        query.trim() ? `/api/catalog/search?q=${encodeURIComponent(query.trim())}` : '/api/catalog/popular'
      );
      setResults(data.results.slice(0, 8));
      setNote(query.trim() ? `${data.results.length} resultado(s)` : 'populares do momento');
    } catch (e) {
      setResults([]);
      setNote('Erro ao buscar: ' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run('');
  }, [run]);

  return (
    <div>
      <div className="flex items-center gap-3 rounded-cell bg-house-deep px-3 ring-1 ring-house-rail focus-within:ring-dye-cyan">
        <Search className="h-4 w-4 flex-none text-ink-dim" strokeWidth={1.7} />
        <input
          type="text"
          value={q}
          onChange={e => {
            setQ(e.target.value);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => void run(e.target.value), 350);
          }}
          placeholder="Buscar um filme no TMDB…"
          aria-label="Buscar filme"
          autoComplete="off"
          className="w-full bg-transparent py-3 text-[15px] text-ink caret-dye-red outline-none placeholder:text-ink-dim"
        />
      </div>
      <div className="mt-3 flex flex-col">
        {loading
          ? Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 border-t border-white/[0.05] py-2 first:border-0">
                <Skeleton className="h-12 w-8" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-2.5 w-1/5" />
                </div>
              </div>
            ))
          : results.length
          ? results.map(x => (
              <button
                key={x.id}
                type="button"
                onClick={() => onPick(x.id)}
                className="flex items-center gap-3 border-t border-white/[0.05] px-1 py-2 text-left transition-colors first:border-0 hover:bg-beam/[0.06]"
              >
                <Poster src={x.poster} className="h-12 w-8 flex-none" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{x.title}</span>
                  <span className="q block text-[11px] text-ink-dim">{x.year ?? '—'}</span>
                </span>
                <span className="font-display text-[11px] uppercase tracking-[0.12em] text-ink-dim">{x.genre}</span>
              </button>
            ))
          : <Blank title="Nenhum filme encontrado">Tente outro título.</Blank>}
      </div>
      <p className="q mt-3 text-[10.5px] text-ink-dim">{note}</p>
    </div>
  );
}

/* ── the criteria strips ──────────────────────────────────────────────────
   One criterion per row: name and weight on the left, value on the right, the
   slider full width beneath, the description under that. The description is
   printed for everyone rather than hidden behind a hover, and the slider stays
   a native range so the keyboard and screen readers keep working. */
function Channels({
  criteria,
  scores,
  genre,
  onChange,
}: {
  criteria: Criterion[];
  scores: Record<string, number>;
  genre: string;
  onChange: (key: string, value: number) => void;
}) {
  const tech = criteria.filter(c => c.w === 1);
  const gen = criteria.filter(c => c.w === 2);
  let i = 0;
  const row = (c: Criterion) => <Channel key={c.key} c={c} index={i++} value={scores[c.key] ?? 5} onChange={onChange} />;
  return (
    <div className="plate overflow-hidden px-4 pb-4 sm:px-5">
      <p className="legend py-4">8 critérios técnicos ×1</p>
      {tech.map(row)}
      <p className="legend mt-5 border-t border-white/[0.07] pt-5 text-dye-cyan">
        2 critérios de {genre.toLowerCase()} ×2
      </p>
      {gen.map(row)}
    </div>
  );
}

function Channel({
  c,
  index,
  value,
  onChange,
}: {
  c: Criterion;
  index: number;
  value: number;
  onChange: (key: string, value: number) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1], delay: Math.min(index, 9) * 0.026 }}
      className="group border-t border-white/[0.06] py-4 first-of-type:border-0"
    >
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[15px] uppercase tracking-[0.1em] text-ink">{c.name}</span>
        <span
          className={cn(
            'q rounded-[1px] px-1.5 py-px text-[10px] ring-1',
            c.w === 2 ? 'text-dye-cyan ring-dye-cyan/50' : 'text-ink-dim ring-house-rail'
          )}
        >
          ×{c.w}
        </span>
        <span className="q ml-auto text-[21px] font-medium tabular-nums text-ink transition-colors duration-150 group-hover:text-beam group-focus-within:text-beam">
          {fmt(value)}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={10}
        step={0.5}
        value={value}
        onChange={e => onChange(c.key, parseFloat(e.target.value))}
        aria-label={`${c.name}, peso ${c.w}`}
        aria-describedby={`hint-${c.key}`}
        className="film-range mt-2 w-full"
      />
      <p id={`hint-${c.key}`} className="mt-2 max-w-[70ch] text-[12px] leading-relaxed text-ink-dim">
        {c.hint}
      </p>
    </motion.div>
  );
}

/* ── the title card ───────────────────────────────────────────────────────
   The final score, set like the card that opens a film: the number is the
   largest thing on the screen, and the arithmetic that produced it is printed
   underneath rather than hidden. */
function MasterCard({
  hasMovie,
  final,
  sum,
  canSave,
  saving,
  isUpdate,
  onSave,
  onReset,
}: {
  hasMovie: boolean;
  final: number;
  sum: number;
  canSave: boolean;
  saving: boolean;
  isUpdate: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <aside className="plate sticky bottom-0 z-20 -mx-4 rounded-none p-4 sm:-mx-6 sm:px-6 lg:top-24 lg:bottom-auto lg:mx-0 lg:rounded-plate lg:p-6">
      <span className="legend">Nota final</span>
      <div className="mt-2 flex items-end gap-3 lg:flex-col lg:items-start lg:gap-0">
        <div className="flex items-baseline gap-2">
          {hasMovie ? (
            <span className="font-display text-[54px] leading-[0.85] tracking-[0.02em] text-beam lg:text-[76px]">
              {fmt(final)}
            </span>
          ) : (
            // An em dash set at 76px in a condensed display face reads as a
            // stray rule, not as "no value yet".
            <span className="font-display text-[54px] leading-[0.85] tracking-[0.02em] text-ink-faint lg:text-[76px]">
              0,0
            </span>
          )}
          <span className="q text-[13px] text-ink-dim">/10</span>
        </div>
        <p className="q ml-auto pb-1 text-[11px] text-ink-dim lg:ml-0 lg:mt-3 lg:pb-0">
          {hasMovie ? `${fmt(sum)} pontos ÷ 12 pesos` : '8 critérios ×1 + 2 critérios ×2'}
        </p>
      </div>
      <Strip value={hasMovie ? final : 0} cells={20} live className="mt-3 h-3 lg:h-4" />
      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-dim">
        {hasMovie ? verdictFor(final) : 'Escolha um filme para começar.'}
      </p>
      <div className="mt-4 flex gap-2 lg:flex-col">
        <Key tone="commit" className="flex-1" disabled={!canSave} onClick={onSave}>
          <Check className="h-4 w-4" strokeWidth={2} />
          {saving ? 'Gravando…' : isUpdate ? 'Regravar' : 'Gravar avaliação'}
        </Key>
        <Key tone="ghost" disabled={!hasMovie} onClick={onReset}>
          Zerar
        </Key>
      </div>
    </aside>
  );
}
