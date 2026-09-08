import { memo, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, Check, Info, Trash2, X } from 'lucide-react';
import { CardBody, CardContainer, CardItem } from '@/components/ui/3d-card-effect';
import { Fault, IconKey, Key, Poster, Skeleton, Strip, TrailerKey } from '@/components/bits';
import { api, fmt, runtimeOf, type Movie } from '@/lib/api';
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
            aria-label={`Ver detalhes de ${movie.title}`}
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
          {/* ── o nome de procurar ──────────────────────────────────────────
              A step quieter than the title and a step above the year, because
              it is the same fact as the title and not a new one — the card must
              not read as a film with two names. Truncated at one line: a card
              is 178px wide and a long original title would push the score bar
              down and break the grid's rhythm; the `title` attribute keeps the
              whole string for the pointer, and it is selectable text either
              way, which is the point of putting it here. */}
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
          <OnCell watch={movie.watch} />
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
      aria-label="Detalhes do filme"
      onClick={e => {
        if (e.target === ref.current) onClose();
      }}
      /* ── um rolador só, e ele é a placa ────────────────────────────────
         O `<dialog>` também rolava: o navegador dá a ele `overflow: auto` e um
         `max-height` próprio, bem menor que a tela. A placa aqui dentro pedia
         mais que isso, então o conteúdo transbordava e os dois viravam caixa de
         rolagem, uma dentro da outra.

         No mouse é uma barra feia a mais; no dedo é o travamento — cada toque
         tem de ser resolvido entre dois roladores aninhados antes de mover um
         pixel.

         `max-h-[calc(100dvh/var(--ui-zoom))]` derruba o teto do navegador e
         `overflow-hidden` tira o diálogo da disputa. O teto da placa desconta o
         recuo do diálogo em cada tamanho — 1rem no telefone, 2rem daí para
         cima. `overscroll-contain` fecha a última porta: sem ele, chegar ao fim
         desta lista passa o gesto para a página atrás da folha.

         E o fundo não é desfocado, pelo mesmo motivo da marquise: o
         `::backdrop` cobre a tela inteira, e atrás dele fica a parede de
         celuloide, que nunca para. Um `backdrop-filter` sobre conteúdo que muda
         todo quadro é um borrão de tela cheia refeito todo quadro. */
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
              {/* On its own line and not appended to the year, because it is a
                  name and the line under it is a row of facts. It wraps freely
                  here — the sheet has the width the card did not. */}
              {movie.original ? (
                <p className="q mt-1.5 pr-10 text-[13px] text-ink-dim">{movie.original}</p>
              ) : null}
              {/* Year, length, director — the three facts you want before
                  committing an evening, in the order you want them. The runtime
                  only comes from the details endpoint, so on the rare sheet
                  served from cache without one the middle term simply is not
                  printed rather than showing a dash for it. */}
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
              </div>

              <Verdicts club={clubAvg} clubCount={clubCount} crowd={movie.crowd} />

              <p className="mt-4 max-w-[66ch] text-[13.5px] leading-relaxed text-ink-dim">
                {movie.overview || 'Sem sinopse disponível no TMDB.'}
              </p>
              {movie.cast?.length ? (
                <p className="mt-3 text-[12px] text-ink-dim">Elenco: {movie.cast.map(c => c.name).join(', ')}</p>
              ) : null}
              {movie.trailerUrl ? (
                <TrailerKey url={movie.trailerUrl} title={movie.title} className="mt-3" />
              ) : null}

              <WatchOn watch={movie.watch} />

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

/* A mesma resposta da folha de projeção, no tamanho que um cartaz aguenta:
   marcas, sem nomes. Um cartaz é escaneado e não lido — o olho desce a grade
   procurando o que ver hoje, e nessa velocidade um logo é mais rápido que o
   próprio nome.

   Os nomes não se perdem, mudam de lugar: cada marca carrega um como `title` e
   como alt. Cortado em quatro, que é onde uma fileira de marcas deixa de ser um
   relance — "+2" é legível e um quinto quadrado de 18px não é. */
function OnCell({ watch }: { watch: Movie['watch'] }) {
  if (!watch?.streaming.length) return null;
  const shown = watch.streaming.slice(0, 4);
  const rest = watch.streaming.length - shown.length;

  return (
    <div className="mt-2 flex items-center gap-1">
      {shown.map(p =>
        p.logo ? (
          <img
            key={p.id}
            src={p.logo}
            alt={p.name}
            title={p.name}
            width={18}
            height={18}
            loading="lazy"
            className="h-[18px] w-[18px] flex-none rounded-[2px] ring-1 ring-white/10"
          />
        ) : (
          <span key={p.id} className="q text-[10.5px] text-ink-dim">
            {p.name}
          </span>
        )
      )}
      {rest > 0 ? <span className="q text-[10.5px] text-ink-faint">+{rest}</span> : null}
    </div>
  );
}

/* ── o clube contra a multidão ────────────────────────────────────────────
   Duas médias na mesma régua 0–10, lado a lado, com a distância entre elas dita
   em voz alta.

   O produto inteiro é a premissa de que o veredito deste clube vale por si. Um
   número de que discordar é o que torna essa premissa visível: "a gente deu 6,2
   e o TMDB deu 8,1" é uma discussão esperando para acontecer na mesa.

   Chamado de TMDB e não "o mundo", porque é o que ele é: os votantes de um
   site. E a contagem não é enfeite — um 9,0 de onze pessoas e um 9,0 de
   quatrocentas mil são afirmações diferentes. */
function Verdicts({
  club,
  clubCount,
  crowd,
}: {
  club: number | null | undefined;
  clubCount: number | null | undefined;
  crowd: Movie['crowd'];
}) {
  /* Compact, in Portuguese: 12.345 votos reads as "12 mil". The exact figure is
     noise at this size — the order of magnitude is the whole message. */
  const votes = (n: number) =>
    new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

  const gap = club != null && crowd ? club - crowd.score : null;
  /* Under a quarter of a point is the two agreeing. Naming a gap that small as
     a disagreement would manufacture a fight out of rounding. */
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

/* ── onde a gente assiste isso ────────────────────────────────────────────
   A pergunta que o clube de fato faz sobre um filme que não viu. O TMDB carrega
   a resposta, licenciada do JustWatch, separada por COMO se chega ao filme — e
   essa separação é o ponto: "está incluído em algo que você já paga" e "dá para
   alugar" são respostas diferentes.

   Ausente num filme vindo do cache: ele deliberadamente não guarda isto, porque
   um catálogo se move e uma resposta errada com confiança é pior que nenhuma.

   O crédito não é enfeite — usar estes dados obriga a nomear o JustWatch —, e o
   link de saída é a página do próprio TMDB, que cai nas lojas de verdade em vez
   de adivinhar um link fundo num serviço que o leitor talvez nem tenha. */
function WatchOn({ watch }: { watch: Movie['watch'] }) {
  /* Três estados, e dois deles são nulos. `undefined` é "ninguém perguntou": o
     filme veio do cache porque o TMDB estava fora. `null` é "perguntamos, e não
     passa em lugar nenhum aqui" — uma resposta de verdade.

     Eram desenhados igual até um filme em cartaz tornar a diferença visível: a
     folha simplesmente terminava depois do trailer, que lê exatamente como o
     recurso não existir. A resposta negativa é dita em voz alta e a
     desconhecida fica calada. */
  if (watch === undefined) return null;

  if (!watch) {
    return (
      <div className="mt-5 border-t border-white/[0.07] pt-4">
        <span className="legend">Onde assistir</span>
        <p className="mt-2 text-[12.5px] text-ink-dim">
          Não está em nenhum streaming no Brasil — ainda em cartaz, ou só para alugar.
        </p>
        <Credit link={null} />
      </div>
    );
  }

  return (
    <div className="mt-5 border-t border-white/[0.07] pt-4">
      {/* The caption sits on its own line rather than at the head of the row.
          Sharing the line meant a fixed-width label with wrapping chips beside
          it, and the moment the chips wrapped they ran back under the label —
          which is what was reading as the logos piling on each other. A caption
          above and a plain wrap below cannot do that at any width. */}
      <span className="legend">Onde assistir</span>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {watch.streaming.map(p => (
          <span
            key={p.id}
            /* `shrink-0` so a long name never squeezes the mark next to it into
               the one after; the row wraps instead, which is what it is for. */
            className="flex shrink-0 items-center gap-2 rounded-cell bg-house-deep/70 py-1 pl-1 pr-2.5 ring-1 ring-house-rail"
          >
            {/* Decorative: the name is in text right beside it, so a reader who
                cannot see the mark is not told the same thing twice. */}
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
          </span>
        ))}
      </div>
      <Credit link={watch.link} />
    </div>
  );
}

/* The attribution, on both answers. Using this data obliges us to name
   JustWatch as its source, and "não está em nenhum streaming" is as much their
   answer as a list of logos is — it is the same query, returning nothing. */
function Credit({ link }: { link: string | null }) {
  const out = 'underline underline-offset-2 transition-colors hover:text-ink-dim';
  return (
    <p className="q mt-3 text-[11px] text-ink-faint">
      Disponibilidade no Brasil, por{' '}
      <a href="https://www.justwatch.com" target="_blank" rel="noopener noreferrer" className={out}>
        JustWatch
      </a>
      {link ? (
        <>
          {' · '}
          <a href={link} target="_blank" rel="noopener noreferrer" className={out}>
            ver onde
          </a>
        </>
      ) : null}
    </p>
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
