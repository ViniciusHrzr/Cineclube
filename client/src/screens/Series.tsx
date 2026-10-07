import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  Layers,
  MessageSquare,
  Plus,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import { CardBody, CardContainer, CardItem } from '@/components/ui/3d-card-effect';
import {
  Bill,
  Blank,
  Chip,
  Drawer,
  Fault,
  IconKey,
  Key,
  Poster,
  Reel,
  ReelPicker,
  SearchField,
  Skeleton,
  Strip,
  TrailerKey,
} from '@/components/bits';
import { Channels, Gauge } from '@/components/channels';
import { OnCell, WatchOn } from '@/components/film';
import { Conversation, TakeVotes } from '@/components/social';
import { Breakdown } from '@/components/take';
import { PersonName, PersonReel } from '@/components/person';
import {
  fmt,
  initialsOf,
  reelColor,
  seriesApi,
  shows as showsApi,
  type Criterion,
  type Episode,
  type EpisodeRef,
  type QueuedShow,
  type Reviewer,
  type SeasonDetail,
  type SeasonPatch,
  type SeriesItem,
  type SessionUser,
  type ShowDetail,
  type ShowFeedEvent,
  type ShowTake,
  showsSocial,
} from '@/lib/api';
import { useLive } from '@/lib/live';
import { cn, clockOf, dayOf, plural, whenOf } from '@/lib/utils';
import { useWorld } from '@/lib/world';
import { SuggestionsKey } from '@/screens/Reels';
import type { TabId } from '@/App';

export function SeriesCatalogScreen({
  queued,
  onQueue,
  onOpen,
  onTab,
  fault,
}: {
  queued: Set<number>;
  onQueue: (s: SeriesItem) => void;
  onOpen: (showId: number) => void;
  onTab: (t: TabId) => void;
  fault: (msg: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('Todos');
  const [items, setItems] = useState<SeriesItem[] | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const busca = query.trim();

  useEffect(() => {
    let vivo = true;
    setItems(null);
    const pedido = busca
      ? seriesApi.search(busca, page)
      : genre === 'Todos'
        ? seriesApi.popular(page)
        : seriesApi.byGenre(genre, page);
    void pedido
      .then(r => {
        if (!vivo) return;
        setItems(r.results);
        setTotalPages(r.totalPages);
      })
      .catch(e => {
        if (!vivo) return;
        setItems([]);
        fault('Não foi possível falar com o TMDB: ' + (e as Error).message);
      });
    return () => {
      vivo = false;
    };
  }, [busca, genre, page, fault]);

  const cut = `${busca}|${genre}`;
  const lastCut = useRef(cut);
  if (lastCut.current !== cut) {
    lastCut.current = cut;
    if (page !== 1) setPage(1);
  }

  return (
    <section>
      <Bill
        title="Catálogo"
        note={busca ? `buscando "${busca}"` : 'as séries mais vistas no TMDB'}
      />

      {}
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <div className="min-w-[240px] max-w-[440px] flex-1">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Buscar uma série…"
            hint={busca ? 'busca no TMDB, não no que o clube já viu' : undefined}
          />
        </div>
        <SuggestionsKey onOpen={() => onTab('sugestoes')} />
      </div>

      {}
      {!busca ? (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {['Todos', ...GENRES].map(g => (
            <Chip key={g} size="sm" on={genre === g} onClick={() => setGenre(g)}>
              {g}
            </Chip>
          ))}
        </div>
      ) : null}

      {!items ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {[0, 1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="aspect-[2/3] w-full" />
          ))}
        </div>
      ) : !items.length ? (
        <Blank title="Nenhuma série com esse nome">
          Tente o título original, se souber — o TMDB indexa os dois.
        </Blank>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {items.map(s => (
              <li key={s.id}>
                <SeriesCell
                  show={s}
                  inQueue={queued.has(s.id)}
                  onOpen={() => onOpen(s.id)}
                  onQueue={() => onQueue(s)}
                />
              </li>
            ))}
          </ul>
          {totalPages > 1 ? (
            <div className="mt-8 flex items-center gap-3">
              <Key tone="ghost" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                Anterior
              </Key>
              <span className="q text-[12px] text-ink-dim">
                {page} de {totalPages.toLocaleString('pt-BR')}
              </span>
              <Key tone="ghost" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                Próxima
              </Key>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

const GENRES = [
  'Ação', 'Animação', 'Comédia', 'Documentário', 'Drama',
  'Ficção científica', 'Romance', 'Suspense', 'Terror',
];

function SeriesCell({
  show,
  inQueue,
  seen,
  average,
  upNext,
  upcoming,
  caughtUp,
  wants,
  onOpen,
  onQueue,
  onRemove,
}: {
  show: SeriesItem;
  inQueue?: boolean;
  seen?: string | null;
  average?: number | null;
  upNext?: EpisodeRef | null;
  upcoming?: EpisodeRef | null;
  caughtUp?: boolean;
  wants?: Reviewer[];
  onOpen: () => void;
  onQueue?: () => void;
  onRemove?: () => void;
}) {
  return (
    <CardContainer containerClassName="block h-full w-full" className="h-full w-full">
      <CardBody className="flex h-full w-full flex-col">
        <CardItem translateZ={60} className="w-full">
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Ver as temporadas de ${show.title}`}
            className="group/cell block w-full text-left"
          >
            {}
            <span className="relative block overflow-hidden rounded-cell">
              <Poster src={show.poster} alt={`Pôster de ${show.title}`} className="aspect-[2/3] w-full" />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 flex translate-y-full items-center justify-center gap-1.5 bg-beam px-2 py-2 font-display text-[11px] uppercase tracking-[0.14em] text-house-deep transition-transform duration-200 ease-beam group-hover/cell:translate-y-0 group-focus-visible/cell:translate-y-0 motion-reduce:transition-none">
                <Layers className="h-3.5 w-3.5" strokeWidth={2} />
                Temporadas
              </span>
              {}
              {wants?.length ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute bottom-1.5 left-1.5 flex items-center gap-[3px] rounded-cell bg-house-deep/90 p-[3px] ring-1 ring-white/10"
                >
                  {wants.slice(0, ROSTOS).map(p => (
                    <Reel key={p.id} color={reelColor(p.dot, p.id)} src={p.avatar ?? null} size="sm">
                      {initialsOf(p.name)}
                    </Reel>
                  ))}
                  {wants.length > ROSTOS ? (
                    <span className="q px-[3px] text-[10px] leading-none text-ink-dim">
                      +{wants.length - ROSTOS}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </span>
          </button>
        </CardItem>

        <CardItem translateZ={30} className="mt-3 w-full">
          <h3 className="text-[14px] font-semibold leading-tight text-ink">{show.title}</h3>
          {show.original ? (
            <p className="q mt-0.5 truncate text-[11px] text-ink-faint" title={show.original}>
              {show.original}
            </p>
          ) : null}
          <p className="q mt-0.5 text-[11.5px] text-ink-dim">
            {show.year ?? '—'} · {show.genre}
          </p>
          {}
          <OnCell watch={show.watch} title={show.title} />
          {}
          {seen ? (
            <div className="mt-2 flex items-center gap-2">
              {average != null ? (
                <>
                  <Strip value={average} cells={10} className="h-[5px] flex-1" />
                  <span className="q text-[11.5px] text-beam">{fmt(average)}</span>
                </>
              ) : (
                <span className="q flex-1 text-[11.5px] text-ink-dim">sem nota ainda</span>
              )}
            </div>
          ) : null}
          {seen ? <p className="q mt-1 text-[11px] text-ink-faint">{seen}</p> : null}
        </CardItem>

        {}
        <CardItem translateZ={18} className="mt-auto flex w-full items-center gap-2 pt-3">
          <Key tone="flush" className="flex-1 px-2" onClick={onOpen}>
            Episódios
          </Key>
          {onQueue ? (
            <IconKey
              active={inQueue}
              aria-pressed={inQueue}
              aria-label={inQueue ? `${show.title} já está na lista` : `Acompanhar ${show.title}`}
              onClick={onQueue}
            >
              <Bookmark
                className="h-4 w-4"
                fill={inQueue ? 'currentColor' : 'none'}
                strokeWidth={1.7}
              />
            </IconKey>
          ) : null}
          {onRemove ? (
            <IconKey aria-label={`Tirar ${show.title} da lista`} onClick={onRemove}>
              <Trash2 className="h-4 w-4" strokeWidth={1.7} />
            </IconKey>
          ) : null}
        </CardItem>

        {}
        <CardItem translateZ={12} className="w-full">
          <UpNext upNext={upNext} upcoming={upcoming} caughtUp={caughtUp} />
        </CardItem>
      </CardBody>
    </CardContainer>
  );
}

function UpNext({
  upNext,
  upcoming,
  caughtUp,
}: {
  upNext?: EpisodeRef | null;
  upcoming?: EpisodeRef | null;
  caughtUp?: boolean;
}) {
  if (upNext) {
    return (
      <Strap>
        <span className="legend text-[9px] text-ink-faint">a seguir</span>{' '}
        <span className="q text-[12.5px] font-medium text-dye-brass">{tag(upNext)}</span>
        {upNext.title ? <span className="text-[12px] text-ink"> {upNext.title}</span> : null}
      </Strap>
    );
  }

  if (upcoming) {
    return (
      <Strap>
        <span className="legend text-[9px] text-ink-faint">estreia</span>{' '}
        <span className="q text-[12.5px] font-medium text-beam">{tag(upcoming)}</span>{' '}
        <span className="q text-[12px] text-ink-dim">
          {upcoming.airDate ? soonBR(upcoming.airDate) : 'sem data'}
        </span>
      </Strap>
    );
  }

  if (caughtUp) {
    return (
      <Strap>
        <span className="q text-[12px] text-ink-faint">você viu tudo</span>
      </Strap>
    );
  }

  return null;
}

function Strap({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 line-clamp-2 min-h-[44px] break-words border-t border-white/[0.07] pt-2.5 text-[12px] leading-snug">
      {children}
    </p>
  );
}

const tag = (ep: EpisodeRef) => `T${ep.season}E${String(ep.episode).padStart(2, '0')}`;

function soonBR(iso: string) {
  const at = new Date(iso + 'T12:00:00');
  if (Number.isNaN(at.getTime())) return iso;
  const hoje = new Date();
  const dias = Math.round((at.getTime() - new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 12).getTime()) / 86400000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'amanhã';
  if (dias <= 14) return `em ${dias} dias`;
  return at.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: at.getFullYear() === hoje.getFullYear() ? undefined : 'numeric',
  });
}

const ROSTOS = 3;

const NINGUEM = '\0sem-dono';

export function SeriesQueueScreen({
  shows,
  roster,
  me,
  onOpen,
  onRemove,
}: {
  shows: QueuedShow[] | null;
  roster: Reviewer[];
  me: SessionUser;
  onOpen: (showId: number) => void;
  onRemove: (showId: number) => void;
}) {
  const [quem, setQuem] = useState<string | null>(me.id);

  const { donos, orfas } = useMemo(() => {
    const conta = new Map<string, number>();
    for (const s of shows ?? []) {
      const seus = s.wanters.filter(id => roster.some(p => p.id === id));
      for (const dono of seus.length ? seus : [NINGUEM]) {
        conta.set(dono, (conta.get(dono) ?? 0) + 1);
      }
    }
    return {
      donos: roster
        .map(p => ({ ...p, count: conta.get(p.id) ?? 0 }))
        .filter(p => p.count > 0),
      orfas: conta.get(NINGUEM) ?? 0,
    };
  }, [shows, roster]);

  if (quem && quem !== NINGUEM && !donos.some(d => d.id === quem)) setQuem(null);
  if (quem === NINGUEM && !orfas) setQuem(null);

  const naTela = (shows ?? []).filter(s => {
    if (!quem) return true;
    const seus = s.wanters.filter(id => roster.some(p => p.id === id));
    return seus.length ? seus.includes(quem) : quem === NINGUEM;
  });

  const quemSegue = (s: QueuedShow) =>
    s.wanters
      .map(id => roster.find(p => p.id === id))
      .filter((p): p is Reviewer => !!p);

  if (!shows) {
    return (
      <section>
        <Bill title="Minhas séries" note="carregando…" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {[0, 1, 2].map(i => <Skeleton key={i} className="aspect-[2/3] w-full" />)}
        </div>
      </section>
    );
  }

  if (!shows.length) {
    return (
      <section>
        <Bill title="Minhas séries" />
        <Blank title="O clube ainda não acompanha nenhuma série">
          Ache uma no catálogo e marque para acompanhar. O que o clube combinar de ver aparece
          aqui, com o quanto já foi visto.
        </Blank>
      </section>
    );
  }

  return (
    <section>
      <Bill
        title="Minhas séries"
        note={
          quem
            ? `${naTela.length} de ${plural(shows.length, 'série', 'séries')}`
            : `${plural(shows.length, 'série', 'séries')} que o clube acompanha`
        }
      />

      {}
      {donos.length || orfas ? (
        <div className="mb-5">
          <ReelPicker
            title="Quem acompanha"
            value={quem}
            onPick={setQuem}
            choices={[
              { id: null, label: 'Todos', count: shows.length, hint: 'Ver a lista inteira' },
              ...donos.map(d => ({
                id: d.id,
                label: d.name,
                count: d.count,
                hint: `Ver só o que ${d.name} acompanha`,
                reel: (
                  <Reel color={reelColor(d.dot, d.id)} src={d.avatar ?? null} size="md">
                    {initialsOf(d.name)}
                  </Reel>
                ),
              })),
              ...(orfas
                ? [
                    {
                      id: NINGUEM,
                      label: 'Sem registro',
                      count: orfas,
                      hint: 'Ver só o que a lista não sabe de quem é',
                    },
                  ]
                : []),
            ]}
          />
        </div>
      ) : null}

      {!naTela.length ? (
        <Blank title="Nada nesta lista por essa pessoa">
          Escolha <span className="text-ink">Todos</span> para ver o que o clube inteiro acompanha.
        </Blank>
      ) : null}

      {}
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
        {naTela.map(s => {
          const segue = quemSegue(s);
          return (
            <li key={s.id}>
              <SeriesCell
                show={{
                  id: s.id,
                  title: s.title,
                  original: s.original,
                  year: s.year,
                  genre: s.genre,
                  genres: [s.genre],
                  poster: s.poster,
                  crowd: null,
                  watch: s.watch,
                }}
                seen={
                  s.totalEpisodes ? `${s.seen}/${s.totalEpisodes} vistos` : `${s.seen} vistos`
                }
                average={s.average}
                upNext={s.upNext}
                upcoming={s.upcoming}
                caughtUp={s.caughtUp}
                wants={segue}
                onOpen={() => onOpen(s.id)}
                onRemove={
                  segue.some(p => p.id === me.id) || me.isAdmin
                    ? () => onRemove(s.id)
                    : undefined
                }
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ShowScreen({
  showId,
  takes,
  criteria,
  meId,
  inQueue,
  onQueue,
  onBack,
  onSaved,
  fault,
}: {
  showId: number;
  takes: ShowTake[];
  criteria: Record<string, Criterion[]> | null;
  meId: string;
  inQueue: boolean;
  onQueue: (s: { id: number; title: string; year: number | null; genre: string; poster: string | null }) => void;
  onBack: () => void;
  onSaved: () => void;
  fault: (msg: string) => void;
}) {
  const [show, setShow] = useState<ShowDetail | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [temporada, setTemporada] = useState<SeasonDetail | null>(null);
  const [avaliando, setAvaliando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setShow(null);
    setErro(null);
    void seriesApi
      .show(showId)
      .then(r => {
        if (!vivo) return;
        setShow(r.show);
        setSeason(r.show.seasons?.[0]?.season ?? null);
      })
      .catch(e => vivo && setErro((e as Error).message));
    return () => {
      vivo = false;
    };
  }, [showId]);

  useEffect(() => {
    if (season == null) return;
    let vivo = true;
    setTemporada(null);
    void seriesApi
      .season(showId, season)
      .then(r => vivo && setTemporada(r.season))
      .catch(e => vivo && fault('Não foi possível carregar a temporada: ' + (e as Error).message));
    return () => {
      vivo = false;
    };
  }, [showId, season, fault]);

  const meusVistos = useMemo(
    () =>
      new Set(
        takes
          .filter(t => t.kind === 'episode' && t.reviewerId === meId)
          .map(t => `${t.season}x${t.episode}`)
      ),
    [takes, meId]
  );

  const porEpisodio = useMemo(() => {
    const mapa = new Map<string, ShowTake[]>();
    for (const t of takes) {
      if (t.kind !== 'episode') continue;
      const chave = `${t.season}x${t.episode}`;
      const lista = mapa.get(chave);
      if (lista) lista.push(t);
      else mapa.set(chave, [t]);
    }
    return mapa;
  }, [takes]);

  const daTemporada = useMemo(
    () => takes.filter(t => t.kind === 'season' && t.season === season),
    [takes, season]
  );

  if (erro) {
    return (
      <section>
        <Key tone="flush" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
          Voltar
        </Key>
        <div className="mt-5 max-w-[60ch]">
          <Fault detail={erro}>Não foi possível abrir esta série.</Fault>
        </div>
      </section>
    );
  }

  if (!show) {
    return (
      <section>
        <div className="flex gap-5">
          <Skeleton className="aspect-[2/3] w-[120px] flex-none" />
          <div className="flex-1 space-y-3 pt-2">
            <Skeleton className="h-6 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-2.5 w-full" />
            <Skeleton className="h-2.5 w-5/6" />
          </div>
        </div>
      </section>
    );
  }

  const genero = show.genre;

  return (
    <section>
      <Key tone="flush" onClick={onBack}>
        <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
        Voltar
      </Key>

      <header className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-start">
        <Poster
          src={show.poster}
          alt={`Pôster de ${show.title}`}
          className="aspect-[2/3] w-[120px] flex-none sm:w-[150px]"
        />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[30px] leading-none tracking-[0.03em] text-beam sm:text-[38px]">
            {show.title}
          </h1>
          {show.original ? (
            <p className="q mt-1.5 text-[12.5px] text-ink-dim">{show.original}</p>
          ) : null}
          <p className="q mt-2 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-dim">
            <span>{show.year ?? '—'}</span>
            <span aria-hidden>·</span>
            <span>{show.genre}</span>
            {show.totalEpisodes ? (
              <>
                <span aria-hidden>·</span>
                <span>{plural(show.totalEpisodes, 'episódio', 'episódios')}</span>
              </>
            ) : null}
            {}
            {show.inProduction ? (
              <>
                <span aria-hidden>·</span>
                <span className="text-dye-brass">em exibição</span>
              </>
            ) : null}
          </p>
          {show.creators.length ? (
            <p className="q mt-1.5 text-[12px] text-ink-faint">
              criada por {show.creators.join(' · ')}
            </p>
          ) : null}

          {show.overview ? (
            <p className="mt-4 max-w-[66ch] text-[13px] leading-relaxed text-ink-dim">
              {show.overview}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Key
              tone={inQueue ? 'ghost' : 'flush'}
              disabled={inQueue}
              onClick={() =>
                onQueue({
                  id: show.id,
                  title: show.title,
                  year: show.year,
                  genre: show.genre,
                  poster: show.poster,
                })
              }
            >
              {inQueue ? <Check className="h-3.5 w-3.5" strokeWidth={2.2} /> : <Plus className="h-3.5 w-3.5" strokeWidth={2} />}
              {}
              {inQueue ? 'Você acompanha' : 'Acompanhar'}
            </Key>
            {show.trailerUrl ? (
              <TrailerKey
                url={show.trailerUrl}
                title={show.title}
                className="rounded-cell px-2 py-1.5 tracking-[0.12em]"
              >
                Trailer
              </TrailerKey>
            ) : null}
          </div>

          {}
          <WatchOn watch={show.watch} title={show.title} />

          <ShowRoster takes={takes} />
        </div>
      </header>

      {}
      {show.seasons === null ? (
        <p className="mt-8 text-[13px] leading-relaxed text-ink-dim">
          O TMDB não respondeu agora, então as temporadas não puderam ser lidas. O que o clube
          já gravou continua no acervo.
        </p>
      ) : show.seasons.length ? (
        <>
          <div className="mt-8 flex flex-wrap items-center gap-2">
            {show.seasons.map(s => (
              <Chip key={s.season} size="sm" on={s.season === season} onClick={() => setSeason(s.season)}>
                {`T${s.season}`}
              </Chip>
            ))}
          </div>

          {}
          {season != null ? (
            <SeasonPanel
              season={season}
              name={temporada?.name ?? null}
              takes={daTemporada}
              meId={meId}
              onRate={() => setAvaliando(true)}
            />
          ) : null}

          {!temporada ? (
            <div className="mt-6 flex flex-col gap-2">
              {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[76px] w-full" />)}
            </div>
          ) : (
            <>
              {}
              <div className="mt-6 flex justify-end pr-2">
                <MarkSeason
                  episodes={temporada.episodes}
                  mine={meusVistos}
                  showId={show.id}
                  showTitle={show.title}
                  showPoster={show.poster}
                  genre={genero}
                  onSaved={onSaved}
                  fault={fault}
                />
              </div>

              <ul className="mt-2 flex flex-col">
                {temporada.episodes.map(ep => (
                  <EpisodeRow
                    key={`${ep.season}x${ep.episode}`}
                    ep={ep}
                    takes={porEpisodio.get(`${ep.season}x${ep.episode}`) ?? []}
                    meId={meId}
                    showId={show.id}
                    showTitle={show.title}
                    showPoster={show.poster}
                    genre={genero}
                    onSaved={onSaved}
                    fault={fault}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <p className="mt-8 text-[13px] text-ink-dim">Esta série não tem temporadas listadas no TMDB.</p>
      )}

      {avaliando && season != null ? (
        <SeasonSheet
          key={season}
          showId={show.id}
          showTitle={show.title}
          showPoster={show.poster}
          genre={genero}
          season={season}
          name={temporada?.name ?? null}
          overview={temporada?.overview ?? null}
          takes={daTemporada}
          meId={meId}
          criteria={criteria?.[genero] ?? null}
          onClose={() => setAvaliando(false)}
          onSaved={onSaved}
          fault={fault}
        />
      ) : null}
    </section>
  );
}

function ShowRoster({ takes }: { takes: ShowTake[] }) {
  const gente = useMemo(() => {
    const mapa = new Map<
      string,
      { id: string; nome: string; dot: string | null; vistos: number; notas: number }
    >();
    for (const t of takes) {
      const achado = mapa.get(t.reviewerId) ?? {
        id: t.reviewerId,
        nome: t.reviewerName ?? 'alguém',
        dot: t.reviewerDot ?? null,
        vistos: 0,
        notas: 0,
      };
      if (t.kind === 'season') {
        if (t.final != null) achado.notas += 1;
      } else achado.vistos += 1;
      mapa.set(t.reviewerId, achado);
    }
    return [...mapa.values()].sort((a, b) => b.vistos - a.vistos || b.notas - a.notas);
  }, [takes]);

  if (!gente.length) return null;

  return (
    <div className="mt-5">
      <p className="legend mb-2.5">{plural(gente.length, 'pessoa aqui', 'pessoas aqui')}</p>
      <ul className="flex flex-wrap gap-2">
        {gente.map(p => (
          <li
            key={p.id}
            className="flex items-center gap-2 rounded-cell bg-house-seat/55 py-1 pl-1 pr-2.5 ring-1 ring-inset ring-white/[0.06]"
          >
            <PersonReel person={{ id: p.id, name: p.nome, dot: p.dot }} size="sm" />
            <PersonName
              person={{ id: p.id, name: p.nome, dot: p.dot }}
              className="font-display text-[12px] uppercase tracking-[0.1em] text-ink"
            />
            <span className="q text-[11.5px] text-ink-dim">
              {p.vistos ? `${p.vistos} ep` : null}
              {p.vistos && p.notas ? ' · ' : null}
              {p.notas ? plural(p.notas, 'nota', 'notas') : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const LANES_MARCAR = 4;

function MarkSeason({
  episodes,
  mine,
  showId,
  showTitle,
  showPoster,
  genre,
  onSaved,
  fault,
}: {
  episodes: Episode[];
  mine: Set<string>;
  showId: number;
  showTitle: string;
  showPoster: string | null;
  genre: string;
  onSaved: () => void;
  fault: (msg: string) => void;
}) {
  const [marcando, setMarcando] = useState(false);

  const hoje = new Date().toISOString().slice(0, 10);
  const faltando = episodes.filter(
    e => !mine.has(`${e.season}x${e.episode}`) && (!e.airDate || e.airDate <= hoje)
  );

  if (!faltando.length) return null;

  const marcar = async () => {
    if (marcando) return;
    if (
      !confirm(
        `Marcar ${plural(faltando.length, 'episódio', 'episódios')} desta temporada como assistido?`
      )
    ) {
      return;
    }
    setMarcando(true);
    const fila = [...faltando];
    let falhou = 0;
    try {
      await Promise.all(
        Array.from({ length: Math.min(LANES_MARCAR, fila.length) }, async () => {
          while (fila.length) {
            const ep = fila.shift()!;
            try {
              await showsApi.mark(showId, ep.season, ep.episode, {
                showTitle,
                showPoster,
                episodeTitle: ep.title,
                genre,
              });
            } catch {
              falhou += 1;
            }
          }
        })
      );
    } finally {
      setMarcando(false);
      onSaved();
      if (falhou) fault(`${plural(falhou, 'episódio ficou', 'episódios ficaram')} sem marcar.`);
    }
  };

  return (
    <Key tone="flush" disabled={marcando} onClick={() => void marcar()} className="px-3 py-1.5">
      <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
      {marcando ? 'Marcando…' : `Marcar ${faltando.length}`}
    </Key>
  );
}

function SeasonPanel({
  season,
  name,
  takes,
  meId,
  onRate,
}: {
  season: number;
  name: string | null;
  takes: ShowTake[];
  meId: string;
  onRate: () => void;
}) {
  const minha = takes.find(t => t.reviewerId === meId) ?? null;
  const comNota = takes.filter(t => t.final != null);
  const media = comNota.length
    ? comNota.reduce((acc, t) => acc + (t.final ?? 0), 0) / comNota.length
    : null;

  const titulo = `Temporada ${season}`;

  return (
    <div className="plate mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
      <div className="min-w-0">
        <p className="font-display text-[15px] uppercase tracking-[0.1em] text-ink">{titulo}</p>
        {name && name !== titulo ? (
          <p className="q mt-0.5 truncate text-[11.5px] text-ink-dim">{name}</p>
        ) : null}
      </div>

      {media != null ? (
        <div className="flex items-center gap-2.5">
          <Strip value={media} cells={10} className="hidden h-[6px] w-[110px] flex-none sm:block" />
          <span className="q text-[20px] font-medium leading-none text-beam">{fmt(media)}</span>
          <span className="q text-[11px] text-ink-faint">
            {plural(comNota.length, 'nota', 'notas')} do clube
          </span>
        </div>
      ) : (
        <p className="q text-[12px] text-ink-dim">o clube ainda não avaliou esta temporada</p>
      )}

      <div className="ml-auto flex items-center gap-2">
        {minha?.final != null ? <MineNote take={minha} /> : null}
        <Key tone={minha ? 'flush' : 'commit'} onClick={onRate}>
          <Star className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
          {minha ? 'Mudar sua nota' : 'Avaliar a temporada'}
        </Key>
      </div>

      {}
      {comNota.length ? (
        <ul className="w-full border-t border-white/[0.07] pt-3">
          {[...comNota]
            .sort((a, b) => (b.final ?? 0) - (a.final ?? 0))
            .map(t => (
              <li key={t.id} className="flex items-baseline gap-2.5 py-1">
                <span
                  className={cn(
                    'font-display text-[12.5px] uppercase tracking-[0.1em]',
                    t.reviewerId === meId ? 'text-dye-brass' : 'text-ink'
                  )}
                >
                  {t.reviewerId === meId ? 'você' : t.reviewerName}
                </span>
                {t.scores ? (
                  <span className="legend text-[9px] text-beam-dim">criteriosa</span>
                ) : null}
                {t.comment ? (
                  <span className="min-w-0 flex-1 truncate text-[12px] italic text-ink-dim">
                    “{t.comment}”
                  </span>
                ) : (
                  <span className="flex-1" />
                )}
                <span className="q text-[13.5px] text-beam">{fmt(t.final ?? 0)}</span>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}

function EpisodeRow({
  ep,
  takes,
  meId,
  showId,
  showTitle,
  showPoster,
  genre,
  onSaved,
  fault,
}: {
  ep: Episode;
  takes: ShowTake[];
  meId: string;
  showId: number;
  showTitle: string;
  showPoster: string | null;
  genre: string;
  onSaved: () => void;
  fault: (msg: string) => void;
}) {
  const world = useWorld();
  const minha = takes.find(t => t.reviewerId === meId) ?? null;
  const outros = takes.filter(t => t.reviewerId !== meId);

  const [aberta, setAberta] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [otimista, setOtimista] = useState<boolean | null>(null);
  useEffect(() => {
    setOtimista(null);
  }, [minha]);
  const visto = otimista ?? minha != null;

  const alternar = useCallback(async () => {
    if (salvando) return;
    const marcar = minha == null;
    setSalvando(true);
    setOtimista(marcar);
    try {
      if (marcar) {
        await showsApi.mark(showId, ep.season, ep.episode, {
          showTitle,
          showPoster,
          episodeTitle: ep.title,
          genre,
        });
      } else {
        await showsApi.unmark(showId, ep.season, ep.episode);
      }
      onSaved();
    } catch (e) {
      setOtimista(null);
      fault(
        (marcar ? 'Não foi possível marcar: ' : 'Não foi possível desmarcar: ') +
          (e as Error).message
      );
    } finally {
      setSalvando(false);
    }
  }, [
    salvando,
    minha,
    showId,
    ep.season,
    ep.episode,
    ep.title,
    showTitle,
    showPoster,
    genre,
    onSaved,
    fault,
  ]);

  const vistoPor = [...takes].sort((a, b) => a.watchedAt.localeCompare(b.watchedAt));

  return (
    <li className="border-t border-white/[0.06] first:border-t-0">
      {}
      <div className="group flex w-full items-center gap-3 rounded-cell px-2 py-3 transition-colors duration-150 hover:bg-beam/[0.05]">
        <button
          type="button"
          aria-expanded={aberta}
          aria-label={`${aberta ? 'Fechar' : 'Abrir'} T${ep.season}E${ep.episode} — ${ep.title}`}
          onClick={() => setAberta(v => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {}
          {ep.still ? (
            <img
              src={ep.still}
              alt=""
              loading="lazy"
              className="aspect-video w-[104px] flex-none rounded-cell object-cover ring-1 ring-white/[0.06]"
            />
          ) : (
            <span aria-hidden className="aspect-video w-[104px] flex-none rounded-cell bg-house-deep ring-1 ring-white/[0.06]" />
          )}

          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="q text-[11.5px] text-ink-dim">
                T{ep.season}E{String(ep.episode).padStart(2, '0')}
              </span>
              <span className="truncate text-[14px] text-ink transition-colors group-hover:text-beam">
                {ep.title}
              </span>
              {}
              {ep.kind === 'finale' ? (
                <span className="legend flex-none text-[9px] text-dye-brass">Final</span>
              ) : null}
            </span>
            <span className="q mt-1 block text-[11px] text-ink-faint">
              {[ep.airDate ? whenBR(ep.airDate) : null, ep.runtime ? `${ep.runtime} min` : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
        </button>

        <div className="flex flex-none items-center gap-2 sm:gap-3">
          {}
          {outros.length ? (
            <span
              aria-hidden
              className="hidden items-center gap-[3px] sm:flex"
            >
              {outros.slice(0, ROSTOS).map(t => (
                <Reel
                  key={t.id}
                  color={reelColor(t.reviewerDot, t.reviewerId)}
                  src={world.avatarOf(t.reviewerId)}
                  size="sm"
                >
                  {initialsOf(t.reviewerName ?? '?')}
                </Reel>
              ))}
              {outros.length > ROSTOS ? (
                <span className="q text-[10px] leading-none text-ink-faint">
                  +{outros.length - ROSTOS}
                </span>
              ) : null}
            </span>
          ) : null}

          <SeenCheck on={visto} busy={salvando} onToggle={() => void alternar()} />

          <ChevronDown
            aria-hidden
            className={cn(
              'h-4 w-4 flex-none text-ink-faint transition-transform duration-200',
              aberta && 'rotate-180'
            )}
            strokeWidth={1.7}
          />
        </div>
      </div>

      {}
      <Drawer open={aberta}>
        <div className="px-2 pb-4 pl-[120px]">
          {ep.overview ? (
            <p className="max-w-[70ch] text-[13px] leading-relaxed text-ink-dim">{ep.overview}</p>
          ) : (
            <p className="text-[13px] text-ink-faint">O TMDB não tem sinopse deste episódio.</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="legend">Quem já viu</span>
            {!vistoPor.length ? (
              <span className="q text-[12px] text-ink-faint">ninguém do clube ainda</span>
            ) : (
              vistoPor.map(t => (
                <span key={t.id} className="flex items-center gap-1.5">
                  <Reel
                    color={reelColor(t.reviewerDot, t.reviewerId)}
                    src={world.avatarOf(t.reviewerId)}
                    size="sm"
                  >
                    {initialsOf(t.reviewerName ?? '?')}
                  </Reel>
                  <span className="text-[12.5px] text-ink">
                    {t.reviewerId === meId ? 'você' : t.reviewerName ?? 'alguém'}
                  </span>
                  <span className="q text-[11px] text-ink-faint">{whenOf(t.watchedAt)}</span>
                </span>
              ))
            )}
          </div>
        </div>
      </Drawer>
    </li>
  );
}

function SeenCheck({ on, busy, onToggle }: { on: boolean; busy: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={on ? 'Visto — clique para desmarcar' : 'Marcar como visto'}
      title={on ? 'Visto — clique para desmarcar' : 'Marcar como visto'}
      disabled={busy}
      onClick={onToggle}
      className={cn(
        'flex h-9 w-9 flex-none items-center justify-center rounded-cell ring-1',
        'coarse:h-11 coarse:w-11',
        'transition-[background-color,color,box-shadow] duration-150 active:translate-y-px',
        'disabled:cursor-not-allowed disabled:opacity-50',
        on
          ? 'bg-dye-brass/15 text-dye-brass ring-dye-brass/60 shadow-[inset_0_0_14px_rgba(217,164,65,0.20)]'
          : 'text-ink-faint/45 ring-house-rail hover:bg-beam/[0.06] hover:text-beam hover:ring-beam/50'
      )}
    >
      <Check className="h-4 w-4" strokeWidth={on ? 2.6 : 1.8} />
    </button>
  );
}

function MineNote({ take }: { take: ShowTake }) {
  return (
    <span
      aria-label={`Sua nota: ${fmt(take.final ?? 0)}${take.scores ? ', criteriosa' : ''}`}
      title={take.scores ? 'Avaliação criteriosa' : 'Sua nota'}
      className={cn(
        'flex h-9 min-w-[38px] items-center justify-center rounded-cell px-1.5 ring-1',
        take.scores
          ? 'bg-beam/10 text-beam ring-beam/45'
          : 'text-ink ring-house-rail'
      )}
    >
      <span className="q text-[14px] font-medium">{fmt(take.final ?? 0)}</span>
    </span>
  );
}

function whenBR(iso: string) {
  const at = new Date(iso + 'T12:00:00');
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function SeasonSheet({
  showId,
  showTitle,
  showPoster,
  genre,
  season,
  name,
  overview,
  takes,
  meId,
  criteria,
  onClose,
  onSaved,
  fault,
}: {
  showId: number;
  showTitle: string;
  showPoster: string | null;
  genre: string;
  season: number;
  name: string | null;
  overview: string | null;
  takes: ShowTake[];
  meId: string;
  criteria: Criterion[] | null;
  onClose: () => void;
  onSaved: () => void;
  fault: (msg: string) => void;
}) {
  const mine = takes.find(t => t.reviewerId === meId) ?? null;
  const ref = useRef<HTMLDialogElement>(null);
  const [modo, setModo] = useState<'rapida' | 'criteriosa'>(mine?.scores ? 'criteriosa' : 'rapida');
  const [quick, setQuick] = useState<number>(mine?.quick ?? 7);
  const [scores, setScores] = useState<Record<string, number>>(mine?.scores ?? {});
  const [comment, setComment] = useState(mine?.comment ?? '');
  const [salvando, setSalvando] = useState(false);

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

  const gravar = useCallback(
    async (patch: Partial<SeasonPatch>) => {
      if (salvando) return;
      setSalvando(true);
      try {
        await showsApi.rate(showId, season, { showTitle, showPoster, genre, ...patch });
        onSaved();
      } catch (e) {
        fault('Não foi possível gravar: ' + (e as Error).message);
      } finally {
        setSalvando(false);
      }
    },
    [salvando, showId, season, showTitle, showPoster, genre, onSaved, fault]
  );

  const apagar = useCallback(async () => {
    if (salvando) return;
    if (
      !confirm(
        `Apagar a sua nota da temporada ${season}? Os episódios marcados continuam vistos.`
      )
    ) {
      return;
    }
    setSalvando(true);
    try {
      await showsApi.unrate(showId, season);
      onSaved();
      onClose();
    } catch (e) {
      fault('Não foi possível apagar: ' + (e as Error).message);
    } finally {
      setSalvando(false);
    }
  }, [salvando, showId, season, onSaved, onClose, fault]);

  const media = criteria?.length
    ? criteria.reduce((s, c) => s + (scores[c.key] ?? 5), 0) / criteria.length
    : 0;

  const titulo = `Temporada ${season}`;

  return (
    <dialog
      ref={ref}
      aria-label={`${showTitle} — ${titulo}`}
      onClick={e => {
        if (e.target === ref.current) onClose();
      }}
      className="w-full max-w-[760px] max-h-[calc(100dvh/var(--ui-zoom))] overflow-hidden bg-transparent p-2 text-ink backdrop:bg-house-deep/95 open:animate-beam-in sm:p-4"
    >
      <div className="plate relative max-h-[calc(100dvh/var(--ui-zoom)-1rem)] overflow-y-auto overscroll-contain p-5 sm:max-h-[calc(100dvh/var(--ui-zoom)-2rem)] sm:p-6">
        <IconKey aria-label="Fechar" onClick={onClose} className="absolute right-3 top-3 z-10">
          <X className="h-4 w-4" strokeWidth={1.8} />
        </IconKey>

        <p className="legend">{showTitle}</p>
        <h2 className="mt-2 pr-10 font-display text-[24px] leading-none tracking-[0.03em] text-beam sm:text-[28px]">
          {titulo}
        </h2>
        {name && name !== titulo ? (
          <p className="q mt-2 text-[12.5px] text-beam-dim">{name}</p>
        ) : null}

        {overview ? (
          <p className="mt-3 max-w-[66ch] text-[13px] leading-relaxed text-ink-dim">{overview}</p>
        ) : null}

        <div className="mt-6 border-t border-white/[0.07] pt-5">
          <div className="flex flex-wrap items-center gap-2">
            {}
            <Chip size="sm" on={modo === 'rapida'} onClick={() => setModo('rapida')}>
              Nota rápida
            </Chip>
            <Chip size="sm" on={modo === 'criteriosa'} onClick={() => setModo('criteriosa')}>
              Avaliação criteriosa
            </Chip>
          </div>

          {modo === 'rapida' ? (
            <div className="mt-5">
              <div className="flex items-baseline gap-3">
                <span className="q text-[34px] font-medium leading-none text-beam">{fmt(quick)}</span>
                <span className="q text-[12px] text-ink-faint">/10</span>
              </div>
              {}
              <Gauge value={quick} onChange={setQuick} label="Nota da temporada" className="mt-4" />
              {mine?.scores ? (
                <p className="mt-3 text-[12.5px] leading-relaxed text-dye-brass">
                  Você já avaliou esta temporada pelos nove critérios. Gravar uma nota rápida
                  substitui aquela ficha.
                </p>
              ) : null}
              <Key
                tone="commit"
                className="mt-5"
                disabled={salvando}
                onClick={() => void gravar({ quick, comment: comment.trim() || null })}
              >
                <Check className="h-4 w-4" strokeWidth={2} />
                {salvando ? 'Gravando…' : 'Gravar a nota'}
              </Key>
            </div>
          ) : !criteria ? (
            <p className="mt-5 text-[13px] text-ink-dim">Carregando os critérios…</p>
          ) : (
            <div className="mt-5">
              {}
              <Channels
                criteria={criteria}
                scores={scores}
                still
                onChange={(key, value) => setScores(s => ({ ...s, [key]: value }))}
              />
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <span className="q text-[28px] font-medium leading-none text-beam">{fmt(media)}</span>
                <span className="q text-[11px] text-ink-faint">
                  média dos {criteria.length} critérios
                </span>
              </div>
              <Key
                tone="commit"
                className="mt-4"
                disabled={salvando}
                onClick={() => {
                  const cheio: Record<string, number> = {};
                  for (const c of criteria) cheio[c.key] = scores[c.key] ?? 5;
                  void gravar({ scores: cheio, comment: comment.trim() || null });
                }}
              >
                <Check className="h-4 w-4" strokeWidth={2} />
                {salvando ? 'Gravando…' : 'Gravar a avaliação criteriosa'}
              </Key>
            </div>
          )}

          <label className="mt-5 block">
            <span className="legend mb-1.5 block">O que você achou</span>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Opcional. Fica junto da nota."
              className="w-full resize-y rounded-cell bg-house-deep px-3 py-2.5 text-[14px] text-ink caret-dye-red ring-1 ring-house-rail transition-shadow placeholder:text-ink-dim focus-visible:outline-none focus-visible:ring-dye-brass"
            />
          </label>

          {mine ? (
            <Key tone="ghost" className="mt-5" disabled={salvando} onClick={() => void apagar()}>
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              Apagar a minha nota
            </Key>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}

export function SeriesArchiveScreen({
  takes,
  roster,
  onOpen,
}: {
  takes: ShowTake[] | null;
  roster: Reviewer[];
  onOpen: (showId: number) => void;
}) {
  const [quem, setQuem] = useState<string | null>(null);
  const [abertas, setAbertas] = useState<ReadonlySet<number>>(() => new Set());
  const [temporadas, setTemporadas] = useState<ReadonlySet<string>>(() => new Set());

  const gente = useMemo(() => {
    const mapa = new Map<string, { id: string; name: string; dot: string | null; count: number }>();
    for (const t of takes ?? []) {
      const achado = mapa.get(t.reviewerId);
      if (achado) achado.count += 1;
      else if (t.reviewerName)
        mapa.set(t.reviewerId, {
          id: t.reviewerId,
          name: t.reviewerName,
          dot: t.reviewerDot,
          count: 1,
        });
    }
    return [...mapa.values()].map(p => ({
      ...p,
      avatar: roster.find(r => r.id === p.id)?.avatar ?? null,
    }));
  }, [takes, roster]);

  const arvore = useMemo(() => {
    const vistos = (takes ?? []).filter(t => !quem || t.reviewerId === quem);
    const series = new Map<
      number,
      {
        id: number;
        title: string;
        poster: string | null;
        seasons: Map<
          number,
          { takes: ShowTake[]; eps: Map<number, { title: string | null; takes: ShowTake[] }> }
        >;
      }
    >();

    for (const t of vistos) {
      let s = series.get(t.showId);
      if (!s) {
        s = { id: t.showId, title: t.showTitle, poster: t.showPoster, seasons: new Map() };
        series.set(t.showId, s);
      }
      let temp = s.seasons.get(t.season);
      if (!temp) {
        temp = { takes: [], eps: new Map() };
        s.seasons.set(t.season, temp);
      }
      if (t.kind === 'season' || t.episode == null) {
        temp.takes.push(t);
        continue;
      }
      let ep = temp.eps.get(t.episode);
      if (!ep) {
        ep = { title: t.episodeTitle, takes: [] };
        temp.eps.set(t.episode, ep);
      }
      if (!ep.title && t.episodeTitle) ep.title = t.episodeTitle;
      ep.takes.push(t);
    }

    const medir = (lista: ShowTake[]) => {
      const comNota = lista.filter(x => x.final != null);
      return comNota.length
        ? comNota.reduce((acc, x) => acc + (x.final ?? 0), 0) / comNota.length
        : null;
    };

    return [...series.values()]
      .map(s => {
        const seasons = [...s.seasons.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([numero, temp]) => {
            const episodios = [...temp.eps.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([n, ep]) => ({ numero: n, ...ep }));
            return { numero, episodios, takes: temp.takes, average: medir(temp.takes) };
          });
        const todas = seasons
          .map(t => t.average)
          .filter((n): n is number => n != null);
        return {
          ...s,
          seasons,
          episodes: seasons.reduce((n, t) => n + t.episodios.length, 0),
          average: todas.length ? todas.reduce((a, b) => a + b, 0) / todas.length : null,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [takes, quem]);

  if (!takes) {
    return (
      <section>
        <Bill title="Avaliados" note="carregando…" />
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="h-[64px] w-full" />
          ))}
        </div>
      </section>
    );
  }

  if (!takes.length) {
    return (
      <section>
        <Bill title="Avaliados" />
        <Blank title="Nenhum episódio marcado ainda">
          Abra uma série e marque um episódio como visto. A nota é da temporada, e se dá no
          painel acima da lista.
        </Blank>
      </section>
    );
  }

  const marcados = takes.filter(t => t.kind === 'episode').length;
  const fichas = takes.filter(t => t.final != null).length;

  return (
    <section>
      <Bill
        title="Avaliados"
        note={`${plural(marcados, 'episódio visto', 'episódios vistos')} · ${plural(fichas, 'ficha', 'fichas')}`}
      />

      {}
      {gente.length ? (
        <div className="mb-6">
          <ReelPicker
            title="Quem avaliou"
            value={quem}
            onPick={setQuem}
            choices={[
              {
                id: null,
                label: 'O clube',
                count: takes.length,
                hint: 'Ver o acervo do clube inteiro',
              },
              ...gente.map(p => ({
                id: p.id,
                label: p.name,
                count: p.count,
                hint: `Ver só o que ${p.name} marcou`,
                reel: (
                  <Reel color={reelColor(p.dot, p.id)} src={p.avatar} size="md">
                    {initialsOf(p.name)}
                  </Reel>
                ),
              })),
            ]}
          />
        </div>
      ) : null}

      {!arvore.length ? (
        <Blank title="Nada marcado por essa pessoa ainda">
          Escolha <span className="text-ink">O clube</span> para ver o acervo inteiro.
        </Blank>
      ) : (
        <ul className="flex flex-col">
          {arvore.map(serie => {
            const aberta = abertas.has(serie.id);
            return (
              <li key={serie.id} className="border-t border-white/[0.06] first:border-t-0">
                <div className="flex items-center gap-3 px-2 transition-colors hover:bg-beam/[0.05]">
                  <button
                    type="button"
                    aria-expanded={aberta}
                    onClick={() =>
                      setAbertas(prev => {
                        const next = new Set(prev);
                        if (next.has(serie.id)) next.delete(serie.id);
                        else next.add(serie.id);
                        return next;
                      })
                    }
                    className="group flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
                  >
                    <Poster src={serie.poster} className="h-[52px] w-[35px] flex-none" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] text-ink transition-colors group-hover:text-beam">
                        {serie.title}
                      </span>
                      <span className="q block text-[11px] text-ink-dim">
                        {plural(serie.seasons.length, 'temporada', 'temporadas')} ·{' '}
                        {plural(serie.episodes, 'episódio', 'episódios')}
                      </span>
                    </span>
                    {serie.average != null ? (
                      <span className="q flex-none text-[17px] text-beam">{fmt(serie.average)}</span>
                    ) : null}
                  </button>
                  {}
                  <IconKey aria-label={`Abrir ${serie.title}`} onClick={() => onOpen(serie.id)}>
                    <ChevronLeft className="h-4 w-4 rotate-180" strokeWidth={1.8} />
                  </IconKey>
                </div>

                <Drawer open={aberta}>
                  <ul className="flex flex-col pb-2 pl-6">
                    {serie.seasons.map(temp => {
                      const chave = `${serie.id}x${temp.numero}`;
                      const abertaT = temporadas.has(chave);
                      return (
                        <ArchiveSeason
                          key={chave}
                          numero={temp.numero}
                          episodios={temp.episodios}
                          takes={temp.takes}
                          average={temp.average}
                          aberta={abertaT}
                          onToggle={() =>
                            setTemporadas(prev => {
                              const next = new Set(prev);
                              if (next.has(chave)) next.delete(chave);
                              else next.add(chave);
                              return next;
                            })
                          }
                        />
                      );
                    })}
                  </ul>
                </Drawer>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ArchiveSeason({
  numero,
  episodios,
  takes,
  average,
  aberta,
  onToggle,
}: {
  numero: number;
  episodios: { numero: number; title: string | null; takes: ShowTake[] }[];
  takes: ShowTake[];
  average: number | null;
  aberta: boolean;
  onToggle: () => void;
}) {
  const world = useWorld();
  const [ficha, setFicha] = useState<string | null>(null);
  const [tocada, setTocada] = useState(false);

  const comNota = takes.filter(t => t.final != null);

  return (
    <li className="border-t border-white/[0.05]">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pr-2">
        <button
          type="button"
          aria-expanded={aberta}
          onClick={onToggle}
          className="group flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left transition-colors hover:bg-beam/[0.04]"
        >
          <span className="font-display text-[13px] uppercase tracking-[0.1em] text-ink transition-colors group-hover:text-beam">
            Temporada {numero}
          </span>
          <span className="q text-[11px] text-ink-faint">
            {plural(episodios.length, 'episódio', 'episódios')}
          </span>
        </button>

        {comNota.map(t => {
          const on = ficha === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-expanded={on}
              aria-label={`${on ? 'Fechar' : 'Abrir'} a ficha de ${t.reviewerName ?? 'alguém'} — nota ${fmt(t.final ?? 0)}`}
              onClick={() => {
                setFicha(v => (v === t.id ? null : t.id));
                setTocada(true);
              }}
              className={cn(
                'flex flex-none items-center gap-1.5 rounded-cell px-1.5 py-1 ring-1 transition-colors duration-150',
                on
                  ? 'text-dye-brass ring-dye-brass/60 shadow-[inset_0_0_14px_rgba(217,164,65,0.18)]'
                  : 'text-ink-dim ring-house-rail hover:text-beam hover:ring-white/25'
              )}
            >
              <Reel color={reelColor(t.reviewerDot, t.reviewerId)} src={world.avatarOf(t.reviewerId)} size="sm">
                {initialsOf(t.reviewerName ?? '?')}
              </Reel>
              <span className={cn('q text-[12.5px] font-medium', t.scores ? 'text-beam' : undefined)}>
                {fmt(t.final ?? 0)}
              </span>
            </button>
          );
        })}

        {average != null ? (
          <span className="q flex-none text-[14px] text-beam">{fmt(average)}</span>
        ) : null}
      </div>

      <Drawer open={ficha !== null}>
        {tocada ? (
          <div className="pb-3 pr-2">
            {comNota
              .filter(t => t.id === ficha)
              .map(t => (
                <TakeCard key={t.id} take={t} />
              ))}
          </div>
        ) : null}
      </Drawer>

      <Drawer open={aberta}>
        <ul className="flex flex-col pb-2 pl-4">
          {episodios.map(ep => (
            <ArchiveEpisode key={ep.numero} numero={ep.numero} title={ep.title} takes={ep.takes} />
          ))}
        </ul>
      </Drawer>
    </li>
  );
}

function ArchiveEpisode({
  numero,
  title,
  takes,
}: {
  numero: number;
  title: string | null;
  takes: ShowTake[];
}) {
  const world = useWorld();

  return (
    <li className="border-t border-white/[0.04]">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 py-2 pr-2">
        <span className="q flex-none text-[11px] text-ink-dim">
          E{String(numero).padStart(2, '0')}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
          {title || 'sem título'}
        </span>

        {takes.length ? (
          <span
            className="flex flex-none items-center gap-1 opacity-60"
            title={`Visto por ${takes.map(t => t.reviewerName ?? 'alguém').join(', ')}`}
          >
            <Check className="h-3.5 w-3.5 flex-none text-ink-faint" strokeWidth={2} aria-hidden />
            {takes.map(t => (
              <Reel key={t.id} color={reelColor(t.reviewerDot, t.reviewerId)} src={world.avatarOf(t.reviewerId)} size="sm">
                {initialsOf(t.reviewerName ?? '?')}
              </Reel>
            ))}
          </span>
        ) : null}
      </div>
    </li>
  );
}

const FEED_POLL_MS = 120_000;

export function SeriesFeedScreen({
  takes,
  onOpenShow,
  onAimComment,
}: {
  takes: ShowTake[] | null;
  onOpenShow: (showId: number) => void;
  onAimComment: (commentId: string) => void;
}) {
  const [items, setItems] = useState<ShowFeedEvent[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const got = await showsSocial.feed();
      setItems(got.items);
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const tick = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const id = window.setInterval(tick, FEED_POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  useLive(kinds => {
    if (kinds.has('shows') || kinds.has('social')) void load();
  });

  if (erro && !items) {
    return (
      <section>
        <Bill title="Feed" />
        <div className="max-w-[60ch]">
          <Fault detail={erro}>Não foi possível carregar o feed.</Fault>
        </div>
      </section>
    );
  }

  if (!items) {
    return (
      <section>
        <Bill title="Feed" note="carregando…" />
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="plate flex gap-4 p-4">
              <Skeleton className="aspect-[2/3] w-[54px] flex-none" />
              <div className="flex-1 space-y-2.5 pt-1">
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-2.5 w-full" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (!items.length) {
    return (
      <section>
        <Bill title="Feed" />
        <Blank title="O clube ainda não fez nada">
          Quando alguém marcar um episódio, der uma nota ou comentar uma ficha, aparece aqui — do
          mais recente para o mais antigo.
        </Blank>
      </section>
    );
  }

  let ultimoDia = '';

  return (
    <section>
      <Bill
        title="Feed"
        note={`${plural(items.length, 'acontecimento', 'acontecimentos')} no clube`}
      />

      <div className="max-w-[760px]">
        {runsOf(items).map(bloco => {
          const primeiro = bloco[0];
          const dia = dayOf(primeiro.at);
          const abreDia = dia !== ultimoDia;
          ultimoDia = dia;
          return (
            <div key={primeiro.id}>
              {abreDia ? <p className="legend mb-3 mt-7 first:mt-0">{dia}</p> : null}
              {primeiro.kind === 'take' ? (
                bloco.length > 1 ? (
                  <FeedRatedRun events={bloco} takes={takes} onOpenShow={onOpenShow} />
                ) : (
                  <FeedRated e={primeiro} takes={takes} onOpenShow={onOpenShow} />
                )
              ) : primeiro.kind === 'seen' ? (
                <FeedSeen e={primeiro} takes={takes} onOpenShow={onOpenShow} />
              ) : (
                <FeedAside e={primeiro} takes={takes} onAimComment={onAimComment} />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const epTag = (season?: number, episode?: number | null) =>
  episode == null ? `T${season ?? 0}` : `T${season ?? 0}E${String(episode).padStart(2, '0')}`;

function runsOf(items: ShowFeedEvent[]) {
  const blocos: ShowFeedEvent[][] = [];
  for (const e of items) {
    const atual = blocos[blocos.length - 1];
    const cabe =
      atual &&
      e.kind === 'take' &&
      atual[0].kind === 'take' &&
      atual[0].actor.id === e.actor.id &&
      atual[0].showId === e.showId &&
      dayOf(atual[0].at) === dayOf(e.at);
    if (cabe) atual.push(e);
    else blocos.push([e]);
  }
  return blocos;
}

const inOrder = (events: ShowFeedEvent[]) =>
  [...events].sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));

function FeedRated({
  e,
  takes,
  onOpenShow,
}: {
  e: ShowFeedEvent;
  takes: ShowTake[] | null;
  onOpenShow: (showId: number) => void;
}) {
  const world = useWorld();
  const take = takes?.find(t => t.id === e.takeId) ?? null;
  const quem = take
    ? { id: take.id, reviewerId: take.reviewerId, reviewerName: take.reviewerName ?? 'alguém' }
    : null;
  const conversa = world.comments.filter(c => c.takeId === e.takeId).length;
  const hora = clockOf(e.at);

  const [conversando, setConversando] = useState(false);
  const [tocada, setTocada] = useState(false);
  const [aberta, setAberta] = useState(false);
  const [desdobrada, setDesdobrada] = useState(false);

  const escrito = take?.comment?.replace(/\s+/g, ' ').trim() ?? '';
  const cortado = !!escrito && escrito !== (e.excerpt ?? '');

  return (
    <div className="plate mb-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-4">
        <PersonReel person={e.actor} size="sm" />
        <PersonName
          person={e.actor}
          className="font-display text-[13px] uppercase tracking-[0.1em] text-ink"
        />
        <span className="text-[12.5px] text-ink-dim">avaliou a temporada</span>
        {hora ? <span className="q ml-auto text-[10.5px] text-ink-faint">{hora}</span> : null}
      </div>

      {}
      <div className="px-4 pb-4 pt-2.5">
        <div className="flex gap-4">
          {}
          <button
            type="button"
            onClick={() => onOpenShow(e.showId)}
            aria-label={`Abrir ${e.showTitle}`}
            className="group/cartaz min-h-[81px] flex-none sm:min-h-[93px]"
          >
            <Poster
              src={e.showPoster}
              className="h-full w-[54px] transition-opacity duration-150 group-hover/cartaz:opacity-80 sm:w-[62px]"
            />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <button
                type="button"
                onClick={() => onOpenShow(e.showId)}
                className="text-left font-display text-[22px] leading-none tracking-[0.02em] text-beam transition-colors duration-150 hover:text-beam-hot"
              >
                {e.showTitle}
              </button>
              <span className="q text-[11.5px] text-ink-dim">{epTag(e.season, e.episode)}</span>
            </div>

            {}
            {e.episodeTitle ? (
              <p className="mt-1 truncate text-[13px] text-ink-dim">{e.episodeTitle}</p>
            ) : null}

            <button
              type="button"
              disabled={!take}
              onClick={() => {
                setAberta(v => !v);
                setDesdobrada(true);
              }}
              aria-expanded={take ? aberta : undefined}
              aria-label={`${aberta ? 'Fechar' : 'Abrir'} o detalhamento da ficha de ${e.actor.name}`}
              className="group/notas mt-2.5 block w-full text-left"
            >
              <span className="flex items-center gap-3">
                <Strip value={e.final ?? 0} cells={10} className="h-[6px] w-[120px] flex-none" />
                <span className="q text-[15px] font-medium text-beam">{fmt(e.final ?? 0)}</span>
                <span className="q text-[11px] text-ink-faint">/10</span>
                {take ? (
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      'ml-auto h-4 w-4 flex-none text-ink-faint transition-transform duration-200 group-hover/notas:text-ink-dim',
                      aberta && 'rotate-180'
                    )}
                    strokeWidth={1.7}
                  />
                ) : null}
              </span>

              {}
              {e.ends ? (
                <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                  <span className="flex items-center gap-1.5 text-ink-dim">
                    <ThumbsUp className="h-3 w-3 flex-none text-ink-faint" strokeWidth={1.9} aria-hidden />
                    {e.ends.high.name}
                    <span className="q text-beam">{fmt(e.ends.high.value)}</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-ink-dim">
                    <ThumbsDown className="h-3 w-3 flex-none text-ink-faint" strokeWidth={1.9} aria-hidden />
                    {e.ends.low.name}
                    <span className="q text-ink">{fmt(e.ends.low.value)}</span>
                  </span>
                </span>
              ) : null}
            </button>
          </div>
        </div>

        {}
        {e.excerpt ? (
          <button
            type="button"
            disabled={!take}
            onClick={() => {
              setAberta(v => !v);
              setDesdobrada(true);
            }}
            title={take ? 'Ver o detalhamento' : undefined}
            className="mt-3 block w-full break-words text-left text-[13px] italic leading-relaxed text-ink-dim"
          >
            “{e.excerpt}”
          </button>
        ) : null}
      </div>

      <Drawer open={aberta}>
        {desdobrada && take ? (
          <div className="px-4 pb-4">
            <Breakdown r={take} comment={cortado ? take.comment ?? undefined : undefined} />
          </div>
        ) : null}
      </Drawer>

      {quem ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-4 py-2.5">
          <TakeVotes take={quem} labelled />

          <button
            type="button"
            aria-expanded={conversando}
            aria-label={
              `${conversando ? 'Fechar' : 'Abrir'} a conversa da ficha de ${e.actor.name}` +
              (conversa ? `, ${plural(conversa, 'resposta', 'respostas')}` : '')
            }
            title={conversando ? 'Fechar a conversa' : 'Comentar esta ficha'}
            onClick={() => {
              setConversando(v => !v);
              setTocada(true);
            }}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-cell px-2.5 ring-1 transition-colors duration-150',
              conversando
                ? 'text-dye-brass ring-dye-brass/60 shadow-[inset_0_0_14px_rgba(217,164,65,0.18)]'
                : 'text-ink-dim ring-house-rail hover:text-beam hover:ring-white/25'
            )}
          >
            <MessageSquare className="h-3.5 w-3.5 flex-none" strokeWidth={1.9} aria-hidden />
            <span className="hidden font-display text-[11px] uppercase leading-none tracking-[0.12em] sm:inline">
              {conversando ? 'Fechar' : 'Comentar'}
            </span>
            {conversa ? (
              <span className="q text-[10.5px] leading-none opacity-80">{conversa}</span>
            ) : null}
          </button>

          {}
          <button
            type="button"
            onClick={() => onOpenShow(e.showId)}
            title="Abrir a série, na lista de episódios"
            aria-label={`Abrir ${e.showTitle}`}
            className="ml-auto flex h-7 items-center rounded-cell px-1.5 text-ink-faint transition-colors duration-150 hover:text-beam"
          >
            <ArrowUpRight className="h-4 w-4 flex-none" strokeWidth={1.8} aria-hidden />
          </button>
        </div>
      ) : null}

      <Drawer open={conversando}>
        {tocada && quem ? (
          <div className="px-4 pb-4">
            <Conversation take={quem} ruled={false} />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function FeedRatedRun({
  events,
  takes,
  onOpenShow,
}: {
  events: ShowFeedEvent[];
  takes: ShowTake[] | null;
  onOpenShow: (showId: number) => void;
}) {
  const emOrdem = inOrder(events);
  const primeiro = emOrdem[0];
  const ultimo = emOrdem[emOrdem.length - 1];
  const hora = clockOf(events[0].at);

  return (
    <div className="plate mb-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-4">
        <PersonReel person={events[0].actor} size="sm" />
        <PersonName
          person={events[0].actor}
          className="font-display text-[13px] uppercase tracking-[0.1em] text-ink"
        />
        <span className="text-[12.5px] text-ink-dim">
          avaliou {plural(events.length, 'temporada', 'temporadas')}
        </span>
        {hora ? <span className="q ml-auto text-[11px] text-ink-faint">{hora}</span> : null}
      </div>

      <button
        type="button"
        onClick={() => onOpenShow(events[0].showId)}
        aria-label={`Abrir ${events[0].showTitle}`}
        className="group flex w-full gap-4 px-4 pb-3 pt-2.5 text-left transition-colors duration-150 hover:bg-house-seat"
      >
        <Poster src={events[0].showPoster} className="aspect-[2/3] w-[54px] flex-none sm:w-[62px]" />
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[22px] leading-none tracking-[0.02em] text-beam transition-colors group-hover:text-beam-hot">
            {events[0].showTitle}
          </span>
          {}
          <span className="q mt-1.5 block text-[12px] text-ink-dim">
            do {epTag(primeiro.season, primeiro.episode)} ao {epTag(ultimo.season, ultimo.episode)}
          </span>
        </span>
        <ArrowUpRight
          aria-hidden
          className="mt-1 h-4 w-4 flex-none text-ink-faint transition-colors group-hover:text-beam"
          strokeWidth={1.8}
        />
      </button>

      <ul>
        {emOrdem.map(e => (
          <RunEpisode key={e.id} e={e} takes={takes} />
        ))}
      </ul>
    </div>
  );
}

function RunEpisode({ e, takes }: { e: ShowFeedEvent; takes: ShowTake[] | null }) {
  const world = useWorld();
  const take = takes?.find(t => t.id === e.takeId) ?? null;
  const quem = take
    ? { id: take.id, reviewerId: take.reviewerId, reviewerName: take.reviewerName ?? 'alguém' }
    : null;
  const conversa = world.comments.filter(c => c.takeId === e.takeId).length;

  const [aberta, setAberta] = useState(false);
  const [desdobrada, setDesdobrada] = useState(false);
  const [conversando, setConversando] = useState(false);
  const [tocada, setTocada] = useState(false);

  const escrito = take?.comment?.replace(/\s+/g, ' ').trim() ?? '';
  const cortado = !!escrito && escrito !== (e.excerpt ?? '');

  return (
    <li className="border-t border-white/[0.06]">
      <button
        type="button"
        disabled={!take}
        onClick={() => {
          setAberta(v => !v);
          setDesdobrada(true);
        }}
        aria-expanded={take ? aberta : undefined}
        aria-label={`${aberta ? 'Fechar' : 'Abrir'} a ficha de ${epTag(e.season, e.episode)}`}
        className="group flex w-full items-baseline gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-house-seat disabled:hover:bg-transparent"
      >
        <span className="q w-[52px] flex-none text-[12px] text-ink-dim">
          {epTag(e.season, e.episode)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-ink transition-colors group-hover:text-beam">
            {e.episodeTitle || '—'}
          </span>
          {e.excerpt ? (
            <span className="mt-1 block break-words text-[12.5px] italic leading-relaxed text-ink-dim">
              “{e.excerpt}”
            </span>
          ) : null}
        </span>
        <span className="flex flex-none items-center gap-2">
          <Strip value={e.final ?? 0} cells={10} className="hidden h-[5px] w-[70px] sm:block" />
          <span className="q text-[13px] font-medium text-beam">{fmt(e.final ?? 0)}</span>
        </span>
        {take ? (
          <ChevronDown
            aria-hidden
            className={cn(
              'h-4 w-4 flex-none self-center text-ink-faint transition-transform duration-200 group-hover:text-ink-dim',
              aberta && 'rotate-180'
            )}
            strokeWidth={1.7}
          />
        ) : null}
      </button>

      <Drawer open={aberta}>
        {desdobrada && take ? (
          <div className="px-4 pb-4">
            <Breakdown r={take} comment={cortado ? take.comment ?? undefined : undefined} />
          </div>
        ) : null}
      </Drawer>

      {quem ? (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2.5">
          <TakeVotes take={quem} />
          <button
            type="button"
            aria-expanded={conversando}
            aria-label={
              `${conversando ? 'Fechar' : 'Abrir'} a conversa de ${epTag(e.season, e.episode)}` +
              (conversa ? `, ${plural(conversa, 'resposta', 'respostas')}` : '')
            }
            title={conversando ? 'Fechar a conversa' : 'Comentar esta ficha'}
            onClick={() => {
              setConversando(v => !v);
              setTocada(true);
            }}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-cell px-2.5 ring-1 transition-colors duration-150',
              conversando
                ? 'text-dye-brass ring-dye-brass/60 shadow-[inset_0_0_14px_rgba(217,164,65,0.18)]'
                : 'text-ink-dim ring-house-rail hover:text-beam hover:ring-white/25'
            )}
          >
            <MessageSquare className="h-3.5 w-3.5 flex-none" strokeWidth={1.9} aria-hidden />
            {conversa ? (
              <span className="q text-[10.5px] leading-none opacity-80">{conversa}</span>
            ) : null}
          </button>
        </div>
      ) : null}

      <Drawer open={conversando}>
        {tocada && quem ? (
          <div className="px-4 pb-4">
            <Conversation take={quem} ruled={false} />
          </div>
        ) : null}
      </Drawer>
    </li>
  );
}

function FeedSeen({
  e,
  takes,
  onOpenShow,
}: {
  e: ShowFeedEvent;
  takes: ShowTake[] | null;
  onOpenShow: (showId: number) => void;
}) {
  const world = useWorld();
  const hora = clockOf(e.at);
  const varios = (e.count ?? 1) > 1;

  const take = takes?.find(t => t.id === e.takeId) ?? null;
  const quem = take
    ? { id: take.id, reviewerId: take.reviewerId, reviewerName: take.reviewerName ?? 'alguém' }
    : null;
  const conversa = world.comments.filter(c => c.takeId === e.takeId).length;

  const [conversando, setConversando] = useState(false);
  const [tocada, setTocada] = useState(false);

  return (
    <div className="plate mb-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-4">
        <PersonReel person={e.actor} size="sm" />
        <PersonName
          person={e.actor}
          className="font-display text-[13px] uppercase tracking-[0.1em] text-ink"
        />
        <span className="text-[12.5px] text-ink-dim">
          {varios ? `viu ${plural(e.count ?? 0, 'episódio', 'episódios')}` : 'viu'}
        </span>
        {hora ? <span className="q ml-auto text-[10.5px] text-ink-faint">{hora}</span> : null}
      </div>

      <div className="px-4 pb-4 pt-2.5">
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => onOpenShow(e.showId)}
            aria-label={`Abrir ${e.showTitle}`}
            className="group/cartaz min-h-[81px] flex-none sm:min-h-[93px]"
          >
            <Poster
              src={e.showPoster}
              className="h-full w-[54px] transition-opacity duration-150 group-hover/cartaz:opacity-80 sm:w-[62px]"
            />
          </button>

          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => onOpenShow(e.showId)}
              className="block text-left font-display text-[22px] leading-none tracking-[0.02em] text-beam transition-colors duration-150 hover:text-beam-hot"
            >
              {e.showTitle}
            </button>

            {}
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-dim">
              <Check className="h-3.5 w-3.5 flex-none text-ink-faint" strokeWidth={2} aria-hidden />
              {varios ? (
                <span className="q text-[12.5px]">
                  {e.from && e.to
                    ? `${epTag(e.from.season, e.from.episode)} a ${epTag(e.to.season, e.to.episode)}`
                    : plural(e.count ?? 0, 'episódio', 'episódios')}
                </span>
              ) : (
                <>
                  <span className="q text-[12.5px] text-ink-faint">
                    {epTag(e.to?.season, e.to?.episode)}
                  </span>
                  {e.to?.title ? <span className="truncate">{e.to.title}</span> : null}
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {quem ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] px-4 py-2.5">
          <TakeVotes take={quem} labelled />

          <button
            type="button"
            aria-expanded={conversando}
            aria-label={
              `${conversando ? 'Fechar' : 'Abrir'} a conversa sobre o que ${e.actor.name} viu` +
              (conversa ? `, ${plural(conversa, 'resposta', 'respostas')}` : '')
            }
            title={conversando ? 'Fechar a conversa' : 'Comentar'}
            onClick={() => {
              setConversando(v => !v);
              setTocada(true);
            }}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-cell px-2.5 ring-1 transition-colors duration-150',
              conversando
                ? 'text-dye-brass ring-dye-brass/60 shadow-[inset_0_0_14px_rgba(217,164,65,0.18)]'
                : 'text-ink-dim ring-house-rail hover:text-beam hover:ring-white/25'
            )}
          >
            <MessageSquare className="h-3.5 w-3.5 flex-none" strokeWidth={1.9} aria-hidden />
            <span className="hidden font-display text-[11px] uppercase leading-none tracking-[0.12em] sm:inline">
              {conversando ? 'Fechar' : 'Comentar'}
            </span>
            {conversa ? (
              <span className="q text-[10.5px] leading-none opacity-80">{conversa}</span>
            ) : null}
          </button>

          <button
            type="button"
            onClick={() => onOpenShow(e.showId)}
            title="Abrir a série, na lista de episódios"
            aria-label={`Abrir ${e.showTitle}`}
            className="ml-auto flex h-7 items-center rounded-cell px-1.5 text-ink-faint transition-colors duration-150 hover:text-beam"
          >
            <ArrowUpRight className="h-4 w-4 flex-none" strokeWidth={1.8} aria-hidden />
          </button>
        </div>
      ) : null}

      <Drawer open={conversando}>
        {tocada && quem ? (
          <div className="px-4 pb-4">
            <Conversation take={quem} ruled={false} />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function FeedAside({
  e,
  takes,
  onAimComment,
}: {
  e: ShowFeedEvent;
  takes: ShowTake[] | null;
  onAimComment: (commentId: string) => void;
}) {
  const world = useWorld();
  const hora = clockOf(e.at);
  const take = takes?.find(t => t.id === e.takeId) ?? null;
  const [aberta, setAberta] = useState(false);
  const [desdobrada, setDesdobrada] = useState(false);

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => {
          if (!take) return;
          const proximo = !aberta;
          setAberta(proximo);
          setDesdobrada(true);
          if (proximo && e.commentId) onAimComment(e.commentId);
        }}
        aria-expanded={take ? aberta : undefined}
        className="group flex w-full items-start gap-3 rounded-cell px-3 py-2.5 text-left transition-colors duration-150 hover:bg-beam/[0.05]"
      >
        <MessageSquare
          className="mt-[3px] h-3.5 w-3.5 flex-none text-ink-faint"
          strokeWidth={1.9}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] leading-snug text-ink-dim">
            <span className="font-display uppercase tracking-[0.08em] text-ink">{e.actor.name}</span>{' '}
            {e.parentId ? 'respondeu um comentário na ficha de ' : 'comentou a ficha de '}
            {e.owner?.id === world.me.id ? (
              <span className="text-dye-brass">você</span>
            ) : (
              <span className="text-ink">{e.owner?.name ?? 'alguém'}</span>
            )}{' '}
            em{' '}
            <span className="text-ink transition-colors group-hover:text-beam">
              {e.showTitle} {epTag(e.season, e.episode)}
            </span>
          </span>
          {e.excerpt ? (
            <span className="mt-0.5 block break-words text-[12px] italic leading-snug text-ink-faint">
              “{e.excerpt}”
            </span>
          ) : null}
        </span>
        {hora ? <span className="q mt-0.5 flex-none text-[10.5px] text-ink-faint">{hora}</span> : null}
        {take ? (
          <ChevronDown
            aria-hidden
            className={cn(
              'mt-[1px] h-3.5 w-3.5 flex-none text-ink-faint transition-transform duration-200',
              aberta && 'rotate-180'
            )}
            strokeWidth={1.7}
          />
        ) : null}
      </button>

      {}
      <Drawer open={aberta}>
        {desdobrada && take ? (
          <div className="mb-2 ml-6 mr-1 mt-1">
            <TakeCard take={take} />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function TakeCard({ take }: { take: ShowTake }) {
  const quem = { id: take.id, reviewerId: take.reviewerId, reviewerName: take.reviewerName ?? 'alguém' };
  return (
    <div className="rounded-cell bg-house-seat/55 p-3 ring-1 ring-inset ring-white/[0.06]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PersonReel
          person={{ id: take.reviewerId, name: take.reviewerName ?? 'alguém', dot: take.reviewerDot }}
          size="sm"
        />
        <PersonName
          person={{ id: take.reviewerId, name: take.reviewerName ?? 'alguém', dot: take.reviewerDot }}
          className="font-display text-[12.5px] uppercase tracking-[0.1em] text-ink"
        />
        <span className="q text-[10.5px] text-ink-faint" title={take.ratedAt ?? take.watchedAt}>
          {whenOf(take.ratedAt ?? take.watchedAt)}
        </span>
        {}
        {take.final != null ? (
          <span className="ml-auto flex items-center gap-2.5">
            <Strip value={take.final} cells={10} className="hidden h-[5px] w-[80px] flex-none sm:block" />
            <span className="q text-[16px] font-medium leading-none text-beam">{fmt(take.final)}</span>
          </span>
        ) : null}
        <TakeVotes take={quem} />
      </div>

      {}
      <div className="mt-3">
        <Breakdown r={take} comment={take.comment ?? undefined} />
      </div>

      <Conversation take={quem} />
    </div>
  );
}
