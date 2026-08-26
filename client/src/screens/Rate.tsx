import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useVelocity,
} from 'framer-motion';
import { Check, Play, Search } from 'lucide-react';
import { Blank, Fault, Key, Poster, Skeleton, Strip } from '@/components/bits';
import {
  api,
  fmt,
  finalOf,
  post,
  runtimeOf,
  totalWeight,
  verdictFor,
  weightedSum,
  type Criterion,
  type Movie,
  type Review,
} from '@/lib/api';
import { cn, plural } from '@/lib/utils';
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
  /* ── which genre this film is being rated as ────────────────────────────
     Almost no film is one genre. TMDB gave Frewaka drama, fantasy and horror,
     and until now something had to choose — a priority list did, and it was
     guessing at what the person watching already knows. So the choice moves to
     them: every genre the film carries is offered, and the card follows the one
     they pick — the two criteria the genre brings always, and for animation and
     documentary a slot of the craft eight as well.

     It is held here rather than read off the film because it is a decision
     about this take and not a fact about the film. Two members can rate the
     same film as different things, and both are right about what they watched
     it for. */
  const [genre, setGenre] = useState<string>('');

  const criteria = useMemo(() => (genre ? club.criteriaFor(genre) : []), [genre, club]);

  /** Every genre offered for a film, and never an empty list. */
  const choices = movie ? (movie.genres?.length ? movie.genres : [movie.genre]) : [];

  const selectMovie = useCallback(
    async (id: number | string) => {
      setLoadingMovie(true);
      setMovieError(null);
      try {
        const m = await api<Movie>(`/api/catalog/movie/${id}`);
        setMovie(m);
        /* A film this person already rated opens on the marks they gave it, not
           on a fresh card. "Editar" led here too, and it used to hand back ten
           fives — which is not an edit, it is the same form with the previous
           answer thrown away, and it silently invited someone to overwrite a
           take they only meant to adjust. Five stays the opening position for a
           film nobody here has seen yet, and for any criterion the old take has
           no mark for.

           It opens on the genre of that take too, for the same reason: the
           marks they gave answer those criteria, and opening on a different
           genre would show their numbers under questions they never saw. */
        const mine = club.reviews.find(r => r.reviewerId === club.me.id && r.movieId === m.id);
        const opening = mine?.movieGenre ?? m.genre;
        setGenre(opening);
        const fresh: Record<string, number> = {};
        club.criteriaFor(opening).forEach(c => (fresh[c.key] = mine?.scores?.[c.key] ?? 5));
        setScores(fresh);
        setComment(mine?.comment ?? '');
        setSaved(false);
      } catch (e) {
        setMovieError((e as Error).message);
      } finally {
        setLoadingMovie(false);
      }
    },
    [club]
  );

  /* Switching genre keeps every mark that still has a question to answer, and
     opens whatever is new at five. Most of the card survives the switch — the
     eight at weight 1 are the same in every genre but the two that swap a slot
     (see BASE_SWAP in criteria.js), and a pair is sometimes shared, as Drama and
     Romance both are on impacto.

     Seeding matters more than it looks: a criterion with no entry reads as five
     on its slider and counts as zero in the total, so leaving one unseeded
     would show a card that does not add up to its own score. */
  const pickGenre = useCallback(
    (next: string) => {
      setGenre(next);
      setScores(prev => {
        const seeded: Record<string, number> = {};
        club.criteriaFor(next).forEach(c => (seeded[c.key] = prev[c.key] ?? 5));
        return seeded;
      });
      setSaved(false);
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
  const weight = movie ? totalWeight(criteria, scores) : 0;
  const existing =
    movie && club.reviews.find(r => r.reviewerId === reviewerId && r.movieId === movie.id);

  async function save() {
    if (!movie || saving) return;
    setSaving(true);
    try {
      // The server signs the take with the session, so no reviewer travels in
      // the body: whoever is logged in is who rated it.
      // The genre travels as the one that was chosen, not the one the film
      // opened on: it is what decides which two criteria these marks answer,
      // and the record has to keep the pair the person actually saw.
      const rec = await post<Review>('/api/reviews', { movie: { ...movie, genre }, scores, comment });
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
              <Slate
                movie={movie}
                genre={genre}
                choices={choices}
                onGenre={pickGenre}
                onSwap={() => {
                  setMovie(null);
                  setGenre('');
                  setScores({});
                  setComment('');
                  setSaved(false);
                }}
              />
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
                  genre={genre}
                  crew={movie.crew}
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
                    className="w-full resize-y rounded-cell bg-house-deep px-3 py-2.5 text-[14px] leading-relaxed text-ink caret-dye-red ring-1 ring-house-rail placeholder:text-ink-dim focus-visible:ring-dye-brass"
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
          weight={weight}
          canSave={!!movie && !!reviewerId && !saving}
          saving={saving}
          saved={saved}
          isUpdate={!!existing}
          onSeeHistory={() => club.goTab('reviews')}
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

function Slate({
  movie,
  genre,
  choices,
  onGenre,
  onSwap,
}: {
  movie: Movie;
  genre: string;
  choices: string[];
  onGenre: (g: string) => void;
  onSwap: () => void;
}) {
  return (
    <div>
      <div className="flex items-start gap-4">
        <Poster src={movie.poster} alt={`Pôster de ${movie.title}`} className="aspect-[2/3] w-[86px] flex-none" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[26px] leading-none tracking-[0.03em] text-beam">{movie.title}</h2>
          {movie.original ? (
            <p className="q mt-1.5 text-[12.5px] text-ink-dim">{movie.original}</p>
          ) : null}
          {/* The same three facts the projection sheet states, in the same
              order, because this is the same film seen from the other side of
              the desk. */}
          <p className="q mt-2 text-[12.5px] text-ink-dim">
            {[
              movie.year ?? '—',
              runtimeOf(movie.runtime),
              movie.director ? `dir. ${movie.director}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>

          {/* ── what this film is being rated as ──────────────────────────
              A film with one genre states it; a film with several asks. The
              two ×2 criteria below change with the answer, so this is not a
              label — it is the second half of the form, and it is placed
              before the criteria because it decides what they are. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {choices.length > 1 ? (
              choices.map(g => {
                const on = g === genre;
                return (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onGenre(g)}
                    className={cn(
                      'rounded-[1px] px-2 py-0.5 font-display text-[11px] uppercase tracking-[0.14em] ring-1 transition-colors duration-150',
                      on
                        ? 'text-dye-red-lit ring-dye-red-lit/70 shadow-[inset_0_0_12px_rgba(209,42,32,0.2)]'
                        : 'text-ink-dim ring-house-rail hover:text-ink hover:ring-white/25'
                    )}
                  >
                    {g}
                  </button>
                );
              })
            ) : (
              <span className="rounded-[1px] px-2 py-0.5 font-display text-[11px] uppercase tracking-[0.14em] text-dye-red-lit ring-1 ring-dye-red-lit/50">
                {genre || movie.genre}
              </span>
            )}
            <button type="button" onClick={onSwap} className="text-[12.5px] text-ink-dim underline underline-offset-4 hover:text-beam">
              trocar de filme
            </button>
          </div>
          {choices.length > 1 ? (
            <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">
              Este filme é de mais de um gênero. O escolhido decide os dois critérios que valem dobro —
              e, em animação e documentário, também troca uma das oito perguntas da base.
            </p>
          ) : null}
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
      setNote(
        query.trim() ? plural(data.results.length, 'resultado', 'resultados') : 'populares do momento'
      );
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
      <div className="flex items-center gap-3 rounded-cell bg-house-deep px-3 ring-1 ring-house-rail focus-within:ring-dye-brass">
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
  crew,
  onChange,
}: {
  criteria: Criterion[];
  scores: Record<string, number>;
  genre: string;
  /** Who signs each criterion. Empty for a film served from the cache. */
  crew?: Record<string, string[]>;
  onChange: (key: string, value: number) => void;
}) {
  /* Agrupado pelo que o servidor declara, e não mais pelo peso. O peso era o
     atalho — ×1 era ofício, ×2 era gênero — e no dia em que todo peso virou 1
     esse atalho passou a juntar as onze perguntas numa lista só. O agrupamento
     que ele representava é real e agora é explícito. */
  const craft = criteria.filter(c => c.group === 'oficio');
  const gen = criteria.filter(c => c.group === 'genero');
  const personal = criteria.filter(c => c.group === 'pessoal');
  let i = 0;
  const row = (c: Criterion) => (
    <Channel key={c.key} c={c} index={i++} value={scores[c.key] ?? 5} signers={crew?.[c.key]} onChange={onChange} />
  );
  return (
    <div className="plate overflow-hidden px-4 pb-4 sm:px-5">
      {/* Not "técnicos". Two genres replace a slot of these eight — animation is
          asked about its voice cast instead of its acting, documentary about
          access and archive instead of acting and production design — so the
          word that used to describe the group describes it wrongly for two. */}
      <p className="legend py-4">Como o filme é feito</p>
      {craft.map(row)}

      {/* Cyan, as the pair always was here. It never meant "worth double" — it
          means "this part of the card is the film's own choice", which is
          exactly what survived the weights going away. */}
      <p className="legend mt-5 border-t border-white/[0.07] pt-5 text-dye-brass">
        O que {genre.toLowerCase()} pede
      </p>
      {gen.map(row)}

      {/* ── e o único que não é sobre o filme ─────────────────────────────
          Its own region, at the end, because it is a different question and
          reading it as the ninth thing about the film is how it stops being
          answered honestly. Everything above asks what the film does; this asks
          what it did to you, and you answer it after taking the film apart. */}
      <p className="legend mt-5 border-t border-white/[0.07] pt-5">
        E o seu
      </p>
      {personal.map(row)}
    </div>
  );
}

function Channel({
  c,
  index,
  value,
  signers,
  onChange,
}: {
  c: Criterion;
  index: number;
  value: number;
  /** The people credited for this criterion, if anybody is. */
  signers?: string[];
  onChange: (key: string, value: number) => void;
}) {
  /* ── the gate and the light ─────────────────────────────────────────────
     The exposed length of film is the mark. It is not animated, and that is the
     point: a filled track is not an object with mass, it is the value drawn as
     a length, and a value that arrives after the hand that set it makes the
     control feel broken. It was a spring here first, running up the strip half
     a beat behind the gate, and it read as lag because it was lag.

     What is animated is the flare at the gate — the beam blooming as film runs
     through it. Position is exact and instant; only the intensity moves, driven
     by how fast the mark is travelling and decaying to nothing when it stops.
     Nothing lags, because nothing about where anything is is being animated.

     The number is left alone. It used to swell on a spring, which meant text
     redrawn at fractional scale on every frame — that is what was flickering,
     and no amount of tuning fixes it, because rasterised type at 1.06× is
     simply a blurred version of itself. */
  const gate = useMotionValue(value);
  useEffect(() => {
    gate.set(value);
  }, [value, gate]);

  const rush = useVelocity(gate);
  const flare = useSpring(useTransform(rush, [-16, 0, 16], [1, 0, 1]), {
    stiffness: 240,
    damping: 28,
  });
  const bloom = useTransform(flare, [0, 1], [0, 0.9]);
  const spread = useTransform(flare, [0, 1], [0.9, 1.85]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1], delay: Math.min(index, 9) * 0.026 }}
      className="group border-t border-white/[0.06] py-4 first-of-type:border-0"
    >
      {/* No weight badge. It used to read ×1 or ×2 and carried the one fact
          that separated the two halves of the card; with every criterion at the
          same weight it would print ×1 eleven times, which is a column of
          nothing dressed as data. The grouping legends above say what the badge
          was really being read for. */}
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[15px] uppercase tracking-[0.1em] text-ink">{c.name}</span>
        <span className="q ml-auto text-[21px] font-medium tabular-nums text-ink transition-colors duration-150 group-hover:text-beam group-focus-within:text-beam">
          {fmt(value)}
        </span>
      </div>

      {/* ── quem assina ──────────────────────────────────────────────────────
          The name goes above the slider, not in the description under it,
          because it is the thing being scored and not an explanation of the
          scoring. Dragging Fotografia from 5 to 8 is a judgement about work
          somebody did, and the card should say whose while the hand is on it.

          Silent when nobody is credited. An animation rarely has a director of
          photography and nobody at all signs Originalidade — an empty line
          reading "—" would be inventing an absence that is not one. */}
      {signers?.length ? (
        <p className="mt-1 text-[12px] leading-snug text-beam-dim">{signers.join(' · ')}</p>
      ) : null}

      {/* Everything visible is drawn here; the input is invisible and on top,
          where it still takes the drag, the arrow keys and the screen reader.
          It comes first in the DOM so the drawn parts can react to it as its
          siblings — held, focused — and z-10 puts it back over them for the
          pointer. The mark can only land on a half point, but nothing drawn
          here has to arrive in one frame: the light, the gate and the flare all
          glide the 5% between two steps on the same 130ms curve. */}
      <div className="relative mt-2 h-[34px]">
        <input
          type="range"
          min={0}
          max={10}
          step={0.5}
          value={value}
          onChange={e => onChange(c.key, parseFloat(e.target.value))}
          aria-label={c.name}
          aria-describedby={`hint-${c.key}`}
          className="peer film-range absolute inset-0 z-10 w-full"
        />

        {/* Inset by half the grab area, so 0% and 100% land under the middle of
            the gate rather than off the end of the strip. */}
        <span aria-hidden className="pointer-events-none absolute inset-x-2 top-3 h-[10px]">
          <span className="film-strip absolute inset-0" />
          {/* Width, not scaleX: scaling stretches the rasterised gradient and
              the inner glow with it, and the smeared edge shimmering frame to
              frame was half of what looked like flicker. */}
          <span className="film-strip-lit absolute inset-y-0 left-0" style={{ width: `${value * 10}%` }} />
          <motion.span
            style={{ left: `${value * 10}%`, marginLeft: -13, opacity: bloom, scale: spread }}
            className="absolute -top-[7px] h-[24px] w-[26px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,231,180,0.9),transparent_70%)] transition-[left] duration-[130ms] ease-beam"
          />
        </span>

        {/* The gate. Held, it grows in the frame and burns hotter; focused by
            keyboard, it takes the ring the input gave up. */}
        <span
          aria-hidden
          style={{ left: `calc(0.5rem + (100% - 1rem) * ${value / 10})` }}
          className={cn(
            'film-gate pointer-events-none absolute top-1 -ml-[2px] h-[26px] w-[4px]',
            'transition-[left,transform,box-shadow] duration-[130ms] ease-beam',
            'peer-active:scale-y-[1.16] peer-active:shadow-[0_0_0_1px_rgba(4,5,10,0.9),0_2px_10px_rgba(0,0,0,0.8),0_0_22px_rgba(255,214,150,0.7)]',
            'peer-focus-visible:shadow-[0_0_0_2px_theme(colors.dye.brass),0_0_18px_rgba(255,214,150,0.5)]'
          )}
        />
      </div>
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
  weight,
  canSave,
  saving,
  saved,
  isUpdate,
  onSave,
  onReset,
  onSeeHistory,
}: {
  hasMovie: boolean;
  final: number;
  sum: number;
  /** The divisor: how many questions this card is asking. */
  weight: number;
  canSave: boolean;
  saving: boolean;
  saved: boolean;
  isUpdate: boolean;
  onSave: () => void;
  onReset: () => void;
  onSeeHistory: () => void;
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
        {/* The arithmetic, printed rather than hidden — and the divisor is read
            off the card instead of being a constant in this line, because it is
            one now: a take answers eleven questions today and answered ten
            before Aproveitamento existed. */}
        <p className="q ml-auto pb-1 text-[11px] text-ink-dim lg:ml-0 lg:mt-3 lg:pb-0">
          {hasMovie ? `${fmt(sum)} pontos ÷ ${weight} critérios` : '11 critérios, todos iguais'}
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

      {/* ── the receipt, where the hand is ──────────────────────────────────
          It used to be printed at the top of the page. The button that produces
          it is here — sticky at the foot of a phone, sticky at the side of a
          laptop — so the confirmation appeared entirely off-screen, and the
          only way to learn that anything had happened was to scroll up and
          look. A message about an action belongs where the action was. */}
      <AnimatePresence>
        {saved ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="status"
            /* Green, because this is the one message in the product that says
               something went right. It was wearing the red the destructive
               actions wear, which made a saved rating look like a warning
               about a saved rating. */
            className="mt-4 rounded-cell bg-dye-green/10 px-3 py-2.5 text-[12.5px] leading-relaxed ring-1 ring-dye-green/40"
          >
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 flex-none rounded-full bg-dye-green shadow-[0_0_10px_rgba(47,158,68,0.9)]" />
              <strong className="font-semibold">Gravado.</strong>
            </span>
            <p className="mt-1 text-ink-dim">
              Sua nota entrou no histórico do clube. Mexer nos critérios e gravar de novo substitui esta
              avaliação.
            </p>
            <button
              type="button"
              onClick={onSeeHistory}
              className="mt-2 font-display text-[11px] uppercase tracking-[0.14em] text-dye-green-lit underline underline-offset-4 transition-colors hover:text-beam"
            >
              Ver no histórico
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </aside>
  );
}
